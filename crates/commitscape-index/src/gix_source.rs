//! The `gix` [`RepoSource`]. The only file in the workspace that names gitoxide
//! types (ADR-0001).
//!
//! Note which diff API this uses: `gix::diff::tree`, the structure-only one.
//! The ergonomic `Tree::changes()` API lives behind gix's `blob-diff` feature,
//! and enabling that would compile blob-diffing machinery into a binary whose
//! central performance decision is that the walk never touches blob contents
//! (ADR-0004). The lower-level API is not merely sufficient here, it is the one
//! that makes the constraint structural.

use std::ops::ControlFlow;
use std::path::{Path, PathBuf};

use commitscape_core::{Oid, RepoIdentity};
use gix::diff::tree::recorder::Change as TreeChange;
use gix::objs::TreeRefIter;

use crate::mailmap::Mailmap;
use crate::source::{
    CommitSink, Frontier, RawChange, RawChangeKind, RawCommit, RepoSource, TreeSink, WalkStats,
};

/// How much decompressed object data to keep around during the walk. Tree
/// diffing revisits parent trees constantly, so this is the difference between
/// re-inflating the same objects and not.
const OBJECT_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// How often to report progress during a long cold index.
const PROGRESS_EVERY: u64 = 4096;

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

/// Wraps any error into [`GixError::Git`] with a human-facing context.
macro_rules! git_ctx {
    ($expr:expr, $context:literal) => {
        $expr.map_err(|e| GixError::Git {
            context: $context,
            source: Box::new(e),
        })
    };
}

pub struct GixRepo {
    repo: gix::Repository,
    path: PathBuf,
}

impl GixRepo {
    pub fn open(path: &Path) -> Result<Self, GixError> {
        let mut repo = gix::open(path).map_err(|e| GixError::NotARepository {
            path: path.display().to_string(),
            source: Box::new(e),
        })?;
        repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        Ok(GixRepo {
            repo,
            path: path.to_path_buf(),
        })
    }

    fn to_oid(id: &gix::hash::oid) -> Result<Oid, GixError> {
        Oid::from_bytes(id.as_bytes()).ok_or(GixError::UnsupportedHash)
    }

    fn to_gix(id: Oid) -> Option<gix::ObjectId> {
        gix::ObjectId::try_from(id.0.as_slice()).ok()
    }

    /// The oldest reachable commit with no parents, used to key the cache.
    fn oldest_root_commit(&self) -> Result<Option<Oid>, GixError> {
        let Ok(head) = self.repo.head_id() else {
            return Ok(None);
        };
        let Ok(walk) = self.repo.rev_walk(Some(head.detach())).all() else {
            return Ok(None);
        };
        let mut oldest = None;
        for info in walk.flatten() {
            if info.parent_ids.is_empty() {
                oldest = Some(Self::to_oid(info.id.as_ref())?);
            }
        }
        Ok(oldest)
    }

    /// Tree bytes for a commit, or `None` if the commit object is absent.
    ///
    /// Absent is normal and not an error: in a shallow clone the parents of the
    /// boundary commits genuinely do not exist locally. Treating that as a
    /// failure would make the tool unusable on exactly the clones CI produces.
    /// Such a commit is diffed against an empty tree, so its whole tree reads as
    /// additions — which is the honest answer given the history we were handed.
    fn tree_data(&self, commit_id: gix::ObjectId) -> Result<Option<Vec<u8>>, GixError> {
        let Some(obj) = git_ctx!(self.repo.try_find_object(commit_id), "reading a commit")? else {
            return Ok(None);
        };
        let commit = git_ctx!(obj.try_into_commit(), "an object was not a commit")?;
        let tree = git_ctx!(commit.tree(), "reading a commit tree")?;
        Ok(Some(tree.data.clone()))
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
        Ok(RepoIdentity {
            git_dir,
            root_commit: self.oldest_root_commit()?,
        })
    }

    fn tips(&self) -> Result<Vec<Oid>, Self::Error> {
        let mut tips = Vec::new();

        // HEAD first: a detached HEAD is named by no reference, and skipping it
        // would index everything except where the user is actually standing.
        if let Ok(id) = self.repo.head_id() {
            tips.push(Self::to_oid(id.as_ref())?);
        }

        let platform = git_ctx!(self.repo.references(), "opening references")?;
        let all = git_ctx!(platform.all(), "listing references")?;
        for mut reference in all.flatten() {
            // Tags peel to the commit they point at; anything that does not
            // peel to a commit is not a history tip.
            if let Ok(id) = reference.peel_to_id() {
                if let Ok(oid) = Self::to_oid(id.as_ref()) {
                    if self
                        .repo
                        .find_object(id.detach())
                        .map(|o| o.kind.is_commit())
                        .unwrap_or(false)
                    {
                        tips.push(oid);
                    }
                }
            }
        }

        tips.sort_unstable();
        tips.dedup();
        if tips.is_empty() {
            return Err(GixError::NoCommits {
                path: self.path.display().to_string(),
            });
        }
        Ok(tips)
    }

