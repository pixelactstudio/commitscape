use std::process::Command;

use commitscape_core::parse_iso8601;
use serde::Deserialize;

fn gh_graphql(remote: &Remote, query: &str, cache: &str) -> Result<Vec<u8>, ForgeError> {
    let out = Command::new("gh")
        .args(["api", "graphql", "--cache", cache])
        .args(["-f", &format!("owner={}", remote.owner)])
        .args(["-f", &format!("name={}", remote.name)])
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    GitHub,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remote {
    pub host: Host,
    pub owner: String,
    pub name: String,
}

impl Remote {
    pub fn parse(url: &str) -> Option<Remote> {
        let url = url.trim();
        let schemed = ["https://", "http://", "ssh://", "git+ssh://", "git://"]
            .iter()
            .find_map(|scheme| url.strip_prefix(scheme));
        let (host, path) = match schemed {
            Some(rest) => {
                let (authority, path) = rest.split_once('/')?;
                let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
                (host.split(':').next()?, path)
            }
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

#[derive(Debug, Clone, PartialEq)]
pub struct GitHub {
    pub archived: bool,
    pub recent_issues: Vec<Issue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Issue {
    pub created: i64,
    pub first_answer: Option<i64>,
}

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

const QUERY: &str = "query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    isArchived
    recentIssues: issues(last: 100) {
      nodes { createdAt author { login } comments(first: 5) { nodes { createdAt author { login __typename } } } }
    }
  }
}";

impl GitHub {
    pub fn fetch(remote: &Remote) -> Result<GitHub, ForgeError> {
        GitHub::from_graphql(&gh_graphql(remote, QUERY, "1h")?)
    }

    pub fn from_graphql(json: &[u8]) -> Result<GitHub, ForgeError> {
        let response: Response =
            serde_json::from_slice(json).map_err(|e| ForgeError::Unreadable(e.to_string()))?;
        let r = response
            .data
            .and_then(|d| d.repository)
            .ok_or_else(|| ForgeError::Unreadable("no repository in the answer".to_string()))?;
        Ok(GitHub {
            archived: r.is_archived,
            recent_issues: r
                .recent_issues
                .nodes
                .into_iter()
                .filter_map(|i| {
                    let author = i.author.map(|a| a.login);
                    let first_answer = i
                        .comments
                        .nodes
                        .iter()
                        .filter(|c| c.author.as_ref().is_none_or(|a| !a.is_bot()))
                        .filter(|c| c.author.as_ref().map(|a| &a.login) != author.as_ref())
                        .find_map(|c| parse_iso8601(&c.created_at));
                    Some(Issue {
                        created: parse_iso8601(&i.created_at)?,
                        first_answer,
                    })
                })
                .collect(),
        })
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
    is_archived: bool,
    recent_issues: Nodes<IssueNode>,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
struct Login {
    login: String,
    #[serde(rename = "__typename", default)]
    kind: Option<String>,
}

impl Login {
    fn is_bot(&self) -> bool {
        self.kind.as_deref() == Some("Bot") || commitscape_core::is_bot_name(&self.login)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    created_at: String,
    #[serde(default)]
    author: Option<Login>,
    #[serde(default)]
    comments: CommentNodes,
}

#[derive(Deserialize, Default)]
struct CommentNodes {
    #[serde(default)]
    nodes: Vec<CommentNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentNode {
    created_at: String,
    #[serde(default)]
    author: Option<Login>,
}
