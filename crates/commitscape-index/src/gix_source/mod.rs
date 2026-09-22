//! The `gix` [`RepoSource`]. The only module in the workspace that names
//! gitoxide types (ADR-0001).
//!
//! Tree diffs use our own structure-only walk in [`tree_diff`] rather than
//! gix's `Tree::changes()`. That API lives behind gix's `blob-diff` feature,
//! and enabling it would compile blob-diffing machinery into a binary whose
//! central performance decision is that the walk never touches blob contents
//! (ADR-0004). Our walk reads tree objects only, and it also computes the
//! combined diff that merges need, which gix does not offer.

use std::ops::ControlFlow;
use std::path::{Path, PathBuf};

use commitscape_core::{Oid, RepoIdentity};
use gix::objs::TreeRefIter;

use crate::mailmap::Mailmap;
use crate::source::{CommitSink, Frontier, RepoSource, TreeSink, WalkStats};

/// Wraps any error into [`GixError::Git`] with a human-facing context.
macro_rules! git_ctx {
    ($expr:expr, $context:literal) => {
        $expr.map_err(|e| $crate::gix_source::GixError::Git {
            context: $context,
            source: Box::new(e),
        })
    };
}

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

    fn mailmap(&self) -> Result<Mailmap, Self::Error> {
        // git reads the work tree's `.mailmap` when there is one, and the
        // committed one otherwise. Parsed by our own parser so that no gix
        // type crosses the seam.
        if let Some(work_dir) = self.repo.workdir() {
            match std::fs::read(work_dir.join(".mailmap")) {
                Ok(bytes) => return Ok(Mailmap::parse(&bytes)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(GixError::Git {
                        context: "reading .mailmap",
                        source: Box::new(e),
                    })
                }
            }
        }
        Ok(self
            .mailmap_at_head()?
            .map(|bytes| Mailmap::parse(&bytes))
            .unwrap_or_default())
    }

    fn walk_history(
        &self,
        stop_at: &Frontier,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error> {
        walk::walk(self, stop_at, sink)
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
