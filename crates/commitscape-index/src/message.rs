//! What a commit's message says it is: its Commit Kind.
//!
//! Read once, as the walk reads each commit, and kept as a few bits. Keeping
//! every message until the index is built would cost more memory than the
//! rest of the walk: Linux's 1.5 million messages are about 700 MB.

use commitscape_core::CommitKind;

/// The Commit Kind a message's subject line declares.
pub fn kind_of(message: &[u8]) -> CommitKind {
    let text = String::from_utf8_lossy(message);
    kind_of_subject(text.lines().next().unwrap_or_default().trim())
}

/// The type of a conventional commit subject, `type(scope)!: description`.
fn kind_of_subject(subject: &str) -> CommitKind {
    if subject.starts_with("Revert \"") {
        return CommitKind::Revert;
    }
    let Some((head, _)) = subject.split_once(": ") else {
        return CommitKind::Other;
    };
    let head = head.strip_suffix('!').unwrap_or(head);
    let word = match head.split_once('(') {
        Some((word, scope)) if scope.ends_with(')') => word,
        Some(_) => return CommitKind::Other,
        None => head,
    };
    if word.is_empty() || !word.chars().all(|c| c.is_ascii_alphabetic()) {
        return CommitKind::Other;
    }
    match word.to_ascii_lowercase().as_str() {
        "feat" | "feature" => CommitKind::Feature,
        "fix" | "bugfix" | "hotfix" => CommitKind::Fix,
        "docs" | "doc" => CommitKind::Docs,
        "refactor" => CommitKind::Refactor,
        "test" | "tests" => CommitKind::Test,
        "perf" => CommitKind::Performance,
        "style" => CommitKind::Style,
        "build" | "ci" | "deps" => CommitKind::Build,
        "chore" => CommitKind::Chore,
        "revert" => CommitKind::Revert,
        _ => CommitKind::Other,
    }
}
