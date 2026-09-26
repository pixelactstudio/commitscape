//! The cache: ADR-0002's time-sliced read, frontier resume and rebuild rules,
//! behind one call.
//!
//! [`load`] decides everything:
//!
//! - **Warm.** The refs fingerprint matches the cache's, so nothing moved.
//!   Read the head in full and, from the body, only the months the requested
//!   window needs. No commit or tree is read from the repository.
//! - **Updated.** Refs moved. If every cached tip is still reachable, walk only
//!   the commits the cache cannot reach, merge them in, and save. A merge that
//!   brings in older-dated commits pulls in the months they land in first.
//! - **Built.** No cache, a different format, damage of any kind, or history
//!   rewritten under the cache: index from scratch and save. None of these is
//!   an error the user sees.

mod format;
mod identity_store;
mod line_store;
mod location;

use std::ops::ControlFlow;
use std::path::{Path, PathBuf};

use commitscape_core::{CommitMeta, FileChange, Index, Month, RepoIdentity};

use crate::build::IndexBuilder;
use crate::head_pass::{head_pass, ClassifyContext, Previous as PreviousHead};
use crate::identity::IdentityRules;
use crate::reresolve_authors;
use crate::source::{CommitSink, RawChange, RawCommit, RepoSource};
use format::{BlockEntry, Head, Previous, SortedIds, Unusable};

pub use identity_store::IdentityStore;
pub use line_store::LineStore;
pub use location::default_cache_root;

/// The directory holding one repository's cache and what is kept beside
/// it, or `None` when caching is off.
pub fn repo_dir(options: &CacheOptions, repo: &RepoIdentity) -> Option<PathBuf> {
    Some(options.root.as_deref()?.join(repo.cache_key()))
}

/// Where to keep the cache.
#[derive(Debug, Clone, Default)]
pub struct CacheOptions {
    /// Directory holding every repository's cache, one subdirectory each.
    /// `None` disables the cache: nothing is read or written.
    pub root: Option<PathBuf>,
}

/// How much history to load before returning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Since {
    /// All of it.
    All,
    /// Every commit at or after this time. Older history is left for
    /// [`Loaded::take_rest`].
    Time(i64),
    /// Every commit within this many seconds of the newest commit. This is
    /// how `--json` anchors windows, so its output is reproducible.
    BeforeNewest(i64),
}

/// How a load got its index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    /// Read from the cache. Nothing had changed.
    Warm,
    /// Read from the cache and brought up to date with this many commits.
    Updated { added: u64 },
    /// Indexed from scratch.
    Built { reason: RebuildReason },
}

/// Why a load indexed from scratch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RebuildReason {
    /// Caching was turned off.
    Disabled,
    /// There was no cache for this repository yet.
    NoCache,
    /// The cache was written by a different version of the format.
    SchemaChanged,
    /// The cache was damaged, truncated, or half-written.
    Unreadable,
    /// Commits the cache recorded are no longer reachable: a force-push, a
    /// rebase of a published branch, or a deleted unmerged branch.
    HistoryRewritten,
}

/// Progress of a load that has to read the repository.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// Commits diffed so far, of the total this walk will diff.
    History { done: u64, total: u64 },
    /// Reading and measuring the files at HEAD.
    HeadFiles,
}

/// The result of [`load`].
pub struct Loaded {
    pub index: Index,
    pub freshness: Freshness,
    rest: Option<Rest>,
}

impl Loaded {
    fn complete(index: Index, freshness: Freshness) -> Self {
        Loaded {
            index,
            freshness,
            rest: None,
        }
    }

    /// The older history a time-sliced load left behind, if any. Loading it
    /// is independent of the index, so it can happen on another thread while
    /// the recent part is already in use.
    pub fn take_rest(&mut self) -> Option<Rest> {
        self.rest.take()
    }
}

/// Older history not yet read.
#[derive(Debug)]
pub struct Rest {
    dir: PathBuf,
    data_file: String,
    blocks: Vec<BlockEntry>,
}

/// Older history, read by [`Rest::load`].
#[derive(Debug)]
pub struct OlderHistory {
    commits: Vec<CommitMeta>,
    changes: Vec<FileChange>,
    subjects: Vec<u8>,
}

