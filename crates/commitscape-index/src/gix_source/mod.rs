//! The `gix` [`RepoSource`]. The only module in the workspace that names
//! gitoxide types (ADR-0001).
//!
//! Tree diffs use our own structure-only walk in [`tree_diff`] rather than
//! gix's `Tree::changes()`. That API lives behind gix's `blob-diff` feature,
//! and enabling it would compile blob-diffing machinery into a binary whose
//! central performance decision is that the walk never touches blob contents
//! (ADR-0004). Our walk reads tree objects only, and it also computes the
//! combined diff that merges need, which gix does not offer.

use std::path::{Path, PathBuf};

use commitscape_core::{Oid, RepoIdentity};
use gix::objs::TreeRefIter;

use crate::mailmap::Mailmap;
use crate::source::{BlobSink, CommitSink, HeadChange, HeadEntry, Indexed, RepoSource, WalkStats};

/// Wraps any error into [`GixError::Git`] with a human-facing context.
macro_rules! git_ctx {
    ($expr:expr, $context:literal) => {
        $expr.map_err(|e| $crate::gix_source::GixError::Git {
            context: $context,
            source: Box::new(e),
        })
    };
}

mod blobs;
mod tree_diff;
mod walk;

/// Decompressed objects the main thread keeps while walking the graph.
const OBJECT_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// Reference namespaces that hold history. Everything else is excluded on
/// purpose: `refs/stash` is unpublished work in progress, `refs/notes/*`
/// point at trees of notes rather than source, and `refs/original/*` is
/// history that `filter-branch` rewrote away.
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
    /// A shareable handle, from which each diff thread makes its own.
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

    /// Every history tip as `(name, commit)`, HEAD first.
    fn tips_gix(&self) -> Result<Vec<(String, gix::ObjectId)>, GixError> {
        let mut tips = Vec::new();

        // A detached HEAD is named by no reference, and skipping it would
        // index everything except where the user is actually standing.
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
            // Tags peel to the commit they point at; anything that does not
            // peel to a commit is not a history tip.
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

    /// The work tree's `.mailmap`, if there is a work tree and it has one.
    fn worktree_mailmap(&self) -> Result<Option<Vec<u8>>, GixError> {
        let Some(work_dir) = self.repo.workdir() else {
            return Ok(None);
        };
        match std::fs::read(work_dir.join(".mailmap")) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(GixError::Git {
                context: "reading .mailmap",
                source: Box::new(e),
            }),
        }
    }

    /// The `.mailmap` at HEAD, for a repository with no work tree copy.
    fn mailmap_at_head(&self) -> Result<Option<Vec<u8>>, GixError> {
        let Ok(commit) = self.repo.head_commit() else {
            return Ok(None);
        };
        let tree = git_ctx!(commit.tree(), "reading the HEAD tree")?;
        let entry = git_ctx!(tree.lookup_entry_by_path(".mailmap"), "looking up .mailmap")?;
        let Some(entry) = entry else {
            return Ok(None);
        };
        if !entry.mode().is_blob() {
            return Ok(None);
        }
        let blob = git_ctx!(entry.object(), "reading .mailmap")?;
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
        // HEAD as stored: the branch it names, or the commit it holds when
        // detached. The branch's own target is hashed with the other refs
        // below. Nothing here reads an object, so a warm start never opens a
        // pack.
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
            // The target as stored, unpeeled: a tag's own id rather than the
            // commit it names, so no object is read.
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
        let mut missing: std::collections::HashSet<gix::ObjectId> = commits
            .iter()
            .filter(|c| !from.contains(c))
            .filter_map(|c| Self::to_gix(*c))
            .collect();
        if missing.is_empty() {
            return Ok(true);
        }
        // Walk newest first from `from`, but only down to the age of the
        // oldest missing commit: nothing older can lead to it. A branch that
        // moved forward is found within its new commits, so this costs little
        // in the common case, and it never paints all of history the way a
        // hidden walk from hundreds of tags does.
        let mut cutoff = i64::MAX;
        for id in &missing {
            let Ok(commit) = self.repo.find_commit(*id) else {
                // Gone from the object database: certainly not reachable.
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
        // The work tree's `.mailmap` when there is one, and the committed one
        // otherwise. Parsed by our own parser so that no gix type crosses the
        // seam.
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
        // The committed mailmap is part of HEAD's tree, so HEAD's commit
        // stands for it without reading the tree.
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
            // Directories are implied by their files, and a submodule is a
            // pointer to another repository rather than a file in this one.
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
}
