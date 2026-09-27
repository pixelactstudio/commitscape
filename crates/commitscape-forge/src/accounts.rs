use crate::{ForgeError, Remote};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitAuthor {
    pub id: u64,
    pub login: String,
}

const BATCH: usize = 100;

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
