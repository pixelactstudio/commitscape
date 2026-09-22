//! `.mailmap` parsing.
//!
//! ADR-0006 puts git's own mechanism first, ahead of any heuristic, because a
//! mailmap is declared by the repository's owners, versioned with the code, and
//! inspectable by anyone who doubts a number.
//!
//! Parsed here rather than through `gix-mailmap` so that the trait in
//! [`crate::source`] can return a plain type. A gix `Snapshot` crossing the
//! seam would put a gix type in the index layer's public interface, which is
//! precisely what ADR-0001 forbids.
//!
//! The four forms git defines:
//!
//! ```text
//! Proper Name <proper@email>
//! <proper@email> <commit@email>
//! Proper Name <proper@email> <commit@email>
//! Proper Name <proper@email> Commit Name <commit@email>
//! ```

/// One rewrite rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailmapRule {
    /// Replacement name, if the rule supplies one.
    pub proper_name: Option<Vec<u8>>,
    pub proper_email: Vec<u8>,
    /// Name the commit must match, if the rule is name-qualified.
    pub match_name: Option<Vec<u8>>,
    /// Email the commit must match. Matched case-insensitively, as git does.
    pub match_email: Vec<u8>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Mailmap {
    rules: Vec<MailmapRule>,
    /// Lowercased commit email -> indices of the rules matching it, in file
    /// order. A large project's mailmap has a thousand rules and its history
    /// tens of thousands of signatures, so resolving must not scan every rule.
    by_email: std::collections::HashMap<Vec<u8>, Vec<usize>>,
}

impl Mailmap {
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// A stable hash of the rules, so the cache can tell when a mailmap
    /// changed and people need re-resolving.
    pub fn fingerprint(&self) -> u64 {
        let mut h = xxhash_rust::xxh3::Xxh3::new();
        for rule in &self.rules {
            for part in [
                rule.proper_name.as_deref(),
                Some(rule.proper_email.as_slice()),
                rule.match_name.as_deref(),
                Some(rule.match_email.as_slice()),
            ] {
                match part {
                    Some(bytes) => {
                        h.update(&[1]);
                        h.update(&(bytes.len() as u64).to_le_bytes());
                        h.update(bytes);
                    }
                    None => h.update(&[0]),
                }
            }
        }
        h.digest()
    }

    /// Parses mailmap file contents. Malformed lines are skipped, matching
    /// git's own tolerance — a typo in a mailmap must not stop the tool.
    pub fn parse(bytes: &[u8]) -> Mailmap {
        let mut rules = Vec::new();
        for line in bytes.split(|&b| b == b'\n') {
            let line = strip_comment(line);
            if line.is_empty() {
                continue;
            }
            if let Some(rule) = parse_line(line) {
                rules.push(rule);
            }
        }
        let mut by_email: std::collections::HashMap<Vec<u8>, Vec<usize>> =
            std::collections::HashMap::new();
        for (i, rule) in rules.iter().enumerate() {
            by_email
                .entry(rule.match_email.to_ascii_lowercase())
                .or_default()
                .push(i);
        }
        Mailmap { rules, by_email }
    }

    /// Applies the mailmap to a raw identity, returning the canonical one.
    ///
    /// Name-qualified rules are checked first: git resolves the most specific
    /// match, so a rule naming both a name and an email must win over one
    /// naming only an email.
    pub fn resolve<'a>(&'a self, name: &'a [u8], email: &'a [u8]) -> (&'a [u8], &'a [u8]) {
        let mut best: Option<&MailmapRule> = None;
        let candidates = self
            .by_email
            .get(&email.to_ascii_lowercase())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for rule in candidates.iter().filter_map(|&i| self.rules.get(i)) {
            match &rule.match_name {
                Some(n) if eq_ignore_case(n, name) => {
                    best = Some(rule);
                    break;
                }
                Some(_) => continue,
                None => {
                    if best.is_none() {
                        best = Some(rule);
                    }
                }
            }
        }
        match best {
            Some(rule) => (
                rule.proper_name.as_deref().unwrap_or(name),
                &rule.proper_email,
            ),
            None => (name, email),
        }
    }
}

fn strip_comment(line: &[u8]) -> &[u8] {
    let end = line.iter().position(|&b| b == b'#').unwrap_or(line.len());
    let slice = line.get(..end).unwrap_or(&[]);
    trim(slice)
}