    fn mailmap(&self) -> Result<Mailmap, Self::Error> {
        // Read `.mailmap` from the work tree, parsed by our own parser so that
        // no gix type crosses the seam. A bare repository has no work tree and
        // therefore no mailmap.
        let Some(work_dir) = self.repo.workdir() else {
            return Ok(Mailmap::default());
        };
        match std::fs::read(work_dir.join(".mailmap")) {
            Ok(bytes) => Ok(Mailmap::parse(&bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Mailmap::default()),
            Err(e) => Err(GixError::Git {
                context: "reading .mailmap",
                source: Box::new(e),
            }),
        }
    }

    fn walk_history(
        &self,
        stop_at: &Frontier,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error> {
        let gix_tips: Vec<gix::ObjectId> =
            self.tips()?.into_iter().filter_map(Self::to_gix).collect();

        let mut stats = WalkStats {
            history_truncated: self.repo.is_shallow(),
            ..WalkStats::default()
        };

        let walk = git_ctx!(
            self.repo.rev_walk(gix_tips).all(),
            "starting the history walk"
        )?;

        // Reused across commits: allocating diff state per commit would dominate
        // the walk on a large repository.
        let mut diff_state = gix::diff::tree::State::default();
        let hash_kind = self.repo.object_hash();
        let empty_tree: Vec<u8> = Vec::new();
        let mut changes: Vec<(Vec<u8>, RawChangeKind, Oid)> = Vec::new();

        for info in walk {
            let info = git_ctx!(info, "walking history")?;
            let id = Self::to_oid(info.id.as_ref())?;

            if stop_at.contains(&id) {
                stats.commits_skipped += 1;
                continue;
            }

            let commit = git_ctx!(info.object(), "reading a commit")?;
            let committer = git_ctx!(commit.committer(), "reading a committer")?;
            let author = git_ctx!(commit.author(), "reading an author")?;
            let time = committer.seconds();
            let parents: Vec<gix::ObjectId> = commit.parent_ids().map(|p| p.detach()).collect();
            let tree = git_ctx!(commit.tree(), "reading a commit tree")?;

            // Diff against the first parent only. For a merge this yields what
            // the merge itself introduced, which for a clean merge is nothing.
            let parent_data = match parents.first() {
                // A missing parent means we are at a shallow clone's boundary.
                Some(pid) => self.tree_data(*pid)?.unwrap_or_else(|| empty_tree.clone()),
                None => empty_tree.clone(),
            };

            changes.clear();
            let mut recorder = gix::diff::tree::Recorder::default();
            git_ctx!(
                gix::diff::tree(
                    TreeRefIter::from_bytes(&parent_data, hash_kind),
                    TreeRefIter::from_bytes(&tree.data, hash_kind),
                    &mut diff_state,
                    &self.repo.objects,
                    &mut recorder,
                ),
                "diffing two trees"
            )?;

            for record in recorder.records {
                // Directory entries are skipped: a change to a tree is implied
                // by the changes to the blobs beneath it, which the diff also
                // reports.
                let (path, kind, oid) = match record {
                    TreeChange::Addition {
                        entry_mode,
                        oid,
                        path,
                        ..
                    } => {
                        if !entry_mode.is_blob() {
                            continue;
                        }
                        (path, RawChangeKind::Added, oid)
                    }
                    TreeChange::Deletion {
                        entry_mode,
                        oid,
                        path,
                        ..
                    } => {
                        if !entry_mode.is_blob() {
                            continue;
                        }
                        (path, RawChangeKind::Deleted, oid)
                    }
                    TreeChange::Modification {
                        entry_mode,
                        oid,
                        path,
                        ..
                    } => {
                        if !entry_mode.is_blob() {
                            continue;
                        }
                        (path, RawChangeKind::Modified, oid)
                    }
                };
                if let Some(oid) = Oid::from_bytes(oid.as_bytes()) {
                    changes.push((path.into(), kind, oid));
                }
            }

            let borrowed: Vec<RawChange<'_>> = changes
                .iter()
                .map(|(p, k, b)| RawChange {
                    path: p,
                    kind: *k,
                    blob: *b,
                })
                .collect();

            let raw = RawCommit {
                id,
                time,
                author_name: author.name,
                author_email: author.email,
                parent_count: parents.len(),
            };

            stats.commits_visited += 1;
            if stats.commits_visited.is_multiple_of(PROGRESS_EVERY) {
                sink.on_progress(stats.commits_visited);
            }
            if sink.on_commit(&raw, &borrowed).is_break() {
                break;
            }
        }

        Ok(stats)
    }

    fn walk_head_tree(&self, sink: &mut dyn TreeSink) -> Result<(), Self::Error> {
        let head = git_ctx!(self.repo.head_commit(), "resolving HEAD")?;
        let tree = git_ctx!(head.tree(), "reading the HEAD tree")?;

        let hash_kind = self.repo.object_hash();
        let mut recorder = gix::traverse::tree::Recorder::default();
        git_ctx!(
            gix::traverse::tree::breadthfirst(
                TreeRefIter::from_bytes(&tree.data, hash_kind),
                gix::traverse::tree::breadthfirst::State::default(),
                &self.repo.objects,
                &mut recorder,
            ),
            "walking the HEAD tree"
        )?;

        for entry in recorder.records {
            if !entry.mode.is_blob() {
                continue;
            }
            let obj = git_ctx!(self.repo.find_object(entry.oid), "reading a blob")?;
            if let ControlFlow::Break(()) = sink.on_blob(entry.filepath.as_ref(), &obj.data) {
                break;
            }
        }
        Ok(())
    }
}
