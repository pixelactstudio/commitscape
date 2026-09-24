//! What each person did in the Window, several ways side by side: commits,
//! lines added and removed, and the folders that depend on them. There is no
//! single score, and never will be (IDEA.md).

use std::collections::HashMap;

use commitscape_core::{AuthorId, CommitFlags, FileClass, FileId};
use serde::Serialize;

use crate::analysis::{counts, Analysis};
use crate::people::{Contributor, Ownership};
use crate::roles::{is_lockfile, looks_generated};

/// Lines added and removed, counting only what a person wrote.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct LinesChanged {
    pub added: u64,
    pub removed: u64,
    /// Changes whose lines were counted.
    pub counted: u32,
    /// Changes the line pass could not count: binary, or over a megabyte.
    pub uncounted: u32,
}

/// One person's work in the Window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Contribution {
    pub author: AuthorId,
    /// Their commits that are not merges, Bulk Commits included.
    pub commits: u32,
    /// Lines they added and removed. Left out: merges, Bulk Commits, commits
    /// `.git-blame-ignore-revs` names, lockfiles, and generated and vendored
    /// files.
    pub lines: LinesChanged,
    /// Folders that depend on them: held by them alone (Bus Factor 1), a
    /// folder inside another of theirs not counted again.
    pub areas: u32,
}

impl Analysis<'_> {
    /// Everyone who made commits in the Window, most commits first, each
    /// with their lines and areas. Bots are left out.
    pub fn contributions(&self) -> Vec<Contribution> {
        combine(
            &self.contributors(),
            &self.ownership(),
            &self.lines_by_person(),
        )
    }

    /// Each person's Lines Changed in the Window, by person. Bots are left
    /// out.
    pub fn lines_by_person(&self) -> Vec<(AuthorId, LinesChanged)> {
        let index = self.index();
        let options = self.options();
        // By file: whether a person wrote it, and whether it is a lockfile.
        let mut skip = vec![None::<bool>; index.paths.len()];
        for h in &index.head {
            if let Some(slot) = skip.get_mut(h.file.idx()) {
                *slot = Some(matches!(
                    h.class,
                    FileClass::Generated | FileClass::Vendored
                ));
            }
        }
        let mut skipped = |file: FileId| -> bool {
            let Some(slot) = skip.get_mut(file.idx()) else {
                return true;
            };
            let path = index.paths.path(file);
            let generated = match *slot {
                Some(g) => g,
                None => path.is_some_and(looks_generated),
            };
            let s = generated || path.is_some_and(is_lockfile);
            *slot = Some(s);
            s
        };

        let mut lines: HashMap<AuthorId, LinesChanged> = HashMap::new();
        for commit in self.window_commits() {
            if !counts(commit, &options) || commit.flags.contains(CommitFlags::BLAME_IGNORED) {
                continue;
            }
            let Some(author) = self.person_of(commit) else {
                continue;
            };
            let l = lines.entry(author).or_default();
            for change in index.changes_of(commit) {
                if skipped(change.file) {
                    continue;
                }
                match change.lines {
                    Some(d) => {
                        l.added += u64::from(d.added);
                        l.removed += u64::from(d.removed);
                        l.counted += 1;
                    }
                    None => l.uncounted += 1,
                }
            }
        }
        let mut out: Vec<_> = lines.into_iter().collect();
        out.sort_unstable_by_key(|(a, _)| *a);
        out
    }
}

/// Each contributor's commits, lines and areas, from the three computed
/// apart: an interface that has Ownership already need not compute it again.
pub fn combine(
    contributors: &[Contributor],
    ownership: &Ownership,
    lines: &[(AuthorId, LinesChanged)],
) -> Vec<Contribution> {
    let mut areas: HashMap<AuthorId, u32> = HashMap::new();
    for d in ownership.held_alone() {
        if let Some(o) = d.owners.first() {
            *areas.entry(o.author).or_default() += 1;
        }
    }
    contributors
        .iter()
        .map(|c| Contribution {
            author: c.author,
            commits: c.commits,
            lines: lines
                .binary_search_by_key(&c.author, |(a, _)| *a)
                .ok()
                .and_then(|i| lines.get(i))
                .map(|(_, l)| *l)
                .unwrap_or_default(),
            areas: areas.get(&c.author).copied().unwrap_or(0),
        })
        .collect()
}
