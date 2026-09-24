//! Who is who, beyond what the repository says (ADR-0011): undoing a merge
//! and linking commits to GitHub accounts, both kept in the cache
//! directory's identity store, never in the repository.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use commitscape_core::{AuthorTable, Index};
use commitscape_forge::accounts::commit_authors;
use commitscape_forge::Remote;
use commitscape_index::identity::{keys_of, Account, IdentityRules};
use commitscape_index::{resolve_authors, GixRepo, IdentityStore, Mailmap, RepoSource};
use commitscape_tui::{ChangePeople, LinkAccounts, PeopleChange};

/// Commits asked about per address: one that was never pushed says
/// nothing, so a few are tried.
const SAMPLES: usize = 3;

/// The repository's mailmap, read again: cheap, and it keeps the closures
/// below free of the repository handle.
fn mailmap(repo: &std::path::Path) -> Mailmap {
    GixRepo::open(repo)
        .and_then(|r| r.mailmap())
        .unwrap_or_default()
}

fn reresolve(table: &AuthorTable, rules: &IdentityRules) -> AuthorTable {
    let (signatures, used) = table.clone().into_signatures();
    resolve_authors(signatures, used, rules)
}

/// Undoes and redoes merges, keeping each in the store.
pub fn change(repo: PathBuf, store: IdentityStore) -> ChangePeople {
    std::sync::Arc::new(move |table, change| {
        let rules = store.rules(mailmap(&repo));
        let saved = match change {
            PeopleChange::Undo(p) => store.keep_apart(&keys_of(table, p, &rules)),
            PeopleChange::Redo(p) => store.merge_again(&keys_of(table, p, &rules)),
        };
        saved.ok()?;
        Some(reresolve(table, &store.rules(mailmap(&repo))))
    })
}

/// Asks GitHub about every address it has not been asked about yet, keeps
/// the answers, and re-resolves.
pub fn link(repo: PathBuf, store: IdentityStore, remote: Remote) -> LinkAccounts {
    Box::new(move |index: &Index| {
        let asked = store.asked();
        let authors = &index.authors;
        let mut samples: HashMap<String, Vec<String>> = HashMap::new();
        for c in index.commits.iter().rev() {
            let Some(sig) = authors.signature(c.signature) else {
                continue;
            };
            let email = sig.email.to_ascii_lowercase();
            let bot = authors
                .person_of(c.signature)
                .is_some_and(|p| authors.is_bot(p));
            if bot || email.ends_with("@users.noreply.github.com") || asked.contains(&email) {
                continue;
            }
            let ids = samples.entry(email).or_default();
            if ids.len() < SAMPLES {
                ids.push(c.id.to_string());
            }
        }
        if samples.is_empty() {
            return None;
        }
        let mut samples: Vec<(String, Vec<String>)> = samples.into_iter().collect();
        samples.sort();
        let commits: Vec<String> = samples.iter().flat_map(|(_, ids)| ids.clone()).collect();
        let found = commit_authors(&remote, &commits).ok()?;
        let mut by_commit: HashMap<&str, Account> = HashMap::new();
        for (id, author) in commits.iter().zip(found) {
            if let Some(a) = author {
                by_commit.insert(
                    id,
                    Account {
                        id: a.id,
                        login: a.login,
                    },
                );
            }
        }
        let answers: Vec<(String, Option<Account>)> = samples
            .iter()
            .map(|(e, ids)| {
                let account = ids.iter().find_map(|id| by_commit.get(id.as_str()));
                (e.clone(), account.cloned())
            })
            .collect();
        store.save_accounts(&answers).ok()?;
        let joined: HashSet<u64> = answers
            .iter()
            .filter_map(|(_, a)| a.as_ref().map(|a| a.id))
            .collect();
        if joined.is_empty() {
            return None;
        }
        Some(reresolve(authors, &store.rules(mailmap(&repo))))
    })
}
