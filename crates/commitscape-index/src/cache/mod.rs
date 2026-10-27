mod blame_store;
pub mod cols;
mod format;
mod identity_store;
mod line_store;
mod location;

use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};

use commitscape_core::{Index, Month, RepoIdentity};

use crate::build::IndexBuilder;
use crate::head_pass::{head_pass, ClassifyContext, Previous as PreviousHead};
use crate::identity::IdentityRules;
use crate::reresolve_authors;
use crate::source::{CommitSink, RawChange, RawCommit, RepoSource};
use format::{BlockEntry, Head, Previous, SortedIds, Unusable};

pub use blame_store::{BlameStore, Known, Moved};
pub use identity_store::IdentityStore;
pub(crate) use line_store::Counted;
pub use line_store::{LineStore, LogMark};
pub use location::default_cache_root;

const LOAD_LOCK: &str = "index.load";

/// The folder a repository's cache lives in: named by the cache key when one is given, so every clone of one repository shares it, or else by the clone's path.
/// The generations a repository's cache passed through, oldest first, the current one last: a generation in it was made from each before it, so the cache's ids extend that generation's. Empty without a cache.
pub fn cache_generations(options: &CacheOptions, repo: &RepoIdentity) -> Vec<u64> {
    repo_dir(options, repo)
        .map(|dir| format::generations(&dir))
        .unwrap_or_default()
}

pub fn repo_dir(options: &CacheOptions, repo: &RepoIdentity) -> Option<PathBuf> {
    let root = options.root.as_deref()?;
    Some(match options.key.as_deref() {
        Some(key) => root.join(keyed(key)),
        None => root.join(repo.cache_key()),
    })
}

fn keyed(key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("key-{hash:016x}")
}

