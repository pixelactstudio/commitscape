use std::collections::{HashMap, HashSet};

use commitscape_core::{
    is_bot_name, Author, AuthorId, AuthorTable, PersonTraits, Signature, SignatureId, AUTOMATION,
};

use crate::mailmap::Mailmap;

pub const RULES_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub id: u64,
    pub login: String,
}

#[derive(Debug, Clone, Default)]
pub struct IdentityRules {
    pub mailmap: Mailmap,
    pub accounts: HashMap<String, Account>,
    pub kept_apart: Vec<Vec<String>>,
}

impl IdentityRules {
    pub fn from_mailmap(mailmap: Mailmap) -> Self {
        IdentityRules {
            mailmap,
            ..IdentityRules::default()
        }
    }

    pub fn has_extras(&self) -> bool {
        !self.accounts.is_empty() || !self.kept_apart.is_empty()
    }

    pub fn extras_fingerprint(&self) -> u64 {
        let mut h = xxhash_rust::xxh3::Xxh3::new();
        h.update(&RULES_VERSION.to_le_bytes());
        let mut accounts: Vec<_> = self.accounts.iter().collect();
        accounts.sort_unstable_by(|a, b| a.0.cmp(b.0));
        for (email, account) in accounts {
            h.update(email.as_bytes());
            h.update(&account.id.to_le_bytes());
            h.update(account.login.as_bytes());
            h.update(b"\n");
        }
        h.update(b"--");
        for group in &self.kept_apart {
            for key in group {
                h.update(key.as_bytes());
                h.update(b" ");
            }
            h.update(b"\n");
        }
        h.digest()
    }
}

pub fn resolve_authors(
    signatures: Vec<Signature>,
    used: Vec<u32>,
    rules: &IdentityRules,
) -> AuthorTable {
    let resolved: Vec<(String, String)> = signatures
        .iter()
        .map(|s| {
            let (n, e) = rules.mailmap.resolve(s.name.as_bytes(), s.email.as_bytes());
            (
                String::from_utf8_lossy(n).into_owned(),
                String::from_utf8_lossy(e).into_owned(),
            )
        })
        .collect();
    let keys = address_keys(resolved.iter().map(|(_, e)| e.as_str()));

    let mut group_of_key: HashMap<&str, usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();
    for (i, key) in keys.iter().enumerate() {
        let g = *group_of_key.entry(key.as_str()).or_insert_with(|| {
            groups.push(Group::new(key));
            groups.len() - 1
        });
        if let (Some(group), Some((name, email))) = (groups.get_mut(g), resolved.get(i)) {
            group.signatures.push(SignatureId(i as u32));
            group.bot |= is_bot(name, email);
            group.emails.insert(email.to_ascii_lowercase());
            if let Some(raw) = signatures.get(i) {
                group.emails.insert(raw.email.to_ascii_lowercase());
            }
            if let Some(n) = full_name(name) {
                group.names.insert(n);
            }
        }
    }
    let undo_of_key: HashMap<&str, usize> = rules
        .kept_apart
        .iter()
        .enumerate()
        .flat_map(|(i, g)| g.iter().map(move |k| (k.as_str(), i)))
        .collect();
    let mut sets = Sets::new(groups.len());
    for (i, g) in groups.iter_mut().enumerate() {
        if let (Some(&undo), Some(undos)) = (undo_of_key.get(g.key.as_str()), sets.undos.get_mut(i))
        {
            g.kept = true;
            undos.push(undo);
        }
    }

    let mut by_account: HashMap<u64, usize> = HashMap::new();
    for (i, g) in groups.iter().enumerate() {
        if g.bot {
            continue;
        }
        let ids: HashSet<u64> = github_id(&g.key)
            .into_iter()
            .chain(
                g.emails
                    .iter()
                    .filter_map(|e| rules.accounts.get(e))
                    .map(|a| a.id),
            )
            .collect();
        for id in ids {
            match by_account.get(&id) {
                Some(&first) => sets.join(first, i, PersonTraits::SAME_ACCOUNT),
                None => {
                    by_account.insert(id, i);
                }
            }
        }
    }
    let mut by_name: HashMap<&str, usize> = HashMap::new();
    for (i, g) in groups.iter().enumerate() {
        if g.bot {
            continue;
        }
        for name in &g.names {
            match by_name.get(name.as_str()) {
                Some(&first) => sets.join(first, i, PersonTraits::SAME_NAME),
                None => {
                    by_name.insert(name.as_str(), i);
                }
            }
        }
    }

    let mut person_of_root: HashMap<usize, AuthorId> = HashMap::new();
    let mut members: Vec<(Vec<SignatureId>, PersonTraits)> = Vec::new();
    for (i, g) in groups.iter().enumerate() {
        let root = sets.find(i);
        let id = *person_of_root.entry(root).or_insert_with(|| {
            members.push((Vec::new(), sets.traits(root)));
            AuthorId(members.len() as u32 - 1)
        });
        if let Some((sigs, traits)) = members.get_mut(id.idx()) {
            sigs.extend_from_slice(&g.signatures);
            if g.bot {
                *traits = traits.with(PersonTraits::BOT);
            }
            if g.kept {
                *traits = traits.with(PersonTraits::KEPT_APART);
            }
        }
    }
    let mut person_of = vec![AuthorId(0); signatures.len()];
    for (id, (sigs, _)) in members.iter_mut().enumerate() {
        sigs.sort_unstable();
        for s in sigs.iter() {
            if let Some(slot) = person_of.get_mut(s.idx()) {
                *slot = AuthorId(id as u32);
            }
        }
    }

    let authors: Vec<Author> = members
        .into_iter()
        .map(|(sigs, traits)| {
            let display = sigs
                .iter()
                .copied()
                .max_by_key(|s| {
                    let count = used.get(s.idx()).copied().unwrap_or(0);
                    (count, std::cmp::Reverse(s.0))
                })
                .and_then(|s| resolved.get(s.idx()));
            let (name, email) = match display {
                Some((n, e)) => (
                    n.clone(),
                    String::from_utf8_lossy(&strip_github_numeric_prefix(e.as_bytes()))
                        .into_owned(),
                ),
                None => (String::new(), String::new()),
            };
            Author {
                name,
                email,
                signatures: sigs,
                traits,
            }
        })
        .collect();

    let suspects = suspected_duplicates(&authors, &resolved, &keys, rules);
    AuthorTable::new(signatures, used, person_of, authors, suspects)
}

