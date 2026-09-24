//! What a code host says about a repository: GitHub for now, asked through
//! the `gh` CLI the user has already signed in with (ADR-0009).
//!
//! Nothing here touches git or the index. The binary reads the remote URL,
//! [`Remote::parse`] names the repository, and [`GitHub::fetch`] asks one
//! GraphQL query, off the startup path. `gh` caches the answer for an hour.

pub mod accounts;
pub mod history;

use std::process::Command;

use commitscape_core::parse_iso8601;
use serde::Deserialize;

/// Runs a GraphQL query about `remote` through `gh`, which keeps the answer
/// for `cache` (`1h`, `24h`). The query takes `$owner` and `$name`.
pub(crate) fn gh_graphql(remote: &Remote, query: &str, cache: &str) -> Result<Vec<u8>, ForgeError> {
    gh_graphql_with(remote, query, Some(cache), &[])
}

/// [`gh_graphql`] with more string variables, and no caching when `cache`
/// is `None`.
pub(crate) fn gh_graphql_with(
    remote: &Remote,
    query: &str,
    cache: Option<&str>,
    vars: &[(&str, &str)],
) -> Result<Vec<u8>, ForgeError> {
    // `-f` passes each value as a plain string; `-F` would read a value
    // starting with `@` as a file and turn a numeric name into a number.
    let mut cmd = Command::new("gh");
    cmd.args(["api", "graphql"]);
    if let Some(cache) = cache {
        cmd.args(["--cache", cache]);
    }
    cmd.args(["-f", &format!("owner={}", remote.owner)])
        .args(["-f", &format!("name={}", remote.name)]);
    for (k, v) in vars {
        cmd.args(["-f", &format!("{k}={v}")]);
    }
    let out = cmd
        .args(["-f", &format!("query={query}")])
        .env("GH_PROMPT_DISABLED", "1")
        .output()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => ForgeError::NoCli,
            _ => ForgeError::Failed(e.to_string()),
        })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let first = stderr.lines().next().unwrap_or_default().trim().to_string();
        return Err(if stderr.contains("gh auth login") {
            ForgeError::NotSignedIn
        } else if stderr.contains("Could not resolve to a Repository") {
            ForgeError::NotFound(format!("{}/{}", remote.owner, remote.name))
        } else {
            ForgeError::Failed(first)
        });
    }
    Ok(out.stdout)
}

/// A code host the tool can ask. GitHub is the first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    GitHub,
}

/// A repository on a code host, as a remote URL names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remote {
    pub host: Host,
    pub owner: String,
    pub name: String,
}

impl Remote {
    /// Reads `git@github.com:owner/name.git`,
    /// `https://github.com/owner/name`, `ssh://git@github.com/owner/name.git`
    /// and the like. A remote on any other host is `None`, for now.
    pub fn parse(url: &str) -> Option<Remote> {
        let url = url.trim();
        let schemed = ["https://", "http://", "ssh://", "git+ssh://", "git://"]
            .iter()
            .find_map(|scheme| url.strip_prefix(scheme));
        let (host, path) = match schemed {
            // `[user@]host[:port]/owner/name`
            Some(rest) => {
                let (authority, path) = rest.split_once('/')?;
                let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
                (host.split(':').next()?, path)
            }
            // scp-like: `[user@]host:owner/name`
            None => {
                let (authority, path) = url.split_once(':')?;
                (
                    authority.rsplit_once('@').map_or(authority, |(_, h)| h),
                    path,
                )
            }
        };
        if !matches!(
            host.to_ascii_lowercase().as_str(),
            "github.com" | "www.github.com"
        ) {
            return None;
        }
        let path = path.trim_end_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        let (owner, name) = path.split_once('/')?;
        let usable = |s: &str| !s.is_empty() && !s.contains('/');
        (usable(owner) && usable(name)).then(|| Remote {
            host: Host::GitHub,
            owner: owner.to_string(),
            name: name.to_string(),
        })
    }
}