#[derive(Debug, Clone, Default)]
pub struct CacheOptions {
    pub root: Option<PathBuf>,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    Warm,
    Updated { added: u64 },
    Built { reason: RebuildReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RebuildReason {
    Disabled,
    NoCache,
    SchemaChanged,
    Unreadable,
    HistoryRewritten,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    History { done: u64, total: u64 },
    HeadFiles,
}

pub struct Loaded {
    pub index: Index,
    pub freshness: Freshness,
    pub lineage: u64,
    pub kept: bool,
    pub columns: Columns,
    held: Option<Arc<LoadLock>>,
}

/// Where the Index's columns are kept beside the cache: the folder and the generation they belong to, and the kept columns when the Index was read from them.
#[derive(Default)]
pub struct Columns {
    pub at: Option<(PathBuf, u64)>,
    pub kept: Option<cols::Kept>,
}

/// Loads a repository's Index from the cache, reading only the history that is new.
pub fn load<S: RepoSource>(
    source: &S,
    options: &CacheOptions,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let span = tracing::info_span!(
        "load",
        commits = tracing::field::Empty,
        added = tracing::field::Empty,
        freshness = tracing::field::Empty
    );
    let _entered = span.enter();
    let loaded = load_index(source, options, progress)?;
    span.record("commits", loaded.index.commits.len());
    let (freshness, added) = match loaded.freshness {
        Freshness::Warm => ("warm", 0),
        Freshness::Updated { added } => ("updated", added),
        Freshness::Built { .. } => ("built", loaded.index.commits.len() as u64),
    };
    span.record("freshness", freshness);
    span.record("added", added);
    Ok(loaded)
}

fn load_index<S: RepoSource>(
    source: &S,
    options: &CacheOptions,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let identity = source.identity()?;
    let Some(dir) = repo_dir(options, &identity) else {
        return uncached(source, identity, progress);
    };
    let held = lock_loading(&dir);
    let mut loaded = load_held(source, options, &dir, identity, progress)?;
    loaded.held = held;
    Ok(loaded)
}

fn load_held<S: RepoSource>(
    source: &S,
    options: &CacheOptions,
    dir: &Path,
    identity: RepoIdentity,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let dir = dir.to_path_buf();
    let keyed = options.key.is_some();
    let fingerprint = source.refs_fingerprint()?;
    let store = IdentityStore::in_dir(&dir);
    let stored = store.rules(crate::mailmap::Mailmap::default());
    let mailmap_fingerprint = {
        let mut h = xxhash_rust::xxh3::Xxh3::new();
        h.update(&source.mailmap_fingerprint()?.to_le_bytes());
        h.update(&stored.extras_fingerprint().to_le_bytes());
        h.digest()
    };
    let ctx = Context {
        dir: &dir,
        identity,
        fingerprint,
        mailmap_fingerprint,
        stored,
    };

    let head = match format::read_head(&dir) {
        Ok(head) if keyed || head.repo == ctx.identity => head,
        Ok(_) | Err(Unusable::Damaged) => {
            return rebuild(source, ctx, RebuildReason::Unreadable, progress)
        }
        Err(Unusable::Missing) => return rebuild(source, ctx, RebuildReason::NoCache, progress),
        Err(Unusable::OtherSchema) => {
            return rebuild(source, ctx, RebuildReason::SchemaChanged, progress)
        }
    };

    let reclassify = head.classify.version != crate::classify::CLASSIFIER_VERSION;
    if head.refs_fingerprint == fingerprint && !reclassify {
        let rules = if head.mailmap_fingerprint == ctx.mailmap_fingerprint {
            None
        } else {
            Some(ctx.rules(source)?)
        };
        let r = warm(&ctx, head, rules.as_ref());
        return match r {
            Ok(loaded) => Ok(loaded),
            Err(_) => rebuild(source, ctx, RebuildReason::Unreadable, progress),
        };
    }
    resume(source, ctx, head, reclassify, progress)
}

fn uncached<S: RepoSource>(
    source: &S,
    identity: RepoIdentity,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let rules = IdentityRules::from_mailmap(source.mailmap()?);
    let (index, _) = build(source, identity, rules, progress, None)?;
    Ok(Loaded {
        index,
        freshness: Freshness::Built {
            reason: RebuildReason::Disabled,
        },
        lineage: format::new_generation(),
        kept: false,
        columns: Columns::default(),
        held: None,
    })
}

struct LoadLock(std::fs::File);

impl Drop for LoadLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

static HELD: Mutex<Vec<(PathBuf, Weak<LoadLock>)>> = Mutex::new(Vec::new());

fn lock_loading(dir: &Path) -> Option<Arc<LoadLock>> {
    let held_here = |held: &mut Vec<(PathBuf, Weak<LoadLock>)>| {
        held.retain(|(_, lock)| lock.strong_count() > 0);
        held.iter()
            .find(|(at, _)| at == dir)
            .and_then(|(_, lock)| lock.upgrade())
    };
    if let Some(lock) = HELD.lock().ok().as_mut().and_then(|h| held_here(h)) {
        return Some(lock);
    }
    std::fs::create_dir_all(dir).ok()?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOAD_LOCK))
        .ok()?;
    file.lock().ok()?;
    let lock = Arc::new(LoadLock(file));
    if let Ok(mut held) = HELD.lock() {
        held.push((dir.to_path_buf(), Arc::downgrade(&lock)));
    }
    Some(lock)
}

struct Context<'a> {
    dir: &'a Path,
    identity: RepoIdentity,
    fingerprint: u64,
    mailmap_fingerprint: u64,
    stored: IdentityRules,
}

impl Context<'_> {
    fn rules<S: RepoSource>(&self, source: &S) -> Result<IdentityRules, S::Error> {
        Ok(IdentityRules {
            mailmap: source.mailmap()?,
            ..self.stored.clone()
        })
    }
}

fn build<S: RepoSource>(
    source: &S,
    identity: RepoIdentity,
    rules: IdentityRules,
    progress: &mut dyn FnMut(Progress),
    spill: Option<&Path>,
) -> Result<(Index, ClassifyContext), S::Error> {
    let spilling = spill.and_then(|dir| {
        std::fs::create_dir_all(dir).ok()?;
        IndexBuilder::spilling(rules.clone(), dir).ok()
    });
    let spilled = spilling.is_some();
    let mut builder = spilling.unwrap_or_else(|| IndexBuilder::new(rules.clone()));
    let stats = source.walk_history(
        &std::collections::HashSet::new(),
        &mut Reporting {
            builder: &mut builder,
            progress,
        },
    )?;
    let tips = source.tips()?;
    let mut index = if spilled {
        match builder.finish_spilled(identity.clone(), tips, stats.history_truncated) {
            Ok(index) => index,
            Err(_) => return build(source, identity, rules, progress, None),
        }
    } else {
        builder.finish(identity, tips, stats.history_truncated)
    };
    progress(Progress::HeadFiles);
    let head = head_pass(source, &index.paths, None)?;
    index.head = head.files;
    index.head_commit = source.head_commit()?;
    Ok((index, head.context))
}