pub fn keys_of(table: &AuthorTable, person: AuthorId, rules: &IdentityRules) -> Vec<String> {
    let emails: Vec<String> = (0..table.signature_count())
        .map(|i| {
            let s = table.signature(SignatureId(i as u32));
            let (name, email) = s.map_or(("", ""), |s| (s.name, s.email));
            let (_, e) = rules.mailmap.resolve(name.as_bytes(), email.as_bytes());
            String::from_utf8_lossy(e).into_owned()
        })
        .collect();
    let keys = address_keys(emails.iter().map(String::as_str));
    let mut out: Vec<String> = table
        .get(person)
        .map(|a| a.signatures)
        .unwrap_or_default()
        .iter()
        .filter_map(|s| keys.get(s.idx()).cloned())
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

struct Group {
    key: String,
    signatures: Vec<SignatureId>,
    emails: HashSet<String>,
    names: HashSet<String>,
    bot: bool,
    kept: bool,
}

impl Group {
    fn new(key: &str) -> Self {
        Group {
            key: key.to_string(),
            signatures: Vec::new(),
            emails: HashSet::new(),
            names: HashSet::new(),
            bot: false,
            kept: false,
        }
    }
}

struct Sets {
    parent: Vec<usize>,
    traits: Vec<PersonTraits>,
    undos: Vec<Vec<usize>>,
}

impl Sets {
    fn new(n: usize) -> Self {
        Sets {
            parent: (0..n).collect(),
            traits: vec![PersonTraits::default(); n],
            undos: vec![Vec::new(); n],
        }
    }

    fn find(&mut self, mut i: usize) -> usize {
        while let Some(&p) = self.parent.get(i) {
            if p == i {
                break;
            }
            let grand = self.parent.get(p).copied().unwrap_or(p);
            if let Some(slot) = self.parent.get_mut(i) {
                *slot = grand;
            }
            i = p;
        }
        i
    }

    fn join(&mut self, a: usize, b: usize, why: PersonTraits) {
        let (ra, rb) = (self.find(a), self.find(b));
        let undos = |r: usize| self.undos.get(r).map(Vec::as_slice).unwrap_or_default();
        if ra == rb || undos(ra).iter().any(|u| undos(rb).contains(u)) {
            return;
        }
        let (keep, gone) = (ra.min(rb), ra.max(rb));
        let merged = self.traits(keep).with(self.traits(gone)).with(why);
        let moved = std::mem::take(self.undos.get_mut(gone).unwrap_or(&mut Vec::new()));
        if let Some(u) = self.undos.get_mut(keep) {
            u.extend(moved);
        }
        if let Some(p) = self.parent.get_mut(gone) {
            *p = keep;
        }
        if let Some(t) = self.traits.get_mut(keep) {
            *t = merged;
        }
    }

    fn traits(&self, root: usize) -> PersonTraits {
        self.traits.get(root).copied().unwrap_or_default()
    }
}

const NOREPLY: &str = "@users.noreply.github.com";

fn address_keys<'a>(emails: impl Iterator<Item = &'a str> + Clone) -> Vec<String> {
    let mut number_of_login: HashMap<String, u64> = HashMap::new();
    for email in emails.clone() {
        if let Some((Some(n), login)) = noreply(email) {
            number_of_login.entry(login).or_insert(n);
        }
    }
    emails
        .map(|email| match noreply(email) {
            Some((Some(n), _)) => format!("github:{n}"),
            Some((None, login)) => match number_of_login.get(&login) {
                Some(n) => format!("github:{n}"),
                None => format!("github:@{login}"),
            },
            None => email.to_ascii_lowercase(),
        })
        .collect()
}

