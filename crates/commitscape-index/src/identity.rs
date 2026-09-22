//! Resolving one person's several git identities (ADR-0006).
//!
//! Three rules, in order, and then it stops:
//!
//! 1. `.mailmap`, honoured as git defines it.
//! 2. Case-insensitive email equality.
//! 3. GitHub's `NNNN+user@users.noreply.github.com` folded onto
//!    `user@users.noreply.github.com`.
//!
//! Nothing else merges. Rules 2 and 3 are safe because both are
//! identity-preserving by construction: neither can fuse two people who were
//! ever distinct. Anything weaker — same display name, same email local-part —
//! is collected as a *suspected duplicate* and shown to the user as a prompt to
//! write a mailmap. It is never merged silently, because bus factor is the
//! metric where being confidently wrong does the most damage.

use std::collections::HashMap;

use commitscape_core::{Author, AuthorId, AuthorTable, Signature, SignatureId};

use crate::mailmap::Mailmap;

/// Resolves every signature to a person and returns the finished table.
///
/// `used` is parallel to `signatures`: how many commits each was used for. A person is displayed under the mailmap-resolved name and email
/// of their most-used signature, so the displayed identity does not depend on
/// the order the walk happened to meet signatures in, and an incremental
/// index shows the same names as a full one.
///
/// This is a pure function of its inputs. That is what makes a `.mailmap`
/// edit cheap: re-run it over the stored signatures, and no history is read.
pub fn resolve_authors(
    signatures: Vec<Signature>,
    used: Vec<u32>,
    mailmap: &Mailmap,
) -> AuthorTable {
    let mut by_key: HashMap<Vec<u8>, AuthorId> = HashMap::new();
    let mut members: Vec<Vec<SignatureId>> = Vec::new();
    let mut person_of = Vec::with_capacity(signatures.len());

    for (i, sig) in signatures.iter().enumerate() {
        let (_, email) = mailmap.resolve(sig.name.as_bytes(), sig.email.as_bytes());
        let key = canonical_email_key(email);
        let id = *by_key.entry(key).or_insert_with(|| {
            members.push(Vec::new());
            AuthorId(members.len() as u32 - 1)
        });
        if let Some(m) = members.get_mut(id.idx()) {
            m.push(SignatureId(i as u32));
        }
        person_of.push(id);
    }

    let authors: Vec<Author> = members
        .into_iter()
        .map(|sigs| {
            // Most commits wins; the lowest id breaks ties deterministically.
            let display = sigs
                .iter()
                .copied()
                .max_by_key(|s| {
                    let count = used.get(s.idx()).copied().unwrap_or(0);
                    (count, std::cmp::Reverse(s.0))
                })
                .and_then(|s| signatures.get(s.idx()));
            let (name, email) = match display {
                Some(sig) => {
                    let (n, e) = mailmap.resolve(sig.name.as_bytes(), sig.email.as_bytes());
                    (
                        String::from_utf8_lossy(n).into_owned(),
                        String::from_utf8_lossy(e).into_owned(),
                    )
                }
                None => (String::new(), String::new()),
            };
            Author {
                name,
                email,
                signatures: sigs,
            }
        })
        .collect();

    let suspects = suspected_duplicates(&authors);
    AuthorTable::new(signatures, used, person_of, authors, suspects)
}

/// Applies rules 2 and 3 to produce the key two identities must share to be
/// considered the same person.
fn canonical_email_key(email: &[u8]) -> Vec<u8> {
    let lower: Vec<u8> = email.to_ascii_lowercase();
    strip_github_numeric_prefix(&lower)
}

/// `12345+octocat@users.noreply.github.com` -> `octocat@users.noreply.github.com`.
///
/// Scoped strictly to the GitHub noreply domain. The `NNNN+` form is assigned
/// by GitHub and always denotes the same account as the bare form, so folding
/// them cannot merge two people.
fn strip_github_numeric_prefix(email: &[u8]) -> Vec<u8> {
    const DOMAIN: &[u8] = b"@users.noreply.github.com";
    if !email.ends_with(DOMAIN) {
        return email.to_vec();
    }
    let Some(at) = email.iter().position(|&b| b == b'@') else {
        return email.to_vec();
    };
    let Some(local) = email.get(..at) else {
        return email.to_vec();
    };
    let Some(plus) = local.iter().position(|&b| b == b'+') else {
        return email.to_vec();
    };
    let Some(digits) = local.get(..plus) else {
        return email.to_vec();
    };
    if digits.is_empty() || !digits.iter().all(|b| b.is_ascii_digit()) {
        return email.to_vec();
    }
    let Some(rest) = local.get(plus + 1..) else {
        return email.to_vec();
    };
    let mut out = rest.to_vec();
    out.extend_from_slice(DOMAIN);
    out
}