fn rebuild<S: RepoSource>(
    source: &S,
    ctx: Context<'_>,
    reason: RebuildReason,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let (index, classify) = build(
        source,
        ctx.identity.clone(),
        ctx.rules(source)?,
        progress,
        Some(ctx.dir),
    )?;
    let lineage = format::new_generation();
    let head = format::head_of(
        &index,
        lineage,
        ctx.fingerprint,
        ctx.mailmap_fingerprint,
        classify,
    );
    let written = format::write(format::Writing {
        head,
        previous: None,
        fresh: format::encode_blocks(&index.commits, &index.changes, &index.subjects),
        new_ids: SortedIds::run_of(index.commits.iter().map(|c| c.id)),
        dir: ctx.dir,
    })
    .ok();
    Ok(Loaded {
        index,
        freshness: Freshness::Built { reason },
        lineage,
        kept: written.is_some(),
        columns: Columns {
            at: written.map(|g| (ctx.dir.to_path_buf(), g)),
            kept: None,
        },
        held: None,
    })
}

fn index_from(head: Head, decoded: format::Decoded) -> Index {
    Index {
        schema_version: head.schema_version,
        repo: head.repo,
        frontier: head.frontier,
        commits: decoded.commits.into(),
        changes: decoded.changes.into(),
        subjects: decoded.subjects.into(),
        paths: head.paths,
        authors: head.authors,
        head: head.head,
        file_history: head.file_history,
        head_commit: head.head_commit,
        history_truncated: head.history_truncated,
        span: head.span,
    }
}

fn counts(blocks: &[BlockEntry]) -> (usize, usize) {
    blocks.iter().fold((0, 0), |(c, ch), b| {
        (c + b.commits as usize, ch + b.changes as usize)
    })
}

fn warm(
    ctx: &Context<'_>,
    head: Head,
    changed_rules: Option<&IdentityRules>,
) -> Result<Loaded, Unusable> {
    let generation = head.generation;
    let found = cols::read(ctx.dir, generation, counts(&head.blocks));
    let decoded = if found.is_some() {
        format::Decoded::default()
    } else {
        format::read_blocks(ctx.dir, &head.data_file, &head.blocks)?
    };
    let previous = changed_rules.map(|_| PreviousParts {
        data_file: head.data_file.clone(),
        blocks: head.blocks.clone(),
        id_runs: head.id_runs.clone(),
        ids: format::read_ids(ctx.dir, &head),
    });
    let classify = head.classify.clone();
    let lineage = head.lineage;

    let mut index = index_from(head, decoded);
    let mut kept = found.map(|((commits, changes, subjects), kept)| {
        index.commits = commits;
        index.changes = changes;
        index.subjects = subjects;
        kept
    });
    index.repo = ctx.identity.clone();
    let mut at = Some((ctx.dir.to_path_buf(), generation));
    if let (Some(rules), Some(previous)) = (changed_rules, previous) {
        reresolve_authors(&mut index, rules);
        if let Ok(ids) = previous.ids {
            let written = format::write(format::Writing {
                head: format::head_of(
                    &index,
                    lineage,
                    ctx.fingerprint,
                    ctx.mailmap_fingerprint,
                    classify,
                ),
                previous: Some(format::Previous {
                    data_file: previous.data_file,
                    blocks: previous.blocks,
                    id_runs: previous.id_runs,
                    ids,
                }),
                fresh: format::no_blocks(),
                new_ids: Vec::new(),
                dir: ctx.dir,
            });
            at = written.ok().map(|g| (ctx.dir.to_path_buf(), g));
            if let (Some(k), Some((_, g))) = (kept.as_mut(), at.as_ref()) {
                if k.link_as(ctx.dir, *g).is_err() {
                    kept = None;
                }
            }
        }
    }
    Ok(Loaded {
        index,
        freshness: Freshness::Warm,
        lineage,
        kept: true,
        columns: Columns { at, kept },
        held: None,
    })
}