/// The older history could not be read: the cache was damaged, or replaced
/// by another process in the meantime. The next load detects either and
/// rebuilds if it has to.
#[derive(Debug, thiserror::Error)]
#[error("older history could not be read from the cache")]
pub struct RestUnavailable;

impl Rest {
    pub fn load(self) -> Result<OlderHistory, RestUnavailable> {
        format::read_blocks(&self.dir, &self.data_file, &self.blocks)
            .map(|decoded| OlderHistory {
                commits: decoded.commits,
                changes: decoded.changes,
                subjects: decoded.subjects,
            })
            .map_err(|_| RestUnavailable)
    }

    /// Reads the older history and returns a copy of `recent` completed with
    /// it, leaving `recent` as it was: an interface showing `recent` keeps
    /// using it while this runs on another thread.
    pub fn complete(self, recent: &Index) -> Result<Index, RestUnavailable> {
        let older = self.load()?;
        let mut full = recent.clone();
        older.prepend_to(&mut full);
        Ok(full)
    }
}

impl OlderHistory {
    /// Completes an index loaded with [`Since::Time`] or
    /// [`Since::BeforeNewest`].
    pub fn prepend_to(self, index: &mut Index) {
        index.prepend_history(self.commits, self.changes, self.subjects, None);
    }
}

/// Loads a repository's index, from the cache where it can.
pub fn load<S: RepoSource>(
    source: &S,
    options: &CacheOptions,
    since: Since,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let identity = source.identity()?;
    let Some(root) = options.root.as_deref() else {
        let rules = IdentityRules::from_mailmap(source.mailmap()?);
        let (index, _) = build(source, identity, rules, progress)?;
        return Ok(Loaded::complete(
            index,
            Freshness::Built {
                reason: RebuildReason::Disabled,
            },
        ));
    };
    let dir = root.join(identity.cache_key());
    // Before any walk: if refs move during it, the next run sees a
    // different fingerprint and resumes rather than trusting this one.
    let fingerprint = source.refs_fingerprint()?;
    // People are resolved from the mailmap and the identity store together,
    // so a change to either re-resolves them.
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
        Ok(head) if head.repo == ctx.identity => head,
        Ok(_) | Err(Unusable::Damaged) => {
            return rebuild(source, ctx, RebuildReason::Unreadable, progress)
        }
        Err(Unusable::Missing) => return rebuild(source, ctx, RebuildReason::NoCache, progress),
        Err(Unusable::OtherSchema) => {
            return rebuild(source, ctx, RebuildReason::SchemaChanged, progress)
        }
    };

    // Rules for Generated Files improved since this cache was written: the
    // HEAD table is classified again, and history is kept.
    let reclassify = head.classify.version != crate::classify::CLASSIFIER_VERSION;
    if head.refs_fingerprint == fingerprint && !reclassify {
        // Only changed rules need reading; unchanged ones are already applied
        // in the cached author table.
        let rules = if head.mailmap_fingerprint == ctx.mailmap_fingerprint {
            None
        } else {
            Some(ctx.rules(source)?)
        };
        let r = warm(&ctx, head, since, rules.as_ref());
        return match r {
            Ok(loaded) => Ok(loaded),
            Err(_) => rebuild(source, ctx, RebuildReason::Unreadable, progress),
        };
    }
    resume(source, ctx, head, since, reclassify, progress)
}

/// What every path through [`load`] needs.
struct Context<'a> {
    dir: &'a Path,
    identity: RepoIdentity,
    fingerprint: u64,
    /// The mailmap's and the identity store's, together.
    mailmap_fingerprint: u64,
    /// The identity store's contents, with an empty mailmap.
    stored: IdentityRules,
}

impl Context<'_> {
    /// The rules people are resolved with: the repository's mailmap and what
    /// the identity store holds.
    fn rules<S: RepoSource>(&self, source: &S) -> Result<IdentityRules, S::Error> {
        Ok(IdentityRules {
            mailmap: source.mailmap()?,
            ..self.stored.clone()
        })
    }
}

