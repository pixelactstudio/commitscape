use std::path::{Path, PathBuf};

use commitscape_core::{Oid, RepoIdentity};
use gix::objs::TreeRefIter;

use crate::mailmap::Mailmap;
use crate::source::{
    BlameCommit, BlameSource, BlameThreads, BlobSink, CommitSink, HeadChange, HeadEntry, InParent,
    Indexed, LineSink, LineWork, Moves, Parents, RepoSource, WalkStats,
};

macro_rules! git_ctx {
    ($expr:expr, $context:literal) => {
        $expr.map_err(|e| $crate::gix_source::GixError::Git {
            context: $context,
            source: Box::new(e),
        })
    };
}

mod blame;
mod blobs;
mod lines;
mod tree_diff;
mod walk;

const OBJECT_CACHE_BYTES: usize = 64 * 1024 * 1024;

const DELTA_CACHE_BYTES: usize = 128 * 1024 * 1024;

fn with_delta_cache(repo: &mut gix::Repository) {
    repo.objects.set_pack_cache(|| {
        Box::new(gix::odb::pack::cache::lru::MemoryCappedHashmap::new(
            DELTA_CACHE_BYTES,
        ))
    });
}

const HISTORY_REFS: &[&[u8]] = &[b"refs/heads/", b"refs/remotes/", b"refs/tags/"];

