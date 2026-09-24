//! The paths a change touches, for `check`: what is staged, what a branch
//! changed since it left another, and what one commit changed. Read from
//! trees and the index file only, never blob contents.

use std::collections::HashMap;

use gix::ObjectId;

use super::tree_diff::{Changed, TreeDiffer};
use super::{GixError, GixRepo};

impl GixRepo {
    /// The paths whose staged content differs from HEAD's: added, changed
    /// or removed in the index. Every path is staged when there is no HEAD.
    pub fn staged(&self) -> Result<Vec<String>, GixError> {
        let index = git_ctx!(self.repo.open_index(), "reading the staging area")?;
        let mut head: HashMap<Vec<u8>, ObjectId> = HashMap::new();
        if let Ok(commit) = self.repo.head_commit() {
            let tree = git_ctx!(commit.tree_id(), "reading the HEAD tree")?.detach();
            for c in self.diff(tree, None)? {
                head.insert(c.path, c.blob);
            }
        }
        let mut out = Vec::new();
        for entry in index.entries() {
            // A submodule is another repository, and a sparse entry a folder
            // left out of the checkout: neither is a file staged here.
            if entry.mode.is_submodule() || entry.mode.is_sparse() {
                continue;
            }
            let path = entry.path(&index).to_vec();
            match head.remove(&path) {
                Some(id) if id == entry.id => {}
                _ => out.push(String::from_utf8_lossy(&path).into_owned()),
            }
        }
        // What HEAD has and the index does not was removed.
        out.extend(
            head.into_keys()
                .map(|p| String::from_utf8_lossy(&p).into_owned()),
        );
        out.sort();
        out.dedup();
        Ok(out)
    }

    /// The paths changed between where HEAD left `base` (their merge base)
    /// and HEAD: what a branch changed.
    pub fn changed_since(&self, base: &str) -> Result<Vec<String>, GixError> {
        let base = git_ctx!(
            self.repo.rev_parse_single(base),
            "finding the base to compare with"
        )?;
        let head = git_ctx!(self.repo.head_id(), "resolving HEAD")?;
        let from = git_ctx!(
            self.repo.merge_base(base.detach(), head.detach()),
            "finding where the branch began"
        )?
        .detach();
        let old = git_ctx!(self.repo.find_commit(from), "reading the merge base")?;
        let old_tree = git_ctx!(old.tree_id(), "reading the merge base's tree")?.detach();
        let new = git_ctx!(self.repo.find_commit(head.detach()), "reading HEAD")?;
        let tree = git_ctx!(new.tree_id(), "reading the HEAD tree")?.detach();
        Ok(paths(self.diff(tree, Some(old_tree))?))
    }

    /// The paths one commit changed against its first parent, and its
    /// commit time.
    pub fn commit_changes(&self, rev: &str) -> Result<(Vec<String>, i64), GixError> {
        let id = git_ctx!(self.repo.rev_parse_single(rev), "finding the commit")?;
        let commit = git_ctx!(self.repo.find_commit(id.detach()), "reading the commit")?;
        let time = git_ctx!(commit.time(), "reading the commit's time")?.seconds;
        let tree = git_ctx!(commit.tree_id(), "reading the commit's tree")?.detach();
        let parent = match commit.parent_ids().next() {
            Some(p) => {
                let parent = git_ctx!(self.repo.find_commit(p.detach()), "reading its parent")?;
                Some(git_ctx!(parent.tree_id(), "reading its parent's tree")?.detach())
            }
            None => None,
        };
        Ok((paths(self.diff(tree, parent)?), time))
    }

    fn diff(&self, tree: ObjectId, parent: Option<ObjectId>) -> Result<Vec<Changed>, GixError> {
        let mut differ = TreeDiffer::new(self.repo.object_hash());
        let mut changed = Vec::new();
        differ
            .diff(&self.repo.objects, tree, &[parent], &mut changed)
            .map_err(|source| GixError::Git {
                context: "comparing trees",
                source,
            })?;
        Ok(changed)
    }
}

fn paths(changed: Vec<Changed>) -> Vec<String> {
    let mut out: Vec<String> = changed
        .into_iter()
        .map(|c| String::from_utf8_lossy(&c.path).into_owned())
        .collect();
    out.sort();
    out.dedup();
    out
}