fn trim(mut s: &[u8]) -> &[u8] {
    while let Some((first, rest)) = s.split_first() {
        if first.is_ascii_whitespace() {
            s = rest;
        } else {
            break;
        }
    }
    while let Some((last, rest)) = s.split_last() {
        if last.is_ascii_whitespace() {
            s = rest;
        } else {
            break;
        }
    }
    s
}

/// Splits a line into its `Name <email>` parts, in order.
fn parse_line(line: &[u8]) -> Option<MailmapRule> {
    let mut parts: Vec<(Option<Vec<u8>>, Vec<u8>)> = Vec::new();
    let mut rest = line;

    while let Some(open) = rest.iter().position(|&b| b == b'<') {
        let close = rest.iter().position(|&b| b == b'>')?;
        if close < open {
            return None;
        }
        let name = trim(rest.get(..open)?);
        let email = rest.get(open + 1..close)?;
        parts.push((
            (!name.is_empty()).then(|| name.to_vec()),
            trim(email).to_vec(),
        ));
        rest = rest.get(close + 1..)?;
    }

    match parts.len() {
        // `Proper Name <proper@email>` — canonicalises the name for that email.
        1 => {
            let (name, email) = parts.into_iter().next()?;
            Some(MailmapRule {
                proper_name: name,
                proper_email: email.clone(),
                match_name: None,
                match_email: email,
            })
        }
        // Either `<proper> <commit>` or `Name <proper> [Commit Name] <commit>`.
        2 => {
            let mut it = parts.into_iter();
            let (proper_name, proper_email) = it.next()?;
            let (match_name, match_email) = it.next()?;
            Some(MailmapRule {
                proper_name,
                proper_email,
                match_name,
                match_email,
            })
        }
        _ => None,
    }
}

fn eq_ignore_case(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .all(|(x, y)| x.eq_ignore_ascii_case(y))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(b: &[u8]) -> String {
        String::from_utf8_lossy(b).into_owned()
    }

    #[test]
    fn maps_an_alternate_email_onto_the_canonical_identity() {
        // This is the exact rule in the `ownership` fixture.
        let m = Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example.org>\n");
        assert_eq!(m.len(), 1);
        let (name, email) = m.resolve(b"A. Example", b"alice@work.example.org");
        assert_eq!(s(name), "Alice Example");
        assert_eq!(s(email), "alice@example.com");
    }

    #[test]
    fn leaves_unmatched_identities_untouched() {
        let m = Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example.org>\n");
        let (name, email) = m.resolve(b"Bob Example", b"bob@example.com");
        assert_eq!(s(name), "Bob Example");
        assert_eq!(s(email), "bob@example.com");
    }

    #[test]
    fn matches_the_commit_email_case_insensitively() {
        let m = Mailmap::parse(b"Alice <alice@example.com> <OLD@Example.ORG>\n");
        let (_, email) = m.resolve(b"whoever", b"old@example.org");
        assert_eq!(s(email), "alice@example.com");
    }

    #[test]
    fn name_qualified_rule_wins_over_email_only_rule() {
        // Two people share one email; only the name distinguishes them. git
        // resolves the more specific rule, and so must we, or one of them
        // silently becomes the other.
        let m = Mailmap::parse(
            b"Generic Person <generic@example.com> <shared@example.com>\n\
              Specific Person <specific@example.com> Specific Name <shared@example.com>\n",
        );
        let (name, email) = m.resolve(b"Specific Name", b"shared@example.com");
        assert_eq!(s(name), "Specific Person");
        assert_eq!(s(email), "specific@example.com");

        let (_, other) = m.resolve(b"Someone Else", b"shared@example.com");
        assert_eq!(s(other), "generic@example.com");
    }

    #[test]
    fn canonicalises_a_name_for_an_email() {
        let m = Mailmap::parse(b"Proper Name <same@example.com>\n");
        let (name, email) = m.resolve(b"typo nmae", b"same@example.com");
        assert_eq!(s(name), "Proper Name");
        assert_eq!(s(email), "same@example.com");
    }

    #[test]
    fn skips_comments_blank_lines_and_malformed_entries() {
        let m = Mailmap::parse(
            b"# a comment\n\
              \n\
              this line has no angle brackets\n\
              Alice <alice@example.com>   # trailing comment\n",
        );
        assert_eq!(m.len(), 1);
    }
}