#[derive(Debug, thiserror::Error)]
pub enum GixError {
    #[error("no git repository at {path}")]
    NotARepository {
        path: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },
    #[error("the repository at {path} has no commits yet")]
    NoCommits { path: String },
    #[error("this repository uses SHA-256 object ids, which commitscape does not support yet")]
    UnsupportedHash,
    #[error("failed while {context}")]
    Git {
        context: &'static str,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

pub struct GixRepo {
    repo: gix::Repository,
    sync: gix::ThreadSafeRepository,
    path: PathBuf,
}

impl GixRepo {
    pub fn open(path: &Path) -> Result<Self, GixError> {
        let mut repo = gix::open(path).map_err(|e| GixError::NotARepository {
            path: path.display().to_string(),
            source: Box::new(e),
        })?;
        repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        let sync = repo.clone().into_sync();
        with_delta_cache(&mut repo);
        Ok(GixRepo {
            repo,
            sync,
            path: path.to_path_buf(),
        })
    }

    fn to_oid(id: &gix::hash::oid) -> Result<Oid, GixError> {
        Oid::from_bytes(id.as_bytes()).ok_or(GixError::UnsupportedHash)
    }

    fn to_gix(id: Oid) -> Option<gix::ObjectId> {
        gix::ObjectId::try_from(id.0.as_slice()).ok()
    }

    /// Whether this is a partial clone, whose missing objects its remote promises.
    pub fn is_partial(&self) -> bool {
        let config = self.repo.config_snapshot();
        config.string("extensions.partialClone").is_some()
            || config.boolean("remote.origin.promisor") == Some(true)
    }

    /// Every commit reachable from the given ones, or None when one of them is not in this repository.
    pub fn ancestors(
        &self,
        from: &[Oid],
    ) -> Result<Option<std::collections::HashSet<Oid>>, GixError> {
        let mut starts = Vec::with_capacity(from.len());
        for id in from {
            let Some(id) = Self::to_gix(*id) else {
                return Ok(None);
            };
            if self.repo.find_commit(id).is_err() {
                return Ok(None);
            }
            starts.push(id);
        }
        let mut out = std::collections::HashSet::new();
        if starts.is_empty() {
            return Ok(Some(out));
        }
        let walk = git_ctx!(
            self.repo.rev_walk(starts).all(),
            "walking the commits already exported"
        )?;
        for info in walk {
            let info = git_ctx!(info, "walking the commits already exported")?;
            out.insert(Self::to_oid(info.id.as_ref())?);
        }
        Ok(Some(out))
    }

    pub fn version_tags(&self) -> Vec<(String, i64)> {
        self.release_tags()
            .into_iter()
            .map(|(name, time, _)| (name, time))
            .collect()
    }

    /// The tags named by a version, each with its commit's time and the commit it points at, peeled through annotated tags, oldest first.
    pub fn release_tags(&self) -> Vec<(String, i64, Oid)> {
        let Ok(platform) = self.repo.references() else {
            return Vec::new();
        };
        let Ok(tags) = platform.tags() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for mut reference in tags.flatten() {
            let name = reference.name().shorten().to_string();
            if !is_release(&name) {
                continue;
            }
            let Ok(id) = reference.peel_to_id() else {
                continue;
            };
            let Ok(commit) = self.repo.find_commit(id.detach()) else {
                continue;
            };
            let (Ok(time), Ok(oid)) = (commit.time(), Self::to_oid(commit.id.as_ref())) else {
                continue;
            };
            out.push((name, time.seconds, oid));
        }
        out.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        out
    }

    fn tips_gix(&self) -> Result<Vec<(String, gix::ObjectId)>, GixError> {
        let mut tips = Vec::new();

        if let Ok(id) = self.repo.head_id() {
            tips.push(("HEAD".to_string(), id.detach()));
        }

        let platform = git_ctx!(self.repo.references(), "opening references")?;
        let all = git_ctx!(platform.all(), "listing references")?;
        for mut reference in all.flatten() {
            let name = reference.name().as_bstr().to_vec();
            if !HISTORY_REFS.iter().any(|p| name.starts_with(p)) {
                continue;
            }
            let Ok(id) = reference.peel_to_id() else {
                continue;
            };
            let id = id.detach();
            let is_commit = self
                .repo
                .find_header(id)
                .map(|h| h.kind().is_commit())
                .unwrap_or(false);
            if is_commit {
                tips.push((String::from_utf8_lossy(&name).into_owned(), id));
            }
        }
        if tips.is_empty() {
            return Err(GixError::NoCommits {
                path: self.path.display().to_string(),
            });
        }
        Ok(tips)
    }

    fn worktree_mailmap(&self) -> Result<Option<Vec<u8>>, GixError> {
        self.worktree_file(".mailmap")
    }

    fn mailmap_at_head(&self) -> Result<Option<Vec<u8>>, GixError> {
        self.file_at_head(".mailmap")
    }

    fn worktree_file(&self, name: &str) -> Result<Option<Vec<u8>>, GixError> {
        let Some(work_dir) = self.repo.workdir() else {
            return Ok(None);
        };
        match std::fs::read(work_dir.join(name)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(GixError::Git {
                context: "reading a file in the work tree",
                source: Box::new(e),
            }),
        }
    }

    fn file_at_head(&self, name: &str) -> Result<Option<Vec<u8>>, GixError> {
        let Ok(commit) = self.repo.head_commit() else {
            return Ok(None);
        };
        let tree = git_ctx!(commit.tree(), "reading the HEAD tree")?;
        let entry = git_ctx!(tree.lookup_entry_by_path(name), "looking up a file at HEAD")?;
        let Some(entry) = entry else {
            return Ok(None);
        };
        if !entry.mode().is_blob() {
            return Ok(None);
        }
        let blob = git_ctx!(entry.object(), "reading a file at HEAD")?;
        Ok(Some(blob.data.clone()))
    }
}

impl RepoSource for GixRepo {
    type Error = GixError;

    fn identity(&self) -> Result<RepoIdentity, Self::Error> {
        let git_dir = self
            .repo
            .path()
            .canonicalize()
            .unwrap_or_else(|_| self.repo.path().to_path_buf())
            .display()
            .to_string();
        Ok(RepoIdentity { git_dir })
    }

    fn tips(&self) -> Result<Vec<Oid>, Self::Error> {
        let mut tips = self
            .tips_gix()?
            .into_iter()
            .map(|(_, id)| Self::to_oid(id.as_ref()))
            .collect::<Result<Vec<_>, _>>()?;
        tips.sort_unstable();
        tips.dedup();
        Ok(tips)
    }

    fn refs_fingerprint(&self) -> Result<u64, Self::Error> {
        let mut h = xxhash_rust::xxh3::Xxh3::new();
        match git_ctx!(self.repo.head(), "reading HEAD")?.kind {
            gix::head::Kind::Symbolic(r) => {
                h.update(b"S");
                h.update(r.name.as_bstr());
            }
            gix::head::Kind::Unborn(name) => {
                h.update(b"U");
                h.update(name.as_bstr());
            }
            gix::head::Kind::Detached { target, .. } => {
                h.update(b"D");
                h.update(target.as_bytes());
            }
        }
        let platform = git_ctx!(self.repo.references(), "opening references")?;
        let all = git_ctx!(platform.all(), "listing references")?;
        let mut refs: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        for reference in all.flatten() {
            let name = reference.name().as_bstr().to_vec();
            if !HISTORY_REFS.iter().any(|p| name.starts_with(p)) {
                continue;
            }
            let target = match reference.target() {
                gix::refs::TargetRef::Object(id) => id.as_bytes().to_vec(),
                gix::refs::TargetRef::Symbolic(name) => name.as_bstr().to_vec(),
            };
            refs.push((name, target));
        }
        refs.sort_unstable();
        for (name, target) in refs {
            h.update(&(name.len() as u64).to_le_bytes());
            h.update(&name);
            h.update(&target);
        }
        Ok(h.digest())
    }

    fn all_reachable(&self, commits: &[Oid], from: &[Oid]) -> Result<bool, Self::Error> {
        let mut missing: gix::hashtable::HashSet = commits
            .iter()
            .filter(|c| !from.contains(c))
            .filter_map(|c| Self::to_gix(*c))
            .collect();
        if missing.is_empty() {
            return Ok(true);
        }
        let mut cutoff = i64::MAX;
        for id in &missing {
            let Ok(commit) = self.repo.find_commit(*id) else {
                return Ok(false);
            };
            let time = git_ctx!(commit.time(), "reading a commit time")?;
            cutoff = cutoff.min(time.seconds);
        }
        let starts: Vec<gix::ObjectId> = from.iter().filter_map(|c| Self::to_gix(*c)).collect();
        let walk = git_ctx!(
            self.repo
                .rev_walk(starts)
                .sorting(gix::revision::walk::Sorting::ByCommitTimeCutoff {
                    order: Default::default(),
                    seconds: cutoff,
                })
                .all(),
            "checking which indexed commits are still reachable"
        )?;
        for info in walk {
            let info = git_ctx!(info, "checking which indexed commits are still reachable")?;
            missing.remove(&info.id);
            if missing.is_empty() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn mailmap(&self) -> Result<Mailmap, Self::Error> {
        if let Some(bytes) = self.worktree_mailmap()? {
            return Ok(Mailmap::parse(&bytes));
        }
        Ok(self
            .mailmap_at_head()?
            .map(|bytes| Mailmap::parse(&bytes))
            .unwrap_or_default())
    }

    fn mailmap_fingerprint(&self) -> Result<u64, Self::Error> {
        if let Some(bytes) = self.worktree_mailmap()? {
            return Ok(Mailmap::parse(&bytes).fingerprint());
        }
        let mut h = xxhash_rust::xxh3::Xxh3::new();
        h.update(b"head");
        if let Ok(Some(r)) = self.repo.head_ref() {
            if let Some(id) = r.target().try_id() {
                h.update(id.as_bytes());
            }
        } else if let Ok(head) = self.repo.head() {
            if let gix::head::Kind::Detached { target, .. } = head.kind {
                h.update(target.as_bytes());
            }
        }
        Ok(h.digest())
    }

    fn remote_url(&self) -> Option<String> {
        let direction = gix::remote::Direction::Fetch;
        let remote = self.repo.find_default_remote(direction)?.ok()?;
        Some(remote.url(direction)?.to_bstring().to_string())
    }

    fn walk_history(
        &self,
        indexed: &dyn Indexed,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error> {
        walk::walk(self, indexed, sink)
    }

    fn head_commit(&self) -> Result<Option<Oid>, Self::Error> {
        match self.repo.head_id() {
            Ok(id) => Ok(Some(Self::to_oid(id.as_ref())?)),
            Err(_) => Ok(None),
        }
    }

    fn head_files(&self) -> Result<Vec<HeadEntry>, Self::Error> {
        let head = git_ctx!(self.repo.head_commit(), "resolving HEAD")?;
        let tree = git_ctx!(head.tree(), "reading the HEAD tree")?;
        let mut recorder = gix::traverse::tree::Recorder::default();
        git_ctx!(
            gix::traverse::tree::breadthfirst(
                TreeRefIter::from_bytes(&tree.data, self.repo.object_hash()),
                gix::traverse::tree::breadthfirst::State::default(),
                &self.repo.objects,
                &mut recorder,
            ),
            "walking the HEAD tree"
        )?;
        let mut files = Vec::with_capacity(recorder.records.len());
        for entry in recorder.records {
            if !entry.mode.is_blob_or_symlink() {
                continue;
            }
            files.push(HeadEntry {
                path: entry.filepath.into(),
                blob: Self::to_oid(entry.oid.as_ref())?,
                symlink: entry.mode.is_link(),
            });
        }
        Ok(files)
    }

    fn head_changes(&self, since: Oid) -> Result<Option<Vec<HeadChange>>, Self::Error> {
        let Some(since) = Self::to_gix(since) else {
            return Ok(None);
        };
        let Ok(old) = self.repo.find_commit(since) else {
            return Ok(None);
        };
        let old_tree = git_ctx!(old.tree_id(), "reading an earlier HEAD tree")?.detach();
        let head = git_ctx!(self.repo.head_commit(), "resolving HEAD")?;
        let tree = git_ctx!(head.tree_id(), "reading the HEAD tree")?.detach();

        let mut differ = tree_diff::TreeDiffer::new(self.repo.object_hash());
        let mut changed = Vec::new();
        differ
            .diff(&self.repo.objects, tree, &[Some(old_tree)], &mut changed)
            .map_err(|source| GixError::Git {
                context: "comparing HEAD with the tree last measured",
                source,
            })?;
        changed
            .into_iter()
            .map(|c| {
                Ok(HeadChange {
                    entry: HeadEntry {
                        path: c.path,
                        blob: Self::to_oid(c.blob.as_ref())?,
                        symlink: c.symlink,
                    },
                    kind: c.kind,
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some)
    }

    fn read_blobs(&self, blobs: &[Oid], sink: BlobSink<'_>) -> Result<(), Self::Error> {
        blobs::read(self, blobs, sink)
    }

    fn count_lines(
        &self,
        work: &[LineWork<'_>],
        until: Option<std::time::Instant>,
        sink: LineSink<'_>,
    ) -> Result<(), Self::Error> {
        lines::count(self, work, until, sink)
    }

    fn head_history(
        &self,
        visit: &mut dyn FnMut(Oid, i64, &[Oid]),
    ) -> Result<Option<Oid>, Self::Error> {
        let Ok(head) = self.repo.head_id() else {
            return Ok(None);
        };
        let head = head.detach();
        let walk = git_ctx!(
            self.repo
                .rev_walk([head])
                .sorting(gix::revision::walk::Sorting::ByCommitTime(
                    Default::default()
                ))
                .all(),
            "walking the history HEAD reaches"
        )?;
        let mut parents = Vec::new();
        for info in walk {
            let info = git_ctx!(info, "walking the history HEAD reaches")?;
            parents.clear();
            for p in &info.parent_ids {
                parents.push(Self::to_oid(p.as_ref())?);
            }
            let time = match info.commit_time {
                Some(t) => t,
                None => {
                    let commit = git_ctx!(self.repo.find_commit(info.id), "reading a commit")?;
                    git_ctx!(commit.time(), "reading a commit time")?.seconds
                }
            };
            visit(Self::to_oid(info.id.as_ref())?, time, &parents);
        }
        Ok(Some(Self::to_oid(head.as_ref())?))
    }

    fn history_parents(&self, visit: &mut dyn FnMut(Oid, &[Oid])) -> Result<(), Self::Error> {
        let tips: Vec<gix::ObjectId> = self.tips_gix()?.into_iter().map(|(_, id)| id).collect();
        if tips.is_empty() {
            return Ok(());
        }
        let walk = git_ctx!(
            self.repo.rev_walk(tips).all(),
            "walking the history the refs reach"
        )?;
        let mut parents = Vec::new();
        for info in walk {
            let info = git_ctx!(info, "walking the history the refs reach")?;
            parents.clear();
            for p in &info.parent_ids {
                parents.push(Self::to_oid(p.as_ref())?);
            }
            visit(Self::to_oid(info.id.as_ref())?, &parents);
        }
        Ok(())
    }

    fn parents_of(&self, ids: &[Oid]) -> Result<Vec<Option<Parents>>, Self::Error> {
        let time_of = |id: gix::ObjectId| -> Result<Option<i64>, GixError> {
            let Ok(commit) = self.repo.find_commit(id) else {
                return Ok(None);
            };
            Ok(Some(
                git_ctx!(commit.time(), "reading a commit time")?.seconds,
            ))
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let Some(found) = Self::to_gix(*id).and_then(|id| self.repo.find_commit(id).ok())
            else {
                out.push(None);
                continue;
            };
            let mut parents = Vec::new();
            for p in found.parent_ids() {
                let Some(time) = time_of(p.detach())? else {
                    parents.clear();
                    break;
                };
                parents.push((Self::to_oid(p.as_ref())?, time));
            }
            out.push((parents.len() == found.parent_ids().count()).then_some(parents));
        }
        Ok(out)
    }

    fn blame_ignore_revs(&self) -> Result<Vec<Oid>, Self::Error> {
        const NAME: &str = ".git-blame-ignore-revs";
        let text = match self.worktree_file(NAME)? {
            Some(t) => Some(t),
            None => self.file_at_head(NAME)?,
        };
        let Some(text) = text else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for name in crate::lines::ignore_rev_names(&text) {
            if let Some(id) = Oid::from_hex(&name) {
                out.push(id);
                continue;
            }
            let Ok(id) = self.repo.rev_parse_single(name.as_str()) else {
                continue;
            };
            let Ok(object) = id.object() else {
                continue;
            };
            if object.kind.is_commit() {
                out.push(Self::to_oid(object.id.as_ref())?);
            }
        }
        Ok(out)
    }
}

pub struct GixThreads {
    sync: gix::ThreadSafeRepository,
    path: PathBuf,
}

impl GixRepo {
    pub fn threads(&self) -> GixThreads {
        GixThreads {
            sync: self.sync.clone(),
            path: self.path.clone(),
        }
    }
}

impl BlameThreads for GixThreads {
    type Local = GixRepo;

    fn local(&self) -> GixRepo {
        let mut repo = self.sync.to_thread_local();
        repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        with_delta_cache(&mut repo);
        GixRepo {
            repo,
            sync: self.sync.clone(),
            path: self.path.clone(),
        }
    }
}

impl BlameSource for GixRepo {
    type Error = GixError;

    fn blame_commit(&self, id: Oid) -> Result<Option<BlameCommit>, Self::Error> {
        blame::commit(self, id)
    }

    fn blame_compare(
        &self,
        commit: Oid,
        parent: Oid,
        paths: &[&[u8]],
    ) -> Result<Vec<InParent>, Self::Error> {
        blame::compare(self, commit, parent, paths)
    }

    fn blame_moves(&self, commit: Oid, parent: Oid) -> Result<Moves, Self::Error> {
        blame::moves(self, commit, parent)
    }

    fn blame_blob(&self, blob: Oid) -> Result<Vec<u8>, Self::Error> {
        blame::blob(self, blob)
    }
}

fn is_release(name: &str) -> bool {
    let bare = name.strip_prefix(['v', 'V']).unwrap_or(name);
    let lower = bare.to_ascii_lowercase();
    bare.starts_with(|c: char| c.is_ascii_digit())
        && bare.contains('.')
        && !["rc", "alpha", "beta", "pre", "dev", "nightly"]
            .iter()
            .any(|w| lower.contains(w))
}
