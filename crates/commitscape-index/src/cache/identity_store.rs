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
}
