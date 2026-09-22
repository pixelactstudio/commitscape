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

use commitscape_core::{Author, AuthorId, AuthorTable};

use crate::mailmap::Mailmap;

pub struct IdentityResolver {
    mailmap: Mailmap,
    /// Canonical email key -> author.
    by_key: HashMap<Vec<u8>, AuthorId>,
    table: AuthorTable,
    /// Raw variants seen per author, in first-seen order.
    variants: Vec<Vec<(String, String)>>,
}

impl IdentityResolver {
    pub fn new(mailmap: Mailmap) -> Self {
        IdentityResolver {
            mailmap,
            by_key: HashMap::new(),
            table: AuthorTable::default(),
            variants: Vec::new(),
        }
    }

    /// Returns the person this raw identity belongs to, allocating one if this
    /// is the first time we have seen them.
    pub fn resolve(&mut self, raw_name: &[u8], raw_email: &[u8]) -> AuthorId {
        let (name, email) = self.mailmap.resolve(raw_name, raw_email);
        let name = name.to_vec();
        let email = email.to_vec();
        let key = canonical_email_key(&email);

        let raw_variant = (
            String::from_utf8_lossy(raw_name).into_owned(),
            String::from_utf8_lossy(raw_email).into_owned(),
        );

        if let Some(&id) = self.by_key.get(&key) {
            if let Some(v) = self.variants.get_mut(id.idx()) {
                if !v.contains(&raw_variant) {
                    v.push(raw_variant);
                }
            }
            return id;
        }

        let id = self.table.push(Author {
            name: String::from_utf8_lossy(&name).into_owned(),
            email: String::from_utf8_lossy(&email).into_owned(),
            variants: Vec::new(),
        });
        self.variants.push(vec![raw_variant]);
        self.by_key.insert(key, id);
        id
    }

    /// Finalises the table, attaching raw variants and computing the suspected
    /// duplicate groups.
    pub fn finish(mut self) -> AuthorTable {
        let mut table = std::mem::take(&mut self.table);
        let suspects = suspected_duplicates(&table);

        // Rebuild with variants attached. `AuthorTable` owns its storage, so
        // this reconstructs rather than mutating in place.
        let mut rebuilt = AuthorTable::default();
        for (id, author) in table.iter() {
            let variants = self.variants.get(id.idx()).cloned().unwrap_or_default();
            rebuilt.push(Author {
                name: author.name.clone(),
                email: author.email.clone(),
                variants,
            });
        }
        rebuilt.suspected_duplicates = suspects;
        table = rebuilt;
        table
    }
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
fn suspected_duplicates(table: &AuthorTable) -> Vec<Vec<AuthorId>> {
    let mut by_name: HashMap<String, Vec<AuthorId>> = HashMap::new();
    let mut by_local: HashMap<String, Vec<AuthorId>> = HashMap::new();

    for (id, author) in table.iter() {
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

    fn resolver() -> IdentityResolver {
        IdentityResolver::new(Mailmap::default())
    }

    #[test]
    fn rule_2_folds_email_case() {
        let mut r = resolver();
        let a = r.resolve(b"Alice Example", b"alice@example.com");
        let b = r.resolve(b"Alice Example", b"Alice@Example.COM");
        assert_eq!(a, b);
        let table = r.finish();
        assert_eq!(table.len(), 1);
    }

    #[test]
    fn rule_3_folds_the_github_numeric_noreply_form() {
        let mut r = resolver();
        let a = r.resolve(b"Carol", b"90210+carol@users.noreply.github.com");
        let b = r.resolve(b"Carol", b"carol@users.noreply.github.com");
        assert_eq!(a, b);
        assert_eq!(r.finish().len(), 1);
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
        let mut r = IdentityResolver::new(mailmap);
        let a = r.resolve(b"Alice Example", b"alice@example.com");
        let b = r.resolve(b"A. Example", b"alice@work.example.org");
        assert_eq!(a, b, "the mailmap is what merges these two");
        assert_eq!(r.finish().len(), 1);
    }

    #[test]
    fn distinct_people_are_never_merged() {
        let mut r = resolver();
        let a = r.resolve(b"Alice Example", b"alice@example.com");
        let b = r.resolve(b"Bob Example", b"bob@example.com");
        assert_ne!(a, b);
        assert_eq!(r.finish().len(), 2);
    }

    #[test]
    fn a_shared_display_name_is_suspected_but_not_merged() {
        // The dangerous case: two real people both committing as "dev".
        let mut r = resolver();
        let a = r.resolve(b"dev", b"one@example.com");
        let b = r.resolve(b"dev", b"two@example.com");
        assert_ne!(a, b, "a shared display name must not merge identities");

        let table = r.finish();
        assert_eq!(table.len(), 2);
        assert_eq!(
            table.suspected_duplicates,
            vec![vec![a, b]],
            "but it must be surfaced so the user can write a mailmap"
        );
    }

    #[test]
    fn generic_local_parts_do_not_generate_suggestions() {
        // root@host-a and root@host-b are not evidence of anything.
        let mut r = resolver();
        r.resolve(b"Someone", b"root@host-a.example.com");
        r.resolve(b"Another", b"root@host-b.example.com");
        let table = r.finish();
        assert_eq!(table.len(), 2);
        assert!(
            table.suspected_duplicates.is_empty(),
            "shared generic local-parts say nothing about identity"
        );
    }

    #[test]
    fn raw_variants_are_recorded_so_the_interface_can_show_its_work() {
        let mut r = resolver();
        let id = r.resolve(b"Alice Example", b"alice@example.com");
        r.resolve(b"Alice Example", b"Alice@Example.COM");
        let table = r.finish();
        let author = table.get(id).expect("author exists");
        assert_eq!(author.variants.len(), 2);
        assert_eq!(author.email, "alice@example.com");
    }
}
