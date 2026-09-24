//! Who is who (ADR-0011): the Signatures a person committed under, joined on
//! strong evidence, visibly, and kept apart when the user says so.
//!
//! The Signatures below are shaped like the ones found in real repositories:
//! one owner under a Gmail address and a GitHub noreply address with the same
//! full name, and a contributor whose GitHub account was renamed, who
//! committed under two personal addresses, a university one, and three
//! different names.

#![allow(clippy::expect_used)]

use commitscape_core::{AuthorId, AuthorTable, PersonTraits, Signature, SignatureId};
use commitscape_index::identity::{Account, IdentityRules};
use commitscape_index::{resolve_authors, Mailmap};

fn sig(name: &str, email: &str) -> Signature {
    Signature {
        name: name.to_string(),
        email: email.to_string(),
    }
}

/// Resolves with every signature used `n` times, `n` counting from 1, so a
/// person is displayed under their latest signature.
fn resolve(sigs: &[Signature], rules: &IdentityRules) -> AuthorTable {
    let used = (1..=sigs.len() as u32).collect();
    resolve_authors(sigs.to_vec(), used, rules)
}

fn plain() -> IdentityRules {
    IdentityRules::default()
}

/// Every person's signatures, as signature numbers, in person order.
fn people(t: &AuthorTable) -> Vec<Vec<u32>> {
    t.iter()
        .map(|(_, a)| a.signatures.iter().map(|s| s.0).collect())
        .collect()
}

fn traits_of(t: &AuthorTable, signature: u32) -> PersonTraits {
    let person = t.person_of(SignatureId(signature)).expect("resolved");
    t.get(person).expect("a person").traits
}

#[test]
fn the_same_full_name_joins_two_addresses() {
    let t = resolve(
        &[
            sig("Dev Talan", "dev.talan@gmail.example"),
            sig("Dev Talan", "84081651+devtalan@users.noreply.github.com"),
            sig("Pat Other", "pat@example.com"),
        ],
        &plain(),
    );
    assert_eq!(people(&t), vec![vec![0, 1], vec![2]]);
    assert!(traits_of(&t, 0).contains(PersonTraits::SAME_NAME));
    assert!(traits_of(&t, 0).merged());
    assert!(!traits_of(&t, 2).merged());
}

#[test]
fn names_match_ignoring_case_accents_and_spacing() {
    let t = resolve(
        &[
            sig("José  García", "jose@home.example"),
            sig("jose garcia", "jgarcia@work.example"),
            sig("JOSÉ GARCÍA ", "jose.garcia@uni.example"),
        ],
        &plain(),
    );
    assert_eq!(people(&t), vec![vec![0, 1, 2]]);
}

#[test]
fn a_single_word_name_is_only_suggested() {
    let t = resolve(
        &[
            sig("Ryan", "ryan@home.example"),
            sig("Ryan", "ryan.b@work.example"),
        ],
        &plain(),
    );
    assert_eq!(people(&t), vec![vec![0], vec![1]]);
    assert_eq!(
        t.suspected_duplicates,
        vec![vec![AuthorId(0), AuthorId(1)]],
        "suggested, so the user can decide"
    );
}

#[test]
fn generic_names_never_join() {
    let t = resolve(
        &[
            sig("Your Name", "one@example.com"),
            sig("Your Name", "two@example.com"),
            sig("root user", "root@a.example"),
            sig("Root User", "root@b.example"),
        ],
        &plain(),
    );
    assert_eq!(t.len(), 4, "placeholder names are not evidence");
}

#[test]
fn a_renamed_github_account_is_one_account() {
    // GitHub's noreply address carries the account's number, which stays
    // when the login changes.
    let t = resolve(
        &[
            sig("Ryan", "46247385+ryandev2@users.noreply.github.com"),
            sig("Ryan", "46247385+RyanLandDev@users.noreply.github.com"),
            sig("Sam", "11111+ryandev2@users.noreply.github.com"),
        ],
        &plain(),
    );
    assert_eq!(people(&t), vec![vec![0, 1], vec![2]]);
    assert!(
        !traits_of(&t, 0).merged(),
        "the noreply rule is exact, so there is nothing to undo"
    );
}

/// A contributor's eight signatures, shaped like maihs's Ryan.
fn ryan() -> Vec<Signature> {
    vec![
        sig("Ryan", "ryantuijp@hotmail.example"), // 0
        sig("Ryan", "46247385+ryandev2@users.noreply.github.com"), // 1
        sig("ryandev2", "ryantuijp@hotmail.example"), // 2
        sig("RyanLand", "ryanlandofficial@hotmail.example"), // 3
        sig("Ryan Tuijp", "ryan.tuijp2@uni.example"), // 4
        sig("Ryan Tuijp", "RyanTuijp@hotmail.example"), // 5
        sig("Ryan", "46247385+RyanLandDev@users.noreply.github.com"), // 6
        sig("RyanLandDev", "ryanlandofficial@hotmail.example"), // 7
    ]
}

