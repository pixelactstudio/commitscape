//! A repository's whole GitHub history (ADR-0009, amended in Build Run 3):
//! every pull request, issue and release, fetched a page at a time, oldest
//! change first, saved after every page. Pages here are written by hand and
//! served by a fake in place of `gh`.

#![allow(clippy::expect_used)]

use std::cell::RefCell;

use commitscape_forge::history::{History, Query};
use commitscape_forge::ForgeError;

/// 2025-07-01T00:00:00Z.
const JULY_1_2025: i64 = 1_751_328_000;
const HOUR: i64 = 3_600;

/// A page of pull requests: `numbers`, each opened on 1 July 2025 at hour
/// `n`, merged an hour later by `lead` when `n` is even, with one review.
fn pr_page(numbers: &[u64], next: Option<&str>) -> String {
    let nodes: Vec<String> = numbers
        .iter()
        .map(|&n| {
            let merged = if n % 2 == 0 {
                format!(r#""mergedAt":"2025-07-01T{:02}:00:00Z","closedAt":"2025-07-01T{:02}:00:00Z","state":"MERGED","mergedBy":{{"login":"lead"}}"#, n + 1, n + 1)
            } else {
                r#""mergedAt":null,"closedAt":null,"state":"OPEN","mergedBy":null"#.to_string()
            };
            format!(
                r#"{{"number":{n},"author":{{"login":"dev{n}"}},"createdAt":"2025-07-01T{n:02}:00:00Z",{merged},"reviews":{{"nodes":[{{"author":{{"login":"lead"}},"state":"APPROVED","submittedAt":"2025-07-01T{n:02}:30:00Z"}}]}}}}"#
            )
        })
        .collect();
    connection("pullRequests", 4, &nodes, next)
}

fn connection(name: &str, total: u64, nodes: &[String], next: Option<&str>) -> String {
    let (has_next, cursor) = match next {
        Some(c) => ("true", format!(r#""{c}""#)),
        None => ("false", r#""end""#.to_string()),
    };
    format!(
        r#"{{"data":{{"repository":{{"{name}":{{"totalCount":{total},"pageInfo":{{"hasNextPage":{has_next},"endCursor":{cursor}}},"nodes":[{}]}}}}}}}}"#,
        nodes.join(",")
    )
}

/// One issue, opened by `alice` at 09:00, first answered by `bob` at 10:00
/// after a comment of her own at 09:30, closed at 12:00.
fn issue_page() -> String {
    let node = r#"{"number":7,"author":{"login":"alice"},"createdAt":"2025-07-01T09:00:00Z","closedAt":"2025-07-01T12:00:00Z","comments":{"nodes":[{"author":{"login":"alice"},"createdAt":"2025-07-01T09:30:00Z"},{"author":{"login":"bob"},"createdAt":"2025-07-01T10:00:00Z"}]}}"#;
    connection("issues", 1, &[node.to_string()], None)
}

fn release_page() -> String {
    let node = r#"{"tagName":"v1.0.0","name":"One","publishedAt":"2025-07-02T00:00:00Z","isPrerelease":false}"#;
    connection("releases", 1, &[node.to_string()], None)
}

/// Serves pages by what the query asks for and where it starts.
fn serve(query: &Query) -> Result<Vec<u8>, ForgeError> {
    let page = match (query.connection, query.after.as_deref()) {
        ("pullRequests", None) => pr_page(&[1, 2], Some("p1")),
        ("pullRequests", Some("p1")) => pr_page(&[3, 4], None),
        ("pullRequests", Some("end")) => pr_page(&[], None),
        ("issues", _) => issue_page(),
        ("releases", _) => release_page(),
        other => return Err(ForgeError::Failed(format!("unexpected query {other:?}"))),
    };
    Ok(page.into_bytes())
}

#[test]
fn every_page_is_read_into_records() {
    let mut history = History::default();
    history
        .update(None, &mut serve, &mut |_| {})
        .expect("fetched");
    let numbers: Vec<u64> = history.pull_requests.iter().map(|p| p.number).collect();
    assert_eq!(numbers, vec![1, 2, 3, 4]);
    let two = history.pull_requests.get(1).expect("a second");
    assert_eq!(two.author.as_deref(), Some("dev2"));
    assert_eq!(two.created, JULY_1_2025 + 2 * HOUR);
    assert_eq!(two.merged, Some(JULY_1_2025 + 3 * HOUR));
    assert_eq!(two.merged_by.as_deref(), Some("lead"));
    assert_eq!(two.reviews.len(), 1);
    assert_eq!(
        two.reviews.first().and_then(|r| r.author.as_deref()),
        Some("lead")
    );
    assert_eq!(history.pull_requests.first().and_then(|p| p.merged), None);

    let issue = history.issues.first().expect("an issue");
    assert_eq!(issue.closed, Some(JULY_1_2025 + 12 * HOUR));
    assert_eq!(
        issue.first_response,
        Some(JULY_1_2025 + 10 * HOUR),
        "the first answer from someone other than the author"
    );
    assert_eq!(
        history.releases.first().map(|r| r.tag.as_str()),
        Some("v1.0.0")
    );
    assert!(history.complete);
}

#[test]
fn an_interrupted_fetch_resumes_where_it_stopped() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("github.json");

    // GitHub stops answering after the first page: the rate limit.
    let mut first = History::default();
    let calls = RefCell::new(0);
    let mut limited = |q: &Query| {
        *calls.borrow_mut() += 1;
        match q.after.as_deref() {
            None => serve(q),
            Some(_) => Err(ForgeError::Failed("API rate limit exceeded".to_string())),
        }
    };
    let stopped = first.update(Some(&path), &mut limited, &mut |_| {});
    assert!(stopped.is_err());
    assert!(!first.complete);

    // The next run starts from what was saved, at the second page.
    let mut again = History::load(&path);
    assert_eq!(again.pull_requests.len(), 2, "the first page was kept");
    let mut asked = Vec::new();
    let mut resume = |q: &Query| {
        asked.push((q.connection, q.after.clone()));
        serve(q)
    };
    again
        .update(Some(&path), &mut resume, &mut |_| {})
        .expect("fetched");
    assert_eq!(
        asked.first(),
        Some(&("pullRequests", Some("p1".to_string()))),
        "it asks for the second page first"
    );
    assert_eq!(again.pull_requests.len(), 4);
    assert!(again.complete);
    assert_eq!(History::load(&path), again, "and saved it");
}

#[test]
fn a_later_fetch_asks_only_for_what_changed_and_replaces_it() {
    let mut history = History::default();
    history
        .update(None, &mut serve, &mut |_| {})
        .expect("fetched");

    // Pull request 1, open before, is merged since: it comes after the
    // cursor, as the most recently updated.
    let mut later = |q: &Query| -> Result<Vec<u8>, ForgeError> {
        match (q.connection, q.after.as_deref()) {
            ("pullRequests", Some("end")) => {
                let merged = pr_page(&[2], None).replace(r#""number":2"#, r#""number":1"#);
                Ok(merged.into_bytes())
            }
            (_, Some("end")) => serve(q),
            other => Err(ForgeError::Failed(format!(
                "asked again from the start: {other:?}"
            ))),
        }
    };
    history
        .update(None, &mut later, &mut |_| {})
        .expect("fetched");
    assert_eq!(history.pull_requests.len(), 4);
    assert_eq!(
        history.pull_requests.first().and_then(|p| p.merged),
        Some(JULY_1_2025 + 3 * HOUR),
        "number 1 replaced by its newer self"
    );
}
