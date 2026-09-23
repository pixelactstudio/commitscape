//! What a commit's message says: its kind, and whether an AI coding agent
//! co-wrote it.
//!
//! Read once, as the walk reads each commit, and kept as a few bits. Keeping
//! every message until the index is built would cost more memory than the
//! rest of the walk: Linux's 1.5 million messages are about 700 MB.

use commitscape_core::CommitKind;

/// What one commit message says.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MessageFacts {
    pub kind: CommitKind,
    /// An AI coding agent co-wrote the commit.
    pub agent: bool,
}

/// Addresses and bot names AI coding agents commit or co-author under,
/// lowercased. Specific enough that no person matches: a developer named
/// Claude is not an agent, `noreply@anthropic.com` is.
const AGENTS: &[&str] = &[
    "noreply@anthropic.com",
    "claude[bot]",
    "copilot@users.noreply.github.com",
    "copilot-swe-agent",
    "cursoragent@cursor.com",
    "devin-ai-integration",
    "codex@openai.com",
    "chatgpt-codex-connector",
    "noreply@aider.chat",
    "gemini-code-assist",
    "google-labs-jules",
    "amp@ampcode.com",
    "openhands@all-hands.dev",
    "sweep-ai",
    "factory-droid",
];

/// Lines, lowercased, in which an agent says it generated the change.
const GENERATED: &[&str] = &["generated with [claude code]", "generated with claude code"];

impl MessageFacts {
    /// Reads a message and the identity it was committed under.
    pub fn read(message: &[u8], author_name: &[u8], author_email: &[u8]) -> MessageFacts {
        let text = String::from_utf8_lossy(message);
        let subject = text.lines().next().unwrap_or_default().trim();
        let author = format!(
            "{} <{}>",
            String::from_utf8_lossy(author_name),
            String::from_utf8_lossy(author_email)
        )
        .to_ascii_lowercase();
        MessageFacts {
            kind: kind_of(subject),
            agent: names_an_agent(&author) || text.lines().any(says_an_agent_helped),
        }
    }
}

/// The type of a conventional commit subject, `type(scope)!: description`.
fn kind_of(subject: &str) -> CommitKind {
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

fn names_an_agent(identity: &str) -> bool {
    AGENTS.iter().any(|agent| identity.contains(agent))
}

fn says_an_agent_helped(line: &str) -> bool {
    let line = line.trim().to_ascii_lowercase();
    match line.strip_prefix("co-authored-by:") {
        Some(who) => names_an_agent(who),
        None => GENERATED.iter().any(|g| line.contains(g)),
    }
}
