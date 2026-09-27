use commitscape_core::{CommitKind, SUBJECT_CAP};

pub fn subject_of(message: &[u8]) -> String {
    let first = message.split(|&b| b == b'\n').next().unwrap_or_default();
    let text = String::from_utf8_lossy(first);
    let text = text.trim();
    let mut end = text.len().min(SUBJECT_CAP);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.get(..end).unwrap_or_default().to_string()
}

pub fn kind_of(message: &[u8]) -> CommitKind {
    let text = String::from_utf8_lossy(message);
    kind_of_subject(text.lines().next().unwrap_or_default().trim())
}

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

#[cfg(test)]
mod subject_tests {
    use super::subject_of;

    #[test]
    fn a_subject_is_the_first_line_trimmed_and_capped_at_a_character() {
        assert_eq!(subject_of(b"  fix: the walk  \n\nbody"), "fix: the walk");
        assert_eq!(subject_of(b""), "");
        let long = format!("{}\u{e9} and more", "a".repeat(199));
        assert_eq!(subject_of(long.as_bytes()), "a".repeat(199));
    }
}