fn noreply(email: &str) -> Option<(Option<u64>, String)> {
    let lower = email.to_ascii_lowercase();
    let local = lower.strip_suffix(NOREPLY)?;
    match local.split_once('+') {
        Some((digits, login))
            if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) =>
        {
            Some((digits.parse().ok(), login.to_string()))
        }
        _ => Some((None, local.to_string())),
    }
}

fn github_id(key: &str) -> Option<u64> {
    key.strip_prefix("github:")?.parse().ok()
}

fn strip_github_numeric_prefix(email: &[u8]) -> Vec<u8> {
    let at = email.len().saturating_sub(NOREPLY.len());
    let (Some(local), Some(domain)) = (email.get(..at), email.get(at..)) else {
        return email.to_vec();
    };
    if !domain.eq_ignore_ascii_case(NOREPLY.as_bytes()) {
        return email.to_vec();
    }
    match local.iter().position(|&b| b == b'+') {
        Some(plus)
            if plus > 0
                && local
                    .get(..plus)
                    .is_some_and(|d| d.iter().all(u8::is_ascii_digit)) =>
        {
            email
                .get(plus + 1..)
                .map_or_else(|| email.to_vec(), <[u8]>::to_vec)
        }
        _ => email.to_vec(),
    }
}

const PLACEHOLDER_WORDS: &[&str] = &[
    "action",
    "actions",
    "admin",
    "administrator",
    "build",
    "builder",
    "ci",
    "default",
    "dev",
    "developer",
    "doe",
    "ec2",
    "first",
    "firstname",
    "full",
    "git",
    "github",
    "jane",
    "john",
    "last",
    "lastname",
    "local",
    "name",
    "nobody",
    "pi",
    "root",
    "runner",
    "server",
    "system",
    "test",
    "the",
    "ubuntu",
    "unknown",
    "user",
    "vagrant",
    "your",
];

fn full_name(name: &str) -> Option<String> {
    let folded: String = name
        .chars()
        .flat_map(char::to_lowercase)
        .map(unaccent)
        .collect();
    let words: Vec<&str> = folded.split_whitespace().collect();
    if words.len() < 2
        || words.iter().all(|w| PLACEHOLDER_WORDS.contains(w))
        || words.iter().any(|w| w.contains('@'))
    {
        return None;
    }
    Some(words.join(" "))
}

fn unaccent(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
        'ď' | 'đ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
        'ĥ' | 'ħ' => 'h',
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => 'i',
        'ĵ' => 'j',
        'ķ' => 'k',
        'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => 'l',
        'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => 'o',
        'ŕ' | 'ŗ' | 'ř' => 'r',
        'ś' | 'ŝ' | 'ş' | 'š' | 'ș' => 's',
        'ţ' | 'ť' | 'ŧ' | 'ț' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
        'ŵ' => 'w',
        'ý' | 'ÿ' | 'ŷ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        other => other,
    }
}

fn is_bot(name: &str, email: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    let email = email.trim().to_ascii_lowercase();
    is_bot_name(&name)
        || email.contains("[bot]@")
        || name.split_whitespace().last() == Some("bot") && name.contains(' ')
        || AUTOMATION.contains(&email.as_str())
}

const GENERIC_LOCAL: &[&str] = &[
    "root", "dev", "admin", "user", "git", "build", "ci", "info", "me", "hi", "hello", "hey",
    "mail", "email", "contact", "code", "github", "noreply", "no-reply", "team", "support",
];