#[test]
fn without_github_a_contributor_can_stay_split() {
    // By address: {0, 2, 5} share the Hotmail address, {1, 6} the GitHub
    // account, {3, 7} the other Hotmail address, and 4 stands alone. "Ryan
    // Tuijp" joins 4 to the first. The rest share only one-word names.
    let t = resolve(&ryan(), &plain());
    let mut seen = people(&t);
    seen.sort();
    assert_eq!(seen, vec![vec![0, 2, 4, 5], vec![1, 6], vec![3, 7]]);
    assert!(
        !t.suspected_duplicates.is_empty(),
        "\"Ryan\" on two of them is suggested"
    );
}

#[test]
fn github_accounts_join_what_names_cannot() {
    let mut rules = plain();
    for email in [
        "ryantuijp@hotmail.example",
        "ryanlandofficial@hotmail.example",
    ] {
        rules.accounts.insert(
            email.to_string(),
            Account {
                id: 46247385,
                login: "RyanLandDev".to_string(),
            },
        );
    }
    let t = resolve(&ryan(), &rules);
    assert_eq!(people(&t), vec![vec![0, 1, 2, 3, 4, 5, 6, 7]]);
    let traits = traits_of(&t, 0);
    assert!(traits.contains(PersonTraits::SAME_ACCOUNT));
    assert!(traits.contains(PersonTraits::SAME_NAME));
    assert!(t.suspected_duplicates.is_empty());
}

#[test]
fn an_undone_merge_stays_apart_and_says_so() {
    let sigs = [
        sig("Dev Talan", "dev.talan@gmail.example"),
        sig("Dev Talan", "84081651+devtalan@users.noreply.github.com"),
    ];
    let merged = resolve(&sigs, &plain());
    let person = merged.person_of(SignatureId(0)).expect("resolved");
    let mut rules = plain();
    rules.kept_apart.push(commitscape_index::identity::keys_of(
        &merged, person, &rules,
    ));

    let t = resolve(&sigs, &rules);
    assert_eq!(people(&t), vec![vec![0], vec![1]]);
    assert!(traits_of(&t, 0).contains(PersonTraits::KEPT_APART));
    assert!(traits_of(&t, 1).contains(PersonTraits::KEPT_APART));
    assert!(
        t.suspected_duplicates.is_empty(),
        "what the user split is not suggested again"
    );

    rules.kept_apart.clear();
    assert_eq!(people(&resolve(&sigs, &rules)), vec![vec![0, 1]], "redo");
}

#[test]
fn the_mailmap_still_comes_first_and_cannot_be_undone() {
    let mut rules = IdentityRules {
        mailmap: Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example>\n"),
        ..IdentityRules::default()
    };
    let sigs = [
        sig("Alice Example", "alice@example.com"),
        sig("A. Example", "alice@work.example"),
    ];
    let merged = resolve(&sigs, &rules);
    let person = merged.person_of(SignatureId(0)).expect("resolved");
    assert!(!merged.get(person).expect("a person").traits.merged());
    rules.kept_apart.push(commitscape_index::identity::keys_of(
        &merged, person, &rules,
    ));
    assert_eq!(people(&resolve(&sigs, &rules)), vec![vec![0, 1]]);
}

#[test]
fn bots_are_grouped_as_bots_and_never_joined_by_name() {
    let t = resolve(
        &[
            sig(
                "dependabot[bot]",
                "49699333+dependabot[bot]@users.noreply.github.com",
            ),
            sig(
                "github-actions[bot]",
                "41898282+github-actions[bot]@users.noreply.github.com",
            ),
            sig("github-actions", "action@github.com"),
            sig("Renovate Bot", "bot@renovateapp.com"),
            sig("Alice Example", "alice@example.com"),
        ],
        &plain(),
    );
    for s in 0..4 {
        assert!(traits_of(&t, s).is_bot(), "signature {s}");
    }
    assert!(!traits_of(&t, 4).is_bot());
    assert_eq!(t.len(), 5);
}

#[test]
fn a_name_that_is_someone_elses_login_is_suggested() {
    // "RyanLandDev" commits from an address GitHub knows nothing of; the
    // noreply address says RyanLandDev is a login. Suggested, not merged.
    let t = resolve(
        &[
            sig("Ryan", "46247385+RyanLandDev@users.noreply.github.com"),
            sig("RyanLandDev", "ryanlandofficial@hotmail.example"),
        ],
        &plain(),
    );
    assert_eq!(t.len(), 2);
    assert_eq!(t.suspected_duplicates, vec![vec![AuthorId(0), AuthorId(1)]]);
}