/// What GitHub says about a repository.
#[derive(Debug, Clone, PartialEq)]
pub struct GitHub {
    pub name_with_owner: String,
    pub description: Option<String>,
    pub url: String,
    pub homepage: Option<String>,
    pub created: Option<i64>,
    pub pushed: Option<i64>,
    pub private: bool,
    pub fork: bool,
    pub archived: bool,
    pub stars: u64,
    pub forks: u64,
    pub watchers: u64,
    pub open_issues: u64,
    pub closed_issues: u64,
    pub open_prs: u64,
    pub merged_prs: u64,
    pub closed_prs: u64,
    pub releases: u64,
    pub latest_release: Option<Release>,
    /// The SPDX id of its license, when GitHub recognises one.
    pub license: Option<String>,
    pub topics: Vec<String>,
    /// Bytes of code by language, as GitHub counts them, largest first.
    pub languages: Vec<(String, u64)>,
    /// The last hundred pull requests opened, oldest first.
    pub recent_prs: Vec<PullRequest>,
    /// The last hundred issues opened, oldest first.
    pub recent_issues: Vec<Issue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub name: Option<String>,
    pub tag: String,
    pub published: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrState {
    Open,
    Merged,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequest {
    pub created: i64,
    pub merged: Option<i64>,
    pub closed: Option<i64>,
    pub state: PrState,
    /// The author's login; `ghost` for a deleted account, as GitHub shows it.
    pub author: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Issue {
    pub created: i64,
    pub closed: Option<i64>,
    pub open: bool,
}

/// Why GitHub's numbers are not available.
#[derive(Debug, thiserror::Error)]
pub enum ForgeError {
    #[error("the GitHub CLI (gh) is not installed")]
    NoCli,
    #[error("gh is not signed in; run `gh auth login`")]
    NotSignedIn,
    #[error("GitHub has no repository {0} that this account can see")]
    NotFound(String),
    #[error("gh failed: {0}")]
    Failed(String),
    #[error("GitHub's answer could not be read: {0}")]
    Unreadable(String),
}

/// How many of the latest pull requests and issues [`QUERY`] asks for.
const RECENT: usize = 100;

/// One query for everything the interface shows.
const QUERY: &str = "query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner description url homepageUrl createdAt pushedAt isPrivate isFork isArchived
    stargazerCount forkCount
    watchers { totalCount }
    openIssues: issues(states: OPEN) { totalCount }
    closedIssues: issues(states: CLOSED) { totalCount }
    openPullRequests: pullRequests(states: OPEN) { totalCount }
    mergedPullRequests: pullRequests(states: MERGED) { totalCount }
    closedPullRequests: pullRequests(states: CLOSED) { totalCount }
    releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount nodes { name tagName publishedAt }
    }
    licenseInfo { spdxId }
    languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name } } }
    repositoryTopics(first: 10) { nodes { topic { name } } }
    recentPullRequests: pullRequests(last: 100) {
      nodes { createdAt mergedAt closedAt state author { login } }
    }
    recentIssues: issues(last: 100) { nodes { createdAt closedAt state } }
  }
}";

impl GitHub {
    /// Asks GitHub through `gh`. `gh` keeps the answer for an hour, so
    /// asking again within the hour sends no request.
    pub fn fetch(remote: &Remote) -> Result<GitHub, ForgeError> {
        GitHub::from_graphql(&gh_graphql(remote, QUERY, "1h")?)
    }

    /// Reads the answer to this crate's query.
    pub fn from_graphql(json: &[u8]) -> Result<GitHub, ForgeError> {
        let response: Response =
            serde_json::from_slice(json).map_err(|e| ForgeError::Unreadable(e.to_string()))?;
        let r = response
            .data
            .and_then(|d| d.repository)
            .ok_or_else(|| ForgeError::Unreadable("no repository in the answer".to_string()))?;
        let time = |t: &Option<String>| t.as_deref().and_then(parse_iso8601);
        Ok(GitHub {
            name_with_owner: r.name_with_owner,
            description: r.description.filter(|d| !d.is_empty()),
            url: r.url,
            homepage: r.homepage_url.filter(|h| !h.is_empty()),
            created: time(&r.created_at),
            pushed: time(&r.pushed_at),
            private: r.is_private,
            fork: r.is_fork,
            archived: r.is_archived,
            stars: r.stargazer_count,
            forks: r.fork_count,
            watchers: r.watchers.total_count,
            open_issues: r.open_issues.total_count,
            closed_issues: r.closed_issues.total_count,
            open_prs: r.open_pull_requests.total_count,
            merged_prs: r.merged_pull_requests.total_count,
            closed_prs: r.closed_pull_requests.total_count,
            releases: r.releases.total_count,
            latest_release: r.releases.nodes.into_iter().next().map(|n| Release {
                name: n.name.filter(|n| !n.is_empty()),
                tag: n.tag_name,
                published: time(&n.published_at),
            }),
            license: r.license_info.and_then(|l| l.spdx_id),
            topics: r
                .repository_topics
                .nodes
                .into_iter()
                .map(|n| n.topic.name)
                .collect(),
            languages: r
                .languages
                .map(|l| l.edges.into_iter().map(|e| (e.node.name, e.size)).collect())
                .unwrap_or_default(),
            recent_prs: r
                .recent_pull_requests
                .nodes
                .into_iter()
                .filter_map(|p| {
                    Some(PullRequest {
                        created: parse_iso8601(&p.created_at)?,
                        merged: time(&p.merged_at),
                        closed: time(&p.closed_at),
                        state: match p.state.as_str() {
                            "MERGED" => PrState::Merged,
                            "CLOSED" => PrState::Closed,
                            _ => PrState::Open,
                        },
                        author: p.author.map_or_else(|| "ghost".to_string(), |a| a.login),
                    })
                })
                .collect(),
            recent_issues: r
                .recent_issues
                .nodes
                .into_iter()
                .filter_map(|i| {
                    Some(Issue {
                        created: parse_iso8601(&i.created_at)?,
                        closed: time(&i.closed_at),
                        open: i.state == "OPEN",
                    })
                })
                .collect(),
        })
    }

