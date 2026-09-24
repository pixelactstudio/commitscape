//! A repository's whole history on GitHub (ADR-0009, amended in Build Run
//! 3): every pull request with its reviews, every issue with its first
//! answer, and every release.
//!
//! Each list is read a hundred at a time in the order things last changed,
//! oldest first, and the place reached is kept with what was read. So the
//! first fetch of a large repository can stop anywhere, at GitHub's rate
//! limit or when the user quits, and the next picks up there; and once a
//! list has been read to its end, the next fetch asks only for what changed
//! since. Everything is kept in one JSON file the caller names.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use commitscape_core::parse_iso8601;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ForgeError, Remote};

/// Bumped when a saved history could not be read as this version reads it.
const VERSION: u32 = 1;

/// A pull request, as GitHub last described it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullRecord {
    pub number: u64,
    /// `None` for a deleted account.
    pub author: Option<String>,
    pub created: i64,
    pub merged: Option<i64>,
    pub closed: Option<i64>,
    pub merged_by: Option<String>,
    pub reviews: Vec<Review>,
}

/// A review of a pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Review {
    pub author: Option<String>,
    /// `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED` or `DISMISSED`.
    pub state: String,
    pub submitted: Option<i64>,
}

/// An issue, pull requests aside.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IssueRecord {
    pub number: u64,
    pub author: Option<String>,
    pub created: i64,
    pub closed: Option<i64>,
    /// When someone other than its author first commented, among its first
    /// five comments.
    pub first_response: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseRecord {
    pub tag: String,
    pub name: Option<String>,
    pub published: Option<i64>,
    pub prerelease: bool,
}

/// Where each list was read up to.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Cursors {
    pull_requests: Option<String>,
    issues: Option<String>,
    releases: Option<String>,
}

/// Everything read so far.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct History {
    version: u32,
    /// By number.
    pub pull_requests: Vec<PullRecord>,
    /// By number.
    pub issues: Vec<IssueRecord>,
    /// Oldest first.
    pub releases: Vec<ReleaseRecord>,
    /// Every list was read to its end by the last update.
    pub complete: bool,
    cursors: Cursors,
}

/// One page to ask GitHub for.
#[derive(Debug, Clone)]
pub struct Query {
    /// `pullRequests`, `issues` or `releases`.
    pub connection: &'static str,
    /// Where the page starts: the end of the one before.
    pub after: Option<String>,
    /// The GraphQL, taking `$owner`, `$name` and `$after`.
    pub graphql: String,
}

/// How far an update has got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub connection: &'static str,
    /// Read in this update.
    pub read: u64,
    /// GitHub's count of the whole list.
    pub total: u64,
}

const PULL_FIELDS: &str =
    "number author { login } createdAt mergedAt closedAt state mergedBy { login } \
    reviews(first: 20) { nodes { author { login } state submittedAt } }";
const ISSUE_FIELDS: &str = "number author { login } createdAt closedAt \
    comments(first: 5) { nodes { author { login } createdAt } }";
const RELEASE_FIELDS: &str = "tagName name publishedAt isPrerelease";

fn graphql(connection: &str, order: &str, fields: &str) -> String {
    format!(
        "query($owner: String!, $name: String!, $after: String) {{
  repository(owner: $owner, name: $name) {{
    {connection}(first: 100, after: $after, orderBy: {{field: {order}, direction: ASC}}) {{
      totalCount pageInfo {{ hasNextPage endCursor }}
      nodes {{ {fields} }}
    }}
  }}
}}"
    )
}

