use std::collections::HashMap;

use commitscape_core::{AuthorId, CommitFlags, FileClass, FileId};
use serde::Serialize;

use crate::analysis::{counts, Analysis};
use crate::people::{Contributor, Ownership};
use crate::roles::{is_lockfile, looks_generated};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct LinesChanged {
    pub added: u64,
    pub removed: u64,
    pub counted: u32,
    pub uncounted: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Contribution {
    pub author: AuthorId,
    pub commits: u32,
    pub lines: LinesChanged,
    pub areas: u32,
}

impl Analysis<'_> {
    pub fn contributions(&self) -> Vec<Contribution> {
        combine(
            &self.contributors(),
            &self.ownership(),
            &self.lines_by_person(),
        )
    }

    pub fn lines_by_person(&self) -> Vec<(AuthorId, LinesChanged)> {
        let index = self.index();
        let options = self.options();
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
