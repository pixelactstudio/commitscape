use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::code;
use crate::commits::{self, CommitQuery};
use crate::git::{self, BlobFacts, TreeOf};
use crate::loaded::LoadedPack;
use crate::pulls::{self, Named};

const PAGE_MAX: u32 = 100_000;

/// A question the Site asked of a Stored Index held in memory, now asked of a pack: its body besides `pack`, and how it is answered.
pub trait Question: DeserializeOwned + Serialize + Send + 'static {
    /// The endpoint that answers it.
    const PATH: &'static str;

    /// Why the body cannot be answered, if it cannot.
    fn refused(&self) -> Option<String> {
        None
    }

    /// The answer's JSON, exactly as the TypeScript it replaces returned it.
    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>>;
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Tree {
    #[serde(default)]
    pub blobs: BTreeMap<String, BlobFacts>,
    pub of: TreeOf,
}

impl Question for Tree {
    const PATH: &'static str = "/v1/git/tree";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&git::tree(held, &self.blobs, &self.of))
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Log {}

impl Question for Log {
    const PATH: &'static str = "/v1/git/log";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&git::log(held))
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Coupling {}

impl Question for Coupling {
    const PATH: &'static str = "/v1/git/coupling";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&git::coupling(held))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PathHistory {
    pub path: String,
}

impl Question for PathHistory {
    const PATH: &'static str = "/v1/git/path-history";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&git::path_history(held, &self.path))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FolderLast {
    pub path: String,
}

impl Question for FolderLast {
    const PATH: &'static str = "/v1/git/folder-last";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&git::folder_last(held, &self.path))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Story {
    pub path: String,
}

impl Question for Story {
    const PATH: &'static str = "/v1/code/story";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&code::story(held, &self.path))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CodeLog {
    pub path: String,
    pub page: u32,
}

impl Question for CodeLog {
    const PATH: &'static str = "/v1/code/log";

    fn refused(&self) -> Option<String> {
        (!(1..=PAGE_MAX).contains(&self.page)).then(|| "That is not a page.".to_string())
    }

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&code::code_log(held, &self.path, self.page))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Under {
    pub path: String,
    #[serde(default)]
    pub query: CommitQuery,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub said: Option<Vec<String>>,
}

impl Question for Under {
    const PATH: &'static str = "/v1/commits/under";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&commits::under(
            held,
            &self.path,
            &self.query,
            self.cursor.as_deref(),
            self.said.as_deref(),
        ))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Search {
    #[serde(default)]
    pub query: CommitQuery,
    #[serde(default)]
    pub cursor: Option<String>,
}

impl Question for Search {
    const PATH: &'static str = "/v1/commits/search";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&commits::search(held, &self.query, self.cursor.as_deref()))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Insight {
    pub number: u64,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub named: Vec<Named>,
}

impl Question for Insight {
    const PATH: &'static str = "/v1/pulls/insight";

    fn answer(&self, held: &LoadedPack) -> serde_json::Result<Vec<u8>> {
        serde_json::to_vec(&pulls::insight(
            held,
            self.number,
            &self.paths,
            self.author.as_deref(),
            &self.named,
        ))
    }
}