/// Groups of authors that look like the same person but were not merged.
///
/// Two signals, both deliberately weak, both surfaced rather than applied:
/// an identical display name across different emails, and an identical email
/// local-part across different domains.
fn suspected_duplicates(authors: &[Author]) -> Vec<Vec<AuthorId>> {
    let mut by_name: HashMap<String, Vec<AuthorId>> = HashMap::new();
    let mut by_local: HashMap<String, Vec<AuthorId>> = HashMap::new();

    for (i, author) in authors.iter().enumerate() {
        let id = AuthorId(i as u32);
        let name = author.name.trim().to_ascii_lowercase();
        if !name.is_empty() {
            by_name.entry(name).or_default().push(id);
        }
        if let Some((local, _)) = author.email.split_once('@') {
            let local = local.to_ascii_lowercase();
            // Local-parts this generic say nothing about identity; grouping on
            // them would produce a suggestion that is actively wrong.
            const GENERIC: &[&str] = &["root", "dev", "admin", "user", "git", "build", "ci"];
            if !local.is_empty() && !GENERIC.contains(&local.as_str()) {
                by_local.entry(local).or_default().push(id);
            }
        }
    }

    let mut groups: Vec<Vec<AuthorId>> = by_name
        .into_values()
        .chain(by_local.into_values())
        .filter(|g| g.len() > 1)
        .map(|mut g| {
            g.sort_unstable();
            g.dedup();
            g
        })
        .collect();
    groups.sort_unstable();
    groups.dedup();
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(name: &str, email: &str) -> Signature {
        Signature {
            name: name.to_string(),
            email: email.to_string(),
        }
    }

    /// Resolves with every signature used once.
    fn resolve(sigs: &[Signature], mailmap: &Mailmap) -> AuthorTable {
        resolve_authors(sigs.to_vec(), vec![1; sigs.len()], mailmap)
    }

    fn same_person(t: &AuthorTable, a: u32, b: u32) -> bool {
        t.person_of(SignatureId(a)) == t.person_of(SignatureId(b))
    }

    #[test]
    fn rule_2_folds_email_case() {
        let t = resolve(
            &[
                sig("Alice Example", "alice@example.com"),
                sig("Alice Example", "Alice@Example.COM"),
            ],
            &Mailmap::default(),
        );
        assert!(same_person(&t, 0, 1));
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn rule_3_folds_the_github_numeric_noreply_form() {
        let t = resolve(
            &[
                sig("Carol", "90210+carol@users.noreply.github.com"),
                sig("Carol", "carol@users.noreply.github.com"),
            ],
            &Mailmap::default(),
        );
        assert!(same_person(&t, 0, 1));
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn rule_3_is_scoped_to_github_and_to_numeric_prefixes() {
        // A `+` address on any other domain is a real, distinct address.
        assert_eq!(
            strip_github_numeric_prefix(b"12345+bob@example.com"),
            b"12345+bob@example.com".to_vec()
        );
        // A non-numeric prefix on the github domain is not the assigned form.
        assert_eq!(
            strip_github_numeric_prefix(b"team+bob@users.noreply.github.com"),
            b"team+bob@users.noreply.github.com".to_vec()
        );
        assert_eq!(
            strip_github_numeric_prefix(b"7+bob@users.noreply.github.com"),
            b"bob@users.noreply.github.com".to_vec()
        );
    }

    #[test]
    fn mailmap_resolves_what_the_two_rules_cannot() {
        let mailmap =
            Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example.org>\n");
        let t = resolve(
            &[
                sig("Alice Example", "alice@example.com"),
                sig("A. Example", "alice@work.example.org"),
            ],
            &mailmap,
        );
        assert!(
            same_person(&t, 0, 1),
            "the mailmap is what merges these two"
        );
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn distinct_people_are_never_merged() {
        let t = resolve(
            &[
                sig("Alice Example", "alice@example.com"),
                sig("Bob Example", "bob@example.com"),
            ],
            &Mailmap::default(),
        );
        assert!(!same_person(&t, 0, 1));
        assert_eq!(t.len(), 2);
    }

    #[test]
    fn a_shared_display_name_is_suspected_but_not_merged() {
        // The dangerous case: two real people both committing as "dev".
        let t = resolve(
            &[sig("dev", "one@example.com"), sig("dev", "two@example.com")],
            &Mailmap::default(),
        );
        assert!(
            !same_person(&t, 0, 1),
            "a shared display name must not merge identities"
        );
        assert_eq!(t.len(), 2);
        assert_eq!(
            t.suspected_duplicates,
            vec![vec![AuthorId(0), AuthorId(1)]],
            "but it must be surfaced so the user can write a mailmap"
        );
    }

    #[test]
    fn generic_local_parts_do_not_generate_suggestions() {
        // root@host-a and root@host-b are not evidence of anything.
        let t = resolve(
            &[
                sig("Someone", "root@host-a.example.com"),
                sig("Another", "root@host-b.example.com"),
            ],
            &Mailmap::default(),
        );
        assert_eq!(t.len(), 2);
        assert!(
            t.suspected_duplicates.is_empty(),
            "shared generic local-parts say nothing about identity"
        );
    }

    #[test]
    fn a_person_is_shown_under_their_most_used_signature() {
        // Two commits as the upper-case form, five as the lower-case one. The
        // walk met the upper-case form first; the display must not care.
        let t = resolve_authors(
            vec![
                sig("Alice Example", "Alice@Example.COM"),
                sig("Alice Example", "alice@example.com"),
            ],
            vec![2, 5],
            &Mailmap::default(),
        );
        let alice = t.get(AuthorId(0)).expect("one person");
        assert_eq!(alice.email, "alice@example.com");
        assert_eq!(alice.signatures, vec![SignatureId(0), SignatureId(1)]);
    }
}
