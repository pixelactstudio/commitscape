use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use commitscape_core::RepoIdentity;

use super::CacheOptions;
use crate::identity::{Account, IdentityRules};
use crate::mailmap::Mailmap;

const ACCOUNTS: &str = "accounts";
const KEPT_APART: &str = "kept-apart";

#[derive(Debug, Clone)]
pub struct IdentityStore {
    dir: PathBuf,
}

impl IdentityStore {
    pub fn for_repo(options: &CacheOptions, repo: &RepoIdentity) -> Option<Self> {
        Some(IdentityStore::in_dir(&super::repo_dir(options, repo)?))
    }

    pub(super) fn in_dir(dir: &Path) -> Self {
        IdentityStore {
            dir: dir.to_path_buf(),
        }
    }

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

    pub fn asked(&self) -> HashSet<String> {
        self.lines(ACCOUNTS)
            .filter_map(|l| l.split('\t').next().map(str::to_string))
            .collect()
    }

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

    pub fn keep_apart(&self, keys: &[String]) -> io::Result<()> {
        let mut text = self.read(KEPT_APART);
        text.push_str(&keys.join(" "));
        text.push('\n');
        self.write(KEPT_APART, &text)
    }

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