    /// Recent pull requests merged at or after `since`.
    pub fn prs_merged_since(&self, since: i64) -> usize {
        self.recent_prs
            .iter()
            .filter(|p| p.merged.is_some_and(|m| m >= since))
            .count()
    }

    /// Recent pull requests opened at or after `since`.
    pub fn prs_opened_since(&self, since: i64) -> usize {
        self.recent_prs
            .iter()
            .filter(|p| p.created >= since)
            .count()
    }

    /// The median time from opening to merging, over the recent pull
    /// requests that were merged.
    pub fn median_hours_to_merge(&self) -> Option<f64> {
        let mut hours: Vec<f64> = self
            .recent_prs
            .iter()
            .filter_map(|p| p.merged.map(|m| (m - p.created) as f64 / 3600.0))
            .collect();
        hours.sort_by(f64::total_cmp);
        let middle = hours.len() / 2;
        match hours.len() {
            0 => None,
            n if n % 2 == 1 => hours.get(middle).copied(),
            _ => Some((hours.get(middle - 1)? + hours.get(middle)?) / 2.0),
        }
    }

    /// Recent issues opened at or after `since`.
    pub fn issues_opened_since(&self, since: i64) -> usize {
        self.recent_issues
            .iter()
            .filter(|i| i.created >= since)
            .count()
    }

    /// Whether the recent issues reach back to `since`, so that what they
    /// count since then is whole. When they do not, only the last hundred
    /// were asked for and there were more.
    pub fn issues_reach(&self, since: i64) -> bool {
        self.recent_issues.len() < RECENT || self.recent_issues.iter().any(|i| i.created < since)
    }

    /// Recent issues closed at or after `since`.
    pub fn issues_closed_since(&self, since: i64) -> usize {
        self.recent_issues
            .iter()
            .filter(|i| i.closed.is_some_and(|c| c >= since))
            .count()
    }

    /// Who opened the recent pull requests, most first, then by login.
    pub fn pr_authors(&self) -> Vec<(String, usize)> {
        let mut logins: Vec<&str> = self.recent_prs.iter().map(|p| p.author.as_str()).collect();
        logins.sort_unstable();
        let mut out: Vec<(String, usize)> = Vec::new();
        for login in logins {
            match out.last_mut() {
                Some((l, n)) if l == login => *n += 1,
                _ => out.push((login.to_string(), 1)),
            }
        }
        out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        out
    }
}

#[derive(Deserialize)]
struct Response {
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    repository: Option<Repository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
    description: Option<String>,
    url: String,
    homepage_url: Option<String>,
    created_at: Option<String>,
    pushed_at: Option<String>,
    is_private: bool,
    is_fork: bool,
    is_archived: bool,
    stargazer_count: u64,
    fork_count: u64,
    watchers: Count,
    open_issues: Count,
    closed_issues: Count,
    open_pull_requests: Count,
    merged_pull_requests: Count,
    closed_pull_requests: Count,
    releases: Releases,
    license_info: Option<LicenseInfo>,
    languages: Option<LanguageEdges>,
    repository_topics: Nodes<TopicNode>,
    recent_pull_requests: Nodes<PrNode>,
    recent_issues: Nodes<IssueNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Count {
    total_count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Releases {
    total_count: u64,
    nodes: Vec<ReleaseNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseNode {
    name: Option<String>,
    tag_name: String,
    published_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicenseInfo {
    spdx_id: Option<String>,
}

#[derive(Deserialize)]
struct LanguageEdges {
    edges: Vec<LanguageEdge>,
}

#[derive(Deserialize)]
struct LanguageEdge {
    size: u64,
    node: Named,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
struct TopicNode {
    topic: Named,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrNode {
    created_at: String,
    merged_at: Option<String>,
    closed_at: Option<String>,
    state: String,
    author: Option<Login>,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    created_at: String,
    closed_at: Option<String>,
    state: String,
}

#[cfg(test)]
mod tests {
    use super::{QUERY, RECENT};

    #[test]
    fn the_query_asks_for_as_many_recent_items_as_the_counts_assume() {
        assert!(QUERY.contains(&format!("pullRequests(last: {RECENT})")));
        assert!(QUERY.contains(&format!("issues(last: {RECENT})")));
    }
}