/// Indexes from scratch: every commit, then every file at HEAD. Returns the
/// index and what its HEAD table was classified with.
fn build<S: RepoSource>(
    source: &S,
    identity: RepoIdentity,
    rules: IdentityRules,
    progress: &mut dyn FnMut(Progress),
) -> Result<(Index, ClassifyContext), S::Error> {
    let mut builder = IndexBuilder::new(rules);
    let stats = source.walk_history(
        &std::collections::HashSet::new(),
        &mut Reporting {
            builder: &mut builder,
            progress,
        },
    )?;
    let tips = source.tips()?;
    let mut index = builder.finish(identity, tips, stats.history_truncated);
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
    let (index, classify) = build(source, ctx.identity.clone(), ctx.rules(source)?, progress)?;
    let head = format::head_of(&index, ctx.fingerprint, ctx.mailmap_fingerprint, classify);
    // A cache that cannot be written is a slower next run, not an error.
    let _ = format::write(format::Writing {
        head,
        previous: None,
        fresh: format::encode_blocks(&index.commits, &index.changes, &index.subjects),
        new_ids: SortedIds::run_of(index.commits.iter().map(|c| c.id)),
        dir: ctx.dir,
    });
    Ok(Loaded::complete(index, Freshness::Built { reason }))
}

/// The time a `since` means, given the newest commit.
fn resolve_since(since: Since, newest: Option<i64>) -> Option<i64> {
    match since {
        Since::All => None,
        Since::Time(t) => Some(t),
        Since::BeforeNewest(seconds) => newest.map(|n| n.saturating_sub(seconds)),
    }
}

/// The first block a read starting at `time` needs, and the time from which
/// the read is complete.
fn first_block(blocks: &[BlockEntry], time: Option<i64>) -> (usize, Option<i64>) {
    let Some(time) = time else {
        return (0, None);
    };
    let month = Month::of(time);
    let first = blocks.partition_point(|b| b.month < month);
    if first == 0 {
        (0, None)
    } else {
        // Loading starts at the month containing `time`, so everything from
        // that month's first second is present.
        (first, Some(month.start()))
    }
}

/// An index assembled from a head and some decoded blocks.
fn index_from(head: Head, decoded: format::Decoded, loaded_from: Option<i64>) -> Index {
    Index {
        schema_version: head.schema_version,
        repo: head.repo,
        frontier: head.frontier,
        commits: decoded.commits,
        changes: decoded.changes,
        subjects: decoded.subjects,
        paths: head.paths,
        authors: head.authors,
        head: head.head,
        file_history: head.file_history,
        head_commit: head.head_commit,
        history_truncated: head.history_truncated,
        span: head.span,
        loaded_from,
    }
}

fn warm(
    ctx: &Context<'_>,
    head: Head,
    since: Since,
    changed_rules: Option<&IdentityRules>,
) -> Result<Loaded, Unusable> {
    let (first, loaded_from) = first_block(&head.blocks, resolve_since(since, head.span.newest));
    let decoded = format::read_blocks(
        ctx.dir,
        &head.data_file,
        head.blocks.get(first..).unwrap_or(&[]),
    )?;
    let mut rest = Rest {
        dir: ctx.dir.to_path_buf(),
        data_file: head.data_file.clone(),
        blocks: head.blocks.get(..first).unwrap_or(&[]).to_vec(),
    };
    let previous = changed_rules.map(|_| PreviousParts {
        data_file: head.data_file.clone(),
        blocks: head.blocks.clone(),
        id_runs: head.id_runs.clone(),
        ids: format::read_ids(ctx.dir, &head),
    });
    let classify = head.classify.clone();

    let mut index = index_from(head, decoded, loaded_from);
    if let (Some(rules), Some(previous)) = (changed_rules, previous) {
        reresolve_authors(&mut index, rules);
        // Only the author table changed, so only a new head is written; the
        // history it points at is untouched. Failing to save only costs the
        // next run another re-resolve.
        if let Ok(ids) = previous.ids {
            let written = format::write(format::Writing {
                head: format::head_of(
                    &index,
                    ctx.fingerprint,
                    ctx.mailmap_fingerprint,
                    classify.clone(),
                ),
                previous: Some(format::Previous {
                    data_file: previous.data_file,
                    blocks: previous.blocks,
                    id_runs: previous.id_runs,
                    ids,
                }),
                fresh: Vec::new(),
                new_ids: Vec::new(),
                dir: ctx.dir,
            });
            if let Ok((data_file, blocks)) = written {
                rest.data_file = data_file;
                rest.blocks = blocks.get(..first).unwrap_or(&[]).to_vec();
            }
        }
    }
    Ok(Loaded {
        index,
        freshness: Freshness::Warm,
        rest: (first > 0).then_some(rest),
    })
}