struct PreviousParts {
    data_file: String,
    blocks: Vec<BlockEntry>,
    id_runs: Vec<format::Extent>,
    ids: Result<SortedIds, Unusable>,
}

fn resume<S: RepoSource>(
    source: &S,
    ctx: Context<'_>,
    head: Head,
    reclassify: bool,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let tips = source.tips()?;
    if !source.all_reachable(&head.frontier, &tips)? {
        return rebuild(source, ctx, RebuildReason::HistoryRewritten, progress);
    }

    let data_file = head.data_file.clone();
    let old_blocks = head.blocks.clone();
    let id_runs = head.id_runs.clone();
    let mut classify = head.classify.clone();
    let lineage = head.lineage;
    let indexed = match format::read_ids(ctx.dir, &head) {
        Ok(ids) => ids,
        Err(_) => return rebuild(source, ctx, RebuildReason::Unreadable, progress),
    };
    let found = cols::read(ctx.dir, head.generation, counts(&old_blocks));
    let decoded = if found.is_some() {
        format::Decoded::default()
    } else {
        match format::read_blocks(ctx.dir, &data_file, &old_blocks) {
            Ok(d) => d,
            Err(_) => return rebuild(source, ctx, RebuildReason::Unreadable, progress),
        }
    };
    let mut base = index_from(head, decoded);
    let mut kept = found.map(|((commits, changes, subjects), kept)| {
        base.commits = commits;
        base.changes = changes;
        base.subjects = subjects;
        kept
    });

    let mut builder = IndexBuilder::resume(base, ctx.rules(source)?);
    let stats = source.walk_history(
        &indexed,
        &mut Reporting {
            builder: &mut builder,
            progress,
        },
    )?;
    let added = builder.commit_count() as u64;
    let changed_from = builder.oldest_pending_time().map(Month::of);

    let new_ids = SortedIds::run_of(builder.added_ids().into_iter());
    let mut merged: Option<cols::Kept> = None;
    let mut index = match kept.take() {
        Some(base_kept) => {
            let dir = ctx.dir;
            builder.finish_merging(
                ctx.identity.clone(),
                tips,
                stats.history_truncated,
                &mut |base, commits, changes, subjects| {
                    let (columns, k) = cols::merge(
                        dir,
                        base,
                        &base_kept.settled,
                        &base_kept.masking,
                        commits,
                        changes,
                        subjects,
                    )
                    .ok()?;
                    merged = Some(k);
                    Some(columns)
                },
            )
        }
        None => builder.finish(ctx.identity.clone(), tips, stats.history_truncated),
    };

    let head_commit = source.head_commit()?;
    if head_commit != index.head_commit || reclassify {
        progress(Progress::HeadFiles);
        let table = head_pass(
            source,
            &index.paths,
            Some(PreviousHead {
                files: &index.head,
                context: &classify,
                commit: index.head_commit,
            }),
        )?;
        index.head = table.files;
        index.head_commit = head_commit;
        classify = table.context;
    }

    let (fresh, unchanged) = match changed_from {
        Some(month) => {
            let split = index.commits.partition_point(|c| Month::of(c.time) < month);
            (
                format::encode_blocks(
                    index.commits.get(split..).unwrap_or(&[]),
                    &index.changes,
                    &index.subjects,
                ),
                old_blocks
                    .iter()
                    .filter(|b| b.month < month)
                    .copied()
                    .collect(),
            )
        }
        None => (format::no_blocks(), old_blocks.clone()),
    };
    let written = format::write(format::Writing {
        head: format::head_of(
            &index,
            lineage,
            ctx.fingerprint,
            ctx.mailmap_fingerprint,
            classify,
        ),
        previous: Some(Previous {
            data_file: data_file.clone(),
            blocks: unchanged,
            id_runs,
            ids: indexed,
        }),
        fresh,
        new_ids,
        dir: ctx.dir,
    })
    .ok();
    if let (Some(k), Some(g)) = (merged.as_mut(), written) {
        if k.settle_as(ctx.dir, g).is_err() {
            merged = None;
        }
    }
    Ok(Loaded {
        index,
        freshness: Freshness::Updated { added },
        lineage,
        kept: written.is_some(),
        columns: Columns {
            at: written.map(|g| (ctx.dir.to_path_buf(), g)),
            kept: merged.filter(|_| written.is_some()),
        },
        held: None,
    })
}