fn suspected_duplicates(
    authors: &[Author],
    resolved: &[(String, String)],
    keys: &[String],
    rules: &IdentityRules,
) -> Vec<Vec<AuthorId>> {
    let mut by_name: HashMap<String, Vec<AuthorId>> = HashMap::new();
    let mut by_local: HashMap<String, Vec<AuthorId>> = HashMap::new();
    for (i, author) in authors.iter().enumerate() {
        if author.traits.is_bot() {
            continue;
        }
        let id = AuthorId(i as u32);
        let mut names = HashSet::new();
        let mut locals = HashSet::new();
        for s in &author.signatures {
            let Some((name, email)) = resolved.get(s.idx()) else {
                continue;
            };
            let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
            let name = name.to_lowercase();
            if !name.is_empty() {
                names.insert(name);
            }
            let local = match noreply(email) {
                Some((_, login)) => login,
                None => email
                    .split_once('@')
                    .map(|(l, _)| l.to_ascii_lowercase())
                    .unwrap_or_default(),
            };
            if !local.is_empty() && !GENERIC_LOCAL.contains(&local.as_str()) {
                locals.insert(local);
            }
        }
        for n in &names {
            if !n.contains(' ') && !GENERIC_LOCAL.contains(&n.as_str()) {
                locals.insert(n.clone());
            }
        }
        for n in names {
            by_name.entry(n).or_default().push(id);
        }
        for l in locals {
            by_local.entry(l).or_default().push(id);
        }
    }

    let undo_of_key: HashMap<&str, usize> = rules
        .kept_apart
        .iter()
        .enumerate()
        .flat_map(|(i, g)| g.iter().map(move |k| (k.as_str(), i)))
        .collect();
    let undo_of = |id: AuthorId| -> Option<usize> {
        authors.get(id.idx())?.signatures.iter().find_map(|s| {
            keys.get(s.idx())
                .and_then(|k| undo_of_key.get(k.as_str()).copied())
        })
    };

    let mut groups: Vec<Vec<AuthorId>> = by_name
        .into_values()
        .chain(by_local.into_values())
        .filter(|g| g.len() > 1)
        .filter(|g| {
            let first = g.first().and_then(|&p| undo_of(p));
            first.is_none() || !g.iter().all(|&p| undo_of(p) == first)
        })
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

    fn resolve(sigs: &[Signature], mailmap: Mailmap) -> AuthorTable {
        resolve_authors(
            sigs.to_vec(),
            vec![1; sigs.len()],
            &IdentityRules::from_mailmap(mailmap),
        )
    }

    fn same_person(t: &AuthorTable, a: u32, b: u32) -> bool {
        t.person_of(SignatureId(a)) == t.person_of(SignatureId(b))
    }

    #[test]
    fn rule_2_folds_email_case() {
        let t = resolve(
            &[
                sig("Alice", "alice@example.com"),
                sig("Alice", "Alice@Example.COM"),
            ],
            Mailmap::default(),
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
            Mailmap::default(),
        );
        assert!(same_person(&t, 0, 1));
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn rule_3_is_scoped_to_github_and_to_numeric_prefixes() {
        assert_eq!(
            strip_github_numeric_prefix(b"12345+bob@example.com"),
            b"12345+bob@example.com".to_vec()
        );
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
    fn mailmap_resolves_what_the_rules_cannot() {
        let mailmap =
            Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example.org>\n");
        let t = resolve(
            &[
                sig("Alice", "alice@example.com"),
                sig("A. E.", "alice@work.example.org"),
            ],
            mailmap,
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
            Mailmap::default(),
        );
        assert!(!same_person(&t, 0, 1));
        assert_eq!(t.len(), 2);
    }

    #[test]
    fn a_shared_one_word_name_is_suspected_but_not_merged() {
        let t = resolve(
            &[sig("dev", "one@example.com"), sig("dev", "two@example.com")],
            Mailmap::default(),
        );
        assert!(!same_person(&t, 0, 1));
        assert_eq!(t.len(), 2);
        assert_eq!(t.suspected_duplicates, vec![vec![AuthorId(0), AuthorId(1)]]);
    }

    #[test]
    fn generic_local_parts_do_not_generate_suggestions() {
        let t = resolve(
            &[
                sig("Someone", "root@host-a.example.com"),
                sig("Another", "root@host-b.example.com"),
            ],
            Mailmap::default(),
        );
        assert_eq!(t.len(), 2);
        assert!(t.suspected_duplicates.is_empty());
    }

    #[test]
    fn personal_domains_behind_a_common_word_suggest_nobody() {
        let t = resolve(
            &[
                sig("Theo Browne", "me@t3.gg"),
                sig("Max Katz", "me@maxkatz.me"),
                sig("Ellie Gummere", "hello@unknownhost.name"),
                sig("Tim Smart", "hello@timsmart.co"),
            ],
            Mailmap::default(),
        );
        assert_eq!(t.len(), 4);
        assert!(t.suspected_duplicates.is_empty());
    }

    #[test]
    fn a_person_is_shown_under_their_most_used_signature() {
        let t = resolve_authors(
            vec![
                sig("Alice Example", "Alice@Example.COM"),
                sig("Alice Example", "alice@example.com"),
            ],
            vec![2, 5],
            &IdentityRules::default(),
        );
        let alice = t.get(AuthorId(0)).expect("one person");
        assert_eq!(alice.email, "alice@example.com");
        assert_eq!(alice.signatures, vec![SignatureId(0), SignatureId(1)]);
    }
}
