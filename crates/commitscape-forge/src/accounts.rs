//! Which GitHub account authored each of some commits: the strongest
//! evidence that two email addresses are one person (ADR-0011, rule 4).
//!
//! GitHub links a commit to an account through the author's email address.
//! One GraphQL query asks about up to a hundred commits by id; a commit
//! that was never pushed, or whose address is on no account, has none.

use crate::{ForgeError, Remote};

/// The account GitHub says wrote a commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitAuthor {
    /// GitHub's number for the account, which survives a rename.
    pub id: u64,
    pub login: String,
}

/// Commits asked about in one query.
const BATCH: usize = 100;

/// Asks GitHub who authored each commit, in order. Commit ids are forty
/// hexadecimal digits; anything else is answered with `None`.
pub fn commit_authors(
    remote: &Remote,
    commits: &[String],
) -> Result<Vec<Option<CommitAuthor>>, ForgeError> {
    let mut out = Vec::with_capacity(commits.len());
    for batch in commits.chunks(BATCH) {
        let query = query_for(batch);
        let answer = crate::gh_graphql(remote, &query, "24h")?;
        out.extend(authors_from_graphql(&answer, batch.len())?);
    }
    Ok(out)
}

/// The query for one batch: commit `n` is asked for as `cN`.
pub fn query_for(commits: &[String]) -> String {
    let mut q = String::from(
        "query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n",
    );
    for (n, id) in commits.iter().enumerate() {
        if id.len() == 40 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
            q.push_str(&format!(
                "    c{n}: object(oid: \"{id}\") {{ ... on Commit {{ author {{ user {{ databaseId login }} }} }} }}\n"
            ));
        }
    }
    q.push_str("  }\n}");
    q
}

/// Reads the answer to [`query_for`] over `n` commits.
pub fn authors_from_graphql(
    json: &[u8],
    n: usize,
) -> Result<Vec<Option<CommitAuthor>>, ForgeError> {
    let value: serde_json::Value =
        serde_json::from_slice(json).map_err(|e| ForgeError::Unreadable(e.to_string()))?;
    let repository = value.pointer("/data/repository");
    Ok((0..n)
        .map(|i| {
            let user = repository?.get(format!("c{i}"))?.pointer("/author/user")?;
            Some(CommitAuthor {
                id: user.get("databaseId")?.as_u64()?,
                login: user.get("login")?.as_str()?.to_string(),
            })
        })
        .collect())
}