struct Reporting<'a> {
    builder: &'a mut IndexBuilder,
    progress: &'a mut dyn FnMut(Progress),
}

impl CommitSink for Reporting<'_> {
    fn on_commit(&mut self, commit: &RawCommit<'_>, changes: &[RawChange<'_>]) -> ControlFlow<()> {
        self.builder.on_commit(commit, changes)
    }

    fn on_progress(&mut self, done: u64, total: u64) {
        (self.progress)(Progress::History { done, total });
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::source::RawChangeKind::Added;
    use crate::ScriptedRepo;
    use commitscape_core::Oid;

    fn load_in(repo: &ScriptedRepo, root: &Path) -> Loaded {
        let options = CacheOptions {
            root: Some(root.to_path_buf()),
            key: None,
        };
        match load(repo, &options, &mut |_| {}) {
            Ok(l) => l,
            Err(never) => match never {},
        }
    }

    #[test]
    fn a_history_built_through_files_is_the_history_built_in_memory() {
        let blob = |n: u8| Oid([n; 20]);
        let repo = ScriptedRepo::new()
            .commit(
                10,
                ("Ada", "ada@example.com"),
                &[(b"src/a.rs", Added, blob(1))],
            )
            .commit(
                30,
                ("Bob", "bob@example.com"),
                &[(b"src/b.rs", Added, blob(2))],
            )
            .commit(
                20,
                ("Ada", "ada@example.com"),
                &[(b"docs/c.md", Added, blob(3))],
            );
        let dir = tempfile::tempdir().expect("a folder");
        let build_in = |spill: Option<&Path>| match build(
            &repo,
            RepoIdentity {
                git_dir: "/scripted/.git".to_string(),
            },
            IdentityRules::default(),
            &mut |_| {},
            spill,
        ) {
            Ok(built) => built.0,
            Err(never) => match never {},
        };
        let (memory, files) = (build_in(None), build_in(Some(dir.path())));
        assert!(files.changes.is_mapped() && !memory.changes.is_mapped());
        assert_eq!(files, memory);
        assert_eq!(files.commits.len(), 3);
    }

    #[test]
    fn a_cache_classified_by_older_rules_is_classified_again_without_rewalking() {
        let repo = ScriptedRepo::new()
            .commit(
                1_704_067_200,
                ("Alice", "alice@example.com"),
                &[
                    (b"src/lib.rs", Added, Oid([1; 20])),
                    (b"Cargo.lock", Added, Oid([2; 20])),
                ],
            )
            .head_file(b"src/lib.rs", "fn a() {}\n")
            .head_file(b"Cargo.lock", "version = 3\n");
        let dir = tempfile::tempdir().expect("temp dir");
        load_in(&repo, dir.path());
        let read = repo.blobs_read();

        let cache = dir.path().join(
            RepoIdentity {
                git_dir: "/scripted/.git".into(),
            }
            .cache_key(),
        );
        let mut head = format::read_head(&cache).expect("a cache");
        head.classify.version = 0;
        let previous = Previous {
            data_file: head.data_file.clone(),
            blocks: head.blocks.clone(),
            id_runs: head.id_runs.clone(),
            ids: format::read_ids(&cache, &head).expect("ids"),
        };
        format::write(format::Writing {
            head,
            previous: Some(previous),
            fresh: format::no_blocks(),
            new_ids: Vec::new(),
            dir: &cache,
        })
        .expect("rewriting the head");

        let again = load_in(&repo, dir.path());
        assert_eq!(again.freshness, Freshness::Updated { added: 0 });
        assert_eq!(repo.blobs_read() - read, 2, "both files read again");
        let warm = load_in(&repo, dir.path());
        assert_eq!(warm.freshness, Freshness::Warm, "and saved");
    }
}