/// A write's view of the previous one, before its ids are read.
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
    since: Since,
    reclassify: bool,
    progress: &mut dyn FnMut(Progress),
) -> Result<Loaded, S::Error> {
    let tips = source.tips()?;
    if !source.all_reachable(&head.frontier, &tips)? {
        return rebuild(source, ctx, RebuildReason::HistoryRewritten, progress);
    }

    let (mut first, loaded_from) =
        first_block(&head.blocks, resolve_since(since, head.span.newest));
    let data_file = head.data_file.clone();
    let old_blocks = head.blocks.clone();
    let id_runs = head.id_runs.clone();
    let mut classify = head.classify.clone();
    let indexed = match format::read_ids(ctx.dir, &head) {
        Ok(ids) => ids,
        Err(_) => return rebuild(source, ctx, RebuildReason::Unreadable, progress),
    };
    let decoded =
        match format::read_blocks(ctx.dir, &data_file, old_blocks.get(first..).unwrap_or(&[])) {
            Ok(d) => d,
            Err(_) => return rebuild(source, ctx, RebuildReason::Unreadable, progress),
        };
    let base = index_from(head, decoded, loaded_from);

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

    // A long-lived branch merged late can bring commits older than anything
    // loaded. The months they land in must be loaded before merging, so the
    // re-sort covers them.
    if let Some(month) = changed_from {
        let (needed, needed_from) = first_block(&old_blocks, Some(month.start()));
        if needed < first {
            let older = match format::read_blocks(
                ctx.dir,
                &data_file,
                old_blocks.get(needed..first).unwrap_or(&[]),
            ) {
                Ok(d) => d,
                Err(_) => return rebuild(source, ctx, RebuildReason::Unreadable, progress),
            };
            builder.prepend_base(older.commits, older.changes, older.subjects, needed_from);
            first = needed;
        }
    }

    let new_ids = SortedIds::run_of(builder.added_ids().into_iter());
    let mut index = builder.finish(ctx.identity.clone(), tips, stats.history_truncated);

    // HEAD usually moved with the refs. Files whose path and blob are
    // unchanged are carried over; only the rest are read.
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

    // Only the months the new commits landed in are re-encoded and
    // appended; every other month stays where it is in the data file.
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
        None => (Vec::new(), old_blocks.clone()),
    };
    let written = format::write(format::Writing {
        head: format::head_of(&index, ctx.fingerprint, ctx.mailmap_fingerprint, classify),
        previous: Some(Previous {
            data_file: data_file.clone(),
            blocks: unchanged,
            id_runs,
            ids: indexed,
        }),
        fresh,
        new_ids,
        dir: ctx.dir,
    });
    let rest = (first > 0).then(|| match written {
        Ok((data_file, blocks)) => Rest {
            dir: ctx.dir.to_path_buf(),
            data_file,
            blocks: blocks.get(..first).unwrap_or(&[]).to_vec(),
        },
        // Nothing was replaced, so the previous data file still holds them.
        Err(_) => Rest {
            dir: ctx.dir.to_path_buf(),
            data_file,
            blocks: old_blocks.get(..first).unwrap_or(&[]).to_vec(),
        },
    });

    Ok(Loaded {
        index,
        freshness: Freshness::Updated { added },
        rest,
    })
}

/// Passes commits to the builder and progress to the caller.
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
        };
        match load(repo, &options, Since::All, &mut |_| {}) {
            Ok(l) => l,
            Err(never) => match never {},
        }
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

        // Stamp the cache as classified by an earlier version of the rules.
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
            fresh: Vec::new(),
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
