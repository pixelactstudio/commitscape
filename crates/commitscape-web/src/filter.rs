//! Narrowing everything to one person, one folder, or both: an index with
//! only their commits and only the changes under the folder, which every
//! screen is then computed from as usual. A date range is a Window.

use commitscape_core::{AuthorId, CommitFlags, CommitMeta, FileChange, HistorySpan, Index};

/// What to narrow to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Filter {
    pub person: Option<AuthorId>,
    /// A path prefix; a folder's ends in `/`.
    pub folder: Option<String>,
}

impl Filter {
    pub fn is_empty(&self) -> bool {
        self.person.is_none() && self.folder.as_deref().is_none_or(str::is_empty)
    }

    /// A copy of `index`, all of whose history is loaded, holding only what
    /// the filter keeps. A Bulk Commit (over `max_changeset_size` files)
    /// stays one when only a few of its changes are kept.
    pub fn apply(&self, index: &Index, max_changeset_size: u32) -> Index {
        let folder = self.folder.as_deref().unwrap_or("").as_bytes();
        let in_folder = |file| {
            folder.is_empty()
                || index
                    .paths
                    .path(file)
                    .is_some_and(|p| p.starts_with(folder))
        };
        let mut commits = Vec::with_capacity(index.commits.len() / 4);
        let mut changes = Vec::with_capacity(index.changes.len() / 4);
        for c in &index.commits {
            if self.person.is_some_and(|p| index.author_of(c) != Some(p)) {
                continue;
            }
            let kept: Vec<FileChange> = index
                .changes_of(c)
                .iter()
                .copied()
                .filter(|ch| in_folder(ch.file))
                .collect();
            // With a folder, a commit that changed nothing in it is not
            // the folder's.
            if !folder.is_empty() && kept.is_empty() {
                continue;
            }
            let flags = if c.changes_len > max_changeset_size {
                c.flags.with(CommitFlags::BULK)
            } else {
                c.flags
            };
            commits.push(CommitMeta {
                changes_start: changes.len() as u32,
                changes_len: kept.len() as u32,
                flags,
                ..*c
            });
            changes.extend(kept);
        }
        let head = index
            .head
            .iter()
            .filter(|h| in_folder(h.file))
            .cloned()
            .collect();
        Index {
            schema_version: index.schema_version,
            repo: index.repo.clone(),
            frontier: index.frontier.clone(),
            span: HistorySpan::of(&commits),
            commits,
            changes,
            paths: index.paths.clone(),
            authors: index.authors.clone(),
            head,
            head_commit: index.head_commit,
            file_history: index.file_history.clone(),
            history_truncated: index.history_truncated,
            loaded_from: index.loaded_from,
        }
    }
}
