//! Which GitHub account authored a commit (ADR-0011's rule 4): a query for
//! commit ids, and its answer read back, one account or none per commit.

#![allow(clippy::expect_used)]

use commitscape_forge::accounts::{authors_from_graphql, query_for, CommitAuthor};

const A: &str = "1111111111111111111111111111111111111111";
const B: &str = "2222222222222222222222222222222222222222";
const C: &str = "3333333333333333333333333333333333333333";

#[test]
fn the_query_names_each_commit_by_its_place() {
    let query = query_for(&[A.to_string(), B.to_string()]);
    assert!(
        query.contains(&format!("c0: object(oid: \"{A}\")")),
        "{query}"
    );
    assert!(
        query.contains(&format!("c1: object(oid: \"{B}\")")),
        "{query}"
    );
}

#[test]
fn only_commit_ids_go_into_the_query() {
    // Anything but forty hex digits would be text in someone else's query.
    let query = query_for(&["\") { x } #".to_string(), A.to_string()]);
    assert!(!query.contains("{ x }"), "{query}");
    assert!(
        query.contains(&format!("c1: object(oid: \"{A}\")")),
        "{query}"
    );
}

#[test]
fn each_commit_gets_its_account_or_none() {
    // A was pushed and its author's address is on an account; B was pushed
    // but its address is on no account; C was never pushed.
    let answer = br#"{"data":{"repository":{
        "c0": {"author": {"user": {"databaseId": 46247385, "login": "RyanLandDev"}}},
        "c1": {"author": {"user": null}},
        "c2": null
    }}}"#;
    let authors = authors_from_graphql(answer, 3).expect("readable");
    assert_eq!(
        authors,
        vec![
            Some(CommitAuthor {
                id: 46247385,
                login: "RyanLandDev".to_string()
            }),
            None,
            None,
        ]
    );
    let _ = C;
}
