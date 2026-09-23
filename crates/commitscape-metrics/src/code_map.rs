//! The code at HEAD as a tree: every directory and file sized by its lines
//! and heated by the Window's commits. What the Map Panel draws.

use std::collections::HashMap;

use commitscape_core::{AuthorId, FileId};
use serde::Serialize;

use crate::analysis::{counts, Analysis};
use crate::people::Owner;

/// One directory or file on the map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MapNode {
    /// The last component of its path; empty for the root.
    pub name: String,
    /// Its full path. A directory's ends in `/`; the root's is empty.
    pub path: String,
    /// Its place in [`CodeMap::nodes`]; `None` for the root.
    pub parent: Option<usize>,
    /// Largest first.
    pub children: Vec<usize>,
    /// Set for a file, `None` for a directory.
    pub file: Option<FileId>,
    /// Lines at HEAD in the files people wrote under it.
    pub lines: u64,
    pub files: u32,
    /// Commits in the Window that touched it or anything under it, merges
    /// and Bulk Commits left out, as for Churn.
    pub churn: u32,
    /// The latest last touch among its files.
    pub last_touched: i64,
    /// Who made the most of those commits, and how many.
    pub owner: Option<Owner>,
}

/// The code at HEAD as a tree. `nodes[0]` is the root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CodeMap {
    pub nodes: Vec<MapNode>,
}

impl Analysis<'_> {
    /// The files people wrote at HEAD as a tree, with each directory's
    /// lines, the Window's commits under it, and who made most of them.
    pub fn code_map(&self) -> CodeMap {
        let index = self.index();
        let mut nodes = vec![node(String::new(), String::new(), None, None)];
        let mut dirs: HashMap<Vec<u8>, usize> = HashMap::new();
        let mut leaf_of: Vec<Option<usize>> = vec![None; index.paths.len()];

        for h in self.ranked() {
            let Some(path) = index.paths.path(h.file) else {
                continue;
            };
            let mut parent = 0;
            let mut start = 0;
            for (i, &b) in path.iter().enumerate() {
                if b != b'/' {
                    continue;
                }
                let dir = path.get(..=i).unwrap_or_default();
                parent = match dirs.get(dir) {
                    Some(&n) => n,
                    None => {
                        let name = lossy(path.get(start..i).unwrap_or_default());
                        let n = add(&mut nodes, node(name, lossy(dir), Some(parent), None));
                        dirs.insert(dir.to_vec(), n);
                        n
                    }
                };
                start = i + 1;
            }
            let mut leaf = node(
                lossy(path.get(start..).unwrap_or_default()),
                lossy(path),
                Some(parent),
                Some(h.file),
            );
            leaf.lines = u64::from(h.loc);
            leaf.files = 1;
            leaf.last_touched = index.history_of(h.file).map_or(0, |f| f.last_touched);
            let n = add(&mut nodes, leaf);
            if let Some(slot) = leaf_of.get_mut(h.file.idx()) {
                *slot = Some(n);
            }
        }

        // Every node comes after its parent, so one pass from the end adds
        // each node into its parent after the node itself is complete.
        for i in (1..nodes.len()).rev() {
            let Some(child) = nodes.get(i) else {
                continue;
            };
            let (lines, files, last, parent) =
                (child.lines, child.files, child.last_touched, child.parent);
            if let Some(p) = parent.and_then(|p| nodes.get_mut(p)) {
                p.lines += lines;
                p.files += files;
                p.last_touched = p.last_touched.max(last);
            }
        }

        // A commit counts once for a node, however many files under it it
        // touched, so each node remembers the last commit that counted.
        let options = self.options();
        let mut counted_for = vec![0u32; nodes.len()];
        let mut made: Vec<(usize, AuthorId)> = Vec::new();
        for (n, commit) in self.window_commits().iter().enumerate() {
            if !counts(commit, &options) {
                continue;
            }
            let Some(author) = index.author_of(commit) else {
                continue;
            };
            let stamp = n as u32 + 1;
            for change in index.changes_of(commit) {
                let mut at = leaf_of.get(change.file.idx()).copied().flatten();
                while let Some(i) = at {
                    // Its ancestors were counted with it.
                    if counted_for.get(i) == Some(&stamp) {
                        break;
                    }
                    if let Some(s) = counted_for.get_mut(i) {
                        *s = stamp;
                    }
                    let Some(node) = nodes.get_mut(i) else {
                        break;
                    };
                    node.churn += 1;
                    made.push((i, author));
                    at = node.parent;
                }
            }
        }

        made.sort_unstable();
        let mut i = 0;
        while let Some(&(at, _)) = made.get(i) {
            let rest = made.get(i..).unwrap_or_default();
            let len = rest.iter().take_while(|(n, _)| *n == at).count();
            let run = rest.get(..len).unwrap_or_default();
            let mut best: Option<Owner> = None;
            let mut j = 0;
            while let Some(&(_, author)) = run.get(j) {
                let commits = run
                    .get(j..)
                    .unwrap_or_default()
                    .iter()
                    .take_while(|(_, a)| *a == author)
                    .count() as u32;
                if commits > best.map_or(0, |b| b.commits) {
                    best = Some(Owner { author, commits });
                }
                j += commits as usize;
            }
            if let Some(node) = nodes.get_mut(at) {
                node.owner = best;
            }
            i += run.len().max(1);
        }

        let sizes: Vec<(u64, String)> = nodes.iter().map(|n| (n.lines, n.name.clone())).collect();
        for node in &mut nodes {
            node.children.sort_by(|&a, &b| {
                let (a, b) = (sizes.get(a), sizes.get(b));
                b.map(|s| s.0)
                    .cmp(&a.map(|s| s.0))
                    .then_with(|| a.map(|s| &s.1).cmp(&b.map(|s| &s.1)))
            });
        }
        CodeMap { nodes }
    }
}

fn node(name: String, path: String, parent: Option<usize>, file: Option<FileId>) -> MapNode {
    MapNode {
        name,
        path,
        parent,
        children: Vec::new(),
        file,
        lines: 0,
        files: 0,
        churn: 0,
        last_touched: 0,
        owner: None,
    }
}

/// Appends a node and records it as its parent's child.
fn add(nodes: &mut Vec<MapNode>, new: MapNode) -> usize {
    let n = nodes.len();
    if let Some(p) = new.parent.and_then(|p| nodes.get_mut(p)) {
        p.children.push(n);
    }
    nodes.push(new);
    n
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}
