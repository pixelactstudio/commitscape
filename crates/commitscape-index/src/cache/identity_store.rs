//! What people are resolved from besides the repository (ADR-0011): the
//! GitHub accounts commits were linked to, and the merges the user undid.
//!
//! Kept next to the cache, never in the repository, as two small text files
//! a person can read:
//!
//! - `accounts`: `email<TAB>number<TAB>login` for an address GitHub linked
//!   to an account, and `email<TAB>-` for one it did not, so it is not asked
//!   again.
//! - `kept-apart`: one undone merge per line, its address keys separated by
//!   spaces.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use commitscape_core::RepoIdentity;

use super::CacheOptions;
use crate::identity::{Account, IdentityRules};
use crate::mailmap::Mailmap;

const ACCOUNTS: &str = "accounts";
const KEPT_APART: &str = "kept-apart";

/// One repository's identity files.
#[derive(Debug, Clone)]
pub struct IdentityStore {
    dir: PathBuf,
}

impl IdentityStore {
    /// The store for a repository, or `None` when caching is off.
    pub fn for_repo(options: &CacheOptions, repo: &RepoIdentity) -> Option<Self> {
        let root = options.root.as_deref()?;
        Some(IdentityStore::in_dir(&root.join(repo.cache_key())))
    }

    pub(super) fn in_dir(dir: &Path) -> Self {
        IdentityStore {
            dir: dir.to_path_buf(),
        }
    }

    /// The rules to resolve with: the mailmap given, and what is stored.
    pub fn rules(&self, mailmap: Mailmap) -> IdentityRules {
        let mut rules = IdentityRules::from_mailmap(mailmap);
        for line in self.lines(ACCOUNTS) {
            let mut parts = line.split('\t');
            if let (Some(email), Some(id), Some(login)) = (parts.next(), parts.next(), parts.next())
            {
                if let Ok(id) = id.parse() {
                    let login = login.to_string();
                    rules
                        .accounts
                        .insert(email.to_string(), Account { id, login });
                }
            }
        }
        rules.kept_apart = self
            .lines(KEPT_APART)
            .map(|l| l.split(' ').map(str::to_string).collect())
            .collect();
        rules
    }

    /// Addresses GitHub has been asked about, whatever it answered.
    pub fn asked(&self) -> HashSet<String> {
        self.lines(ACCOUNTS)
            .filter_map(|l| l.split('\t').next().map(str::to_string))
            .collect()
    }

    /// Records GitHub's answers: an account, or none.
    pub fn save_accounts(&self, answers: &[(String, Option<Account>)]) -> io::Result<()> {
        let mut text = self.read(ACCOUNTS);
        for (email, account) in answers {
            match account {
                Some(a) => text.push_str(&format!("{email}\t{}\t{}\n", a.id, a.login)),
                None => text.push_str(&format!("{email}\t-\n")),
            }
        }
        self.write(ACCOUNTS, &text)
    }

    /// Undoes a merge: these address keys ([`crate::identity::keys_of`]) are
    /// never joined to each other by name or account again.
    pub fn keep_apart(&self, keys: &[String]) -> io::Result<()> {
        let mut text = self.read(KEPT_APART);
        text.push_str(&keys.join(" "));
        text.push('\n');
        self.write(KEPT_APART, &text)
    }

    /// Redoes a merge: forgets every undo that kept any of these keys apart.
    pub fn merge_again(&self, keys: &[String]) -> io::Result<()> {
        let text: String = self
            .lines(KEPT_APART)
            .filter(|l| !l.split(' ').any(|k| keys.iter().any(|x| x == k)))
            .map(|l| format!("{l}\n"))
            .collect();
        self.write(KEPT_APART, &text)
    }

    fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.join(name)).unwrap_or_default()
    }

    fn lines(&self, name: &str) -> impl Iterator<Item = String> {
        self.read(name)
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
            .into_iter()
    }

    fn write(&self, name: &str, text: &str) -> io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join(format!("{name}.tmp"));
        std::fs::write(&tmp, text)?;
        std::fs::rename(tmp, self.dir.join(name))
    }
}