impl History {
    /// What was saved at `path`, or nothing yet.
    pub fn load(path: &Path) -> History {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice::<History>(&b).ok())
            .filter(|h| h.version == VERSION)
            .unwrap_or_default()
    }

    fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec(self).map_err(io::Error::other)?)?;
        std::fs::rename(tmp, path)
    }

    /// Reads what is new, a page at a time, saving to `path` after each. On
    /// an error, what was read before it is kept, saved and resumed from
    /// next time, and the error returned.
    pub fn update(
        &mut self,
        path: Option<&Path>,
        fetch: &mut dyn FnMut(&Query) -> Result<Vec<u8>, ForgeError>,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<(), ForgeError> {
        self.version = VERSION;
        self.complete = false;
        let lists: [(&'static str, &str, &str); 3] = [
            ("pullRequests", "UPDATED_AT", PULL_FIELDS),
            ("issues", "UPDATED_AT", ISSUE_FIELDS),
            ("releases", "CREATED_AT", RELEASE_FIELDS),
        ];
        for (connection, order, fields) in lists {
            let mut read = 0u64;
            loop {
                let query = Query {
                    connection,
                    after: self.cursor(connection).clone(),
                    graphql: graphql(connection, order, fields),
                };
                let page = fetch(&query).and_then(|bytes| Page::read(&bytes, connection));
                let page = match page {
                    Ok(p) => p,
                    Err(e) => {
                        if let Some(path) = path {
                            let _ = self.save(path);
                        }
                        return Err(e);
                    }
                };
                read += page.nodes.len() as u64;
                self.take(connection, &page.nodes);
                if page.end.is_some() {
                    *self.cursor(connection) = page.end;
                }
                progress(Progress {
                    connection,
                    read,
                    total: page.total,
                });
                if let Some(path) = path {
                    let _ = self.save(path);
                }
                if !page.has_next {
                    break;
                }
            }
        }
        self.complete = true;
        if let Some(path) = path {
            let _ = self.save(path);
        }
        Ok(())
    }

    fn cursor(&mut self, connection: &str) -> &mut Option<String> {
        match connection {
            "pullRequests" => &mut self.cursors.pull_requests,
            "issues" => &mut self.cursors.issues,
            _ => &mut self.cursors.releases,
        }
    }

    /// Adds a page's records, each replacing an older copy of itself.
    fn take(&mut self, connection: &str, nodes: &[Value]) {
        match connection {
            "pullRequests" => {
                let mut by: BTreeMap<u64, PullRecord> = self
                    .pull_requests
                    .drain(..)
                    .map(|p| (p.number, p))
                    .collect();
                for p in nodes.iter().filter_map(pull) {
                    by.insert(p.number, p);
                }
                self.pull_requests = by.into_values().collect();
            }
            "issues" => {
                let mut by: BTreeMap<u64, IssueRecord> =
                    self.issues.drain(..).map(|i| (i.number, i)).collect();
                for i in nodes.iter().filter_map(issue) {
                    by.insert(i.number, i);
                }
                self.issues = by.into_values().collect();
            }
            _ => {
                for r in nodes.iter().filter_map(release) {
                    self.releases.retain(|x| x.tag != r.tag);
                    self.releases.push(r);
                }
                self.releases.sort_by_key(|r| r.published);
            }
        }
    }
}

/// Asks GitHub through `gh`, never from `gh`'s cache: the point of a page
/// is what changed.
pub fn gh(remote: &Remote) -> impl FnMut(&Query) -> Result<Vec<u8>, ForgeError> + '_ {
    move |q: &Query| {
        let after = q.after.as_ref().map(|a| ("after", a.as_str()));
        crate::gh_graphql_with(remote, &q.graphql, None, after.as_slice())
    }
}

/// A page of one list.
struct Page {
    nodes: Vec<Value>,
    has_next: bool,
    end: Option<String>,
    total: u64,
}

impl Page {
    fn read(bytes: &[u8], connection: &str) -> Result<Page, ForgeError> {
        let v: Value =
            serde_json::from_slice(bytes).map_err(|e| ForgeError::Unreadable(e.to_string()))?;
        if let Some(message) = v.pointer("/errors/0/message").and_then(Value::as_str) {
            return Err(ForgeError::Failed(message.to_string()));
        }
        let list = v
            .pointer(&format!("/data/repository/{connection}"))
            .ok_or_else(|| ForgeError::Unreadable(format!("no {connection} in the answer")))?;
        Ok(Page {
            nodes: list
                .get("nodes")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            has_next: list
                .pointer("/pageInfo/hasNextPage")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            end: list
                .pointer("/pageInfo/endCursor")
                .and_then(Value::as_str)
                .map(str::to_string),
            total: list.get("totalCount").and_then(Value::as_u64).unwrap_or(0),
        })
    }
}

fn time(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_str).and_then(parse_iso8601)
}

fn login(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|a| a.get("login"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn pull(v: &Value) -> Option<PullRecord> {
    Some(PullRecord {
        number: v.get("number")?.as_u64()?,
        author: login(v, "author"),
        created: time(v, "createdAt")?,
        merged: time(v, "mergedAt"),
        closed: time(v, "closedAt"),
        merged_by: login(v, "mergedBy"),
        reviews: v
            .pointer("/reviews/nodes")
            .and_then(Value::as_array)
            .map(|rs| {
                rs.iter()
                    .map(|r| Review {
                        author: login(r, "author"),
                        state: r
                            .get("state")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        submitted: time(r, "submittedAt"),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    })
}

fn issue(v: &Value) -> Option<IssueRecord> {
    let author = login(v, "author");
    let first_response = v
        .pointer("/comments/nodes")
        .and_then(Value::as_array)
        .and_then(|cs| {
            cs.iter()
                .filter(|c| login(c, "author") != author)
                .find_map(|c| time(c, "createdAt"))
        });
    Some(IssueRecord {
        number: v.get("number")?.as_u64()?,
        author,
        created: time(v, "createdAt")?,
        closed: time(v, "closedAt"),
        first_response,
    })
}

fn release(v: &Value) -> Option<ReleaseRecord> {
    Some(ReleaseRecord {
        tag: v.get("tagName")?.as_str()?.to_string(),
        name: v
            .get("name")
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .map(str::to_string),
        published: time(v, "publishedAt"),
        prerelease: v
            .get("isPrerelease")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}
