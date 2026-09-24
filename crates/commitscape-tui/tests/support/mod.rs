//! The repository every snapshot is drawn from, `acme`, written out by hand,
//! and the helpers that drive the interface without a terminal.
//!
//! Anchored at 2025-07-01T00:00:00Z. A commit made `d` days ago is stamped
//! on the day before `anchor - d days`, at its author's hour (see Rhythm
//! below), so it is `d` whole days old and never sits on a Window's edge.
//! The Bulk Commit threshold is 5 files.
//!
//! History older than a year:
//!
//! - day 700, Alice: adds `src/engine/core.rs`, `src/engine/parser.rs`,
//!   `src/legacy/old.rs`, `docs/guide.md` and `Cargo.lock`
//! - day 600, Alice: `old.rs`. Day 500, Alice: adds `src/util/strings.rs`
//! - day 420, Alice: `core.rs` and `Cargo.lock`
//! - day 400, Bob: adds `src/api/handlers.ts` and `web/src/client.ts`
//!
//! Within the year: Alice as `alice@home.example.net` changes `parser.rs` on
//! days 300, 250 and 200; Alice `strings.rs` on day 210; Carol
//! `docs/guide.md` on day 150; Bob `handlers.ts` and `client.ts` on day 120.
//!
//! The last 90 days:
//!
//! - Alice, every third day from 88 to 1 (30 commits): `core.rs`, and
//!   `parser.rs` too on every other one of them (15)
//! - Bob, days 80, 71, 60, 50, 41 and 32: `handlers.ts` and `client.ts`;
//!   day 20 `client.ts` alone, day 11 `handlers.ts` alone
//! - Carol, days 45, 35, 26 and 15: `core.rs`; days 38 and 12
//!   `docs/guide.md`, and day 8 on a branch she merges on day 6. The merge
//!   changes nothing itself.
//! - Bob, day 24: one commit of six files, a Bulk Commit
//!
//! Worked values for the last 90 days: 47 commits, 1 merge and 1 bulk.
//!
//! - Churn: `core.rs` 34 (30 + 4), `parser.rs` 15, `handlers.ts` 7,
//!   `client.ts` 7, `guide.md` 3.
//! - Complexity Proxy (indentation levels summed): `core.rs` 630,
//!   `parser.rs` 240, `handlers.ts` 120, `old.rs` 90, `client.ts` 42,
//!   `strings.rs` 15.
//! - Hotspots: churn percentiles among the four changed code files are
//!   1, 0.75, 0.5, 0.5; complexity percentiles among the six code files are
//!   1, 5/6, 4/6, 2/6. Scores: `core.rs` 1.00, `parser.rs` 0.625 (shown as 0.62),
//!   `handlers.ts` 0.33, `client.ts` 0.17.
//! - Coupling at a support of 5: (`handlers.ts`, `client.ts`) together 6 of
//!   7 + 7 - 6 = 8, 75%, across directories; (`core.rs`, `parser.rs`)
//!   together 15 of 34, 44%, in one directory.
//! - Ownership, 10 or more commits: `src/engine/` Alice 30 of 34 (88%), bus
//!   factor 1; the root Alice 30, Bob 8, Carol 7 of 45, bus factor 2; `src/`
//!   Alice 30, Bob 7, Carol 4 of 41, bus factor 2.
//! - Staleness of the 7 files people wrote: under a week `core.rs` (1 day)
//!   and `parser.rs` (4); under a month `guide.md` (8), `handlers.ts` (11)
//!   and `client.ts` (20); under a year `strings.rs` (210); a year or more
//!   `old.rs` (600).
//! - Code Age: 2023-Q3 `core.rs` 210, `parser.rs` 120 and `old.rs` 60 lines
//!   (390); 2024-Q1 `strings.rs` 30; 2024-Q2 `handlers.ts` 80 and
//!   `client.ts` 42 (122).
//! - Bob's fix of `handlers.ts` 11 days ago came from his laptop, under his
//!   full name: one person, "merged 2 identities".
//! - One group of people who may be one person: Alice (35 commits) and
//!   `alice` at home (3), who share the email name `alice`.
//!
//! Rhythm. Alice commits at 10:00, Bob at 21:00 and Carol at 15:00, all in
//! UTC. Alice's commits that touch `parser.rs` say `feat(engine): ...` and
//! her others `fix(engine): ...`.
//! Bob's pairs say `feat(api): ...`, his two single-file commits `fix`, his
//! bulk commit `style`; Carol's `core.rs` commits `refactor`, her guide
//! commits `docs`. Worked values for the last 90 days, merges left out:
//!
//! - 46 commits, each on a day of its own: 46 active days.
//! - Features 21 (Alice 15, Bob 6), fixes 17 (Alice 15, Bob 2), refactors
//!   4, docs 3, style 1.
//! - Hours: 30 at 10:00, 7 at 15:00, 9 at 21:00. None at night.
//! - 1 July 2025 is a Tuesday, so a commit made `d` days before falls on a
//!   weekend when `d` is 1 or 2 more than a multiple of 7: 9 of Alice's, 2
//!   of Bob's (days 71 and 50) and 2 of Carol's (15 and 8), 13 in all.
//! - The longest streak is 4 days: days 13, 12, 11 and 10 (Alice, Carol,
//!   Bob, Alice), from 17 June 2025. Days 26 to 24 make 3.
//! - Every day holds one commit, so no day is busier than another.

#![allow(dead_code, clippy::expect_used)]

use std::path::Path;
use std::sync::{Arc, Mutex};

use commitscape_core::{Index, Oid};
use commitscape_forge::{GitHub, Issue, PrState, PullRequest, Release};
use commitscape_index::identity::keys_of;
use commitscape_index::source::RawChangeKind::{self, Added, Modified};
use commitscape_index::{
    index_from_scratch, load, resolve_authors, CacheOptions, IdentityRules, ScriptedRepo, Since,
};
use commitscape_metrics::{Options, Span};
use commitscape_tui::{App, ChangePeople, Command, Event, LoadOlder, PeopleChange, Session};
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::Terminal;

/// 2025-07-01T00:00:00Z.
pub const ANCHOR: i64 = 1_751_328_000;
const DAY: i64 = 86_400;

pub const WIDTH: u16 = 110;
pub const HEIGHT: u16 = 26;

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const ALICE_HOME: (&str, &str) = ("alice", "alice@home.example.net");
/// Bob's laptop: the same full name, so joined to Bob (ADR-0011).
const BOB_LAPTOP: (&str, &str) = ("Bob Builder", "bob@laptop.example.net");
const BOB: (&str, &str) = ("Bob Builder", "bob@example.com");
const CAROL: (&str, &str) = ("Carol Coder", "carol@example.com");

const CORE: &str = "src/engine/core.rs";
const PARSER: &str = "src/engine/parser.rs";
const OLD: &str = "src/legacy/old.rs";
const STRINGS: &str = "src/util/strings.rs";
const HANDLERS: &str = "src/api/handlers.ts";
const CLIENT: &str = "web/src/client.ts";
const GUIDE: &str = "docs/guide.md";
const LOCK: &str = "Cargo.lock";

struct Script {
    repo: ScriptedRepo,
    commits: u32,
    blobs: u16,
}

/// The hour, in UTC, each person commits at.
fn hour_of(who: (&str, &str)) -> i64 {
    match who.1 {
        "alice@example.com" => 10,
        "bob@example.com" | "bob@laptop.example.net" => 21,
        "carol@example.com" => 15,
        _ => 23,
    }
}

impl Script {
    fn commit(
        mut self,
        days_ago: i64,
        who: (&str, &str),
        kind: RawChangeKind,
        paths: &[&str],
        message: &str,
    ) -> Self {
        let mut changes = Vec::new();
        for path in paths {
            self.blobs += 1;
            let mut id = [0u8; 20];
            id[..2].copy_from_slice(&self.blobs.to_be_bytes());
            changes.push((path.as_bytes(), kind, Oid(id)));
        }
        let time = ANCHOR - (days_ago + 1) * DAY + hour_of(who) * 3600;
        self.repo = self.repo.commit(time, who, &changes).said(message);
        self.commits += 1;
        self
    }
}

/// `lines` lines of code whose indentation climbs from none to `depth`
/// levels of `unit`, then starts again.
fn code(lines: usize, depth: usize, unit: &str) -> String {
    (0..lines)
        .map(|i| format!("{}x{i}\n", unit.repeat(i % (depth + 1))))
        .collect()
}

pub fn acme() -> ScriptedRepo {
    let mut s = Script {
        repo: ScriptedRepo::new(),
        commits: 0,
        blobs: 0,
    }
    .commit(
        700,
        ALICE,
        Added,
        &[CORE, PARSER, OLD, GUIDE, LOCK],
        "feat: first version",
    )
    .commit(600, ALICE, Modified, &[OLD], "fix: an old bug")
    .commit(500, ALICE, Added, &[STRINGS], "feat(util): strings")
    .commit(
        420,
        ALICE,
        Modified,
        &[CORE, LOCK],
        "chore: update dependencies",
    )
    .commit(
        400,
        BOB,
        Added,
        &[HANDLERS, CLIENT],
        "feat(api): first endpoints",
    )
    .commit(
        300,
        ALICE_HOME,
        Modified,
        &[PARSER],
        "fix(parser): stop at EOF",
    )
    .commit(250, ALICE_HOME, Modified, &[PARSER], "fix(parser): quotes")
    .commit(210, ALICE, Modified, &[STRINGS], "refactor(util): tidy")
    .commit(200, ALICE_HOME, Modified, &[PARSER], "fix(parser): escapes")
    .commit(150, CAROL, Modified, &[GUIDE], "docs: first guide")
    .commit(
        120,
        BOB,
        Modified,
        &[HANDLERS, CLIENT],
        "feat(api): version 2",
    );

    // Day, author, paths and message of each commit in the last 90 days.
    type Planned<'a> = (i64, (&'a str, &'a str), Vec<&'a str>, &'a str);
    let mut recent: Vec<Planned> = Vec::new();
    for k in 0..27 {
        let day = 88 - 3 * k;
        if k % 2 == 0 {
            recent.push((
                day,
                ALICE,
                vec![CORE, PARSER],
                "feat(engine): parse a new form",
            ));
        } else {
            recent.push((day, ALICE, vec![CORE], "fix(engine): handle an edge case"));
        }
    }
    for day in [80, 71, 60, 50, 41, 32] {
        recent.push((
            day,
            BOB,
            vec![HANDLERS, CLIENT],
            "feat(api): an endpoint and its client",
        ));
    }
    recent.push((20, BOB, vec![CLIENT], "fix(web): retry on timeout"));
    recent.push((11, BOB_LAPTOP, vec![HANDLERS], "fix(api): validate input"));
    for day in [45, 35, 26, 15] {
        recent.push((day, CAROL, vec![CORE], "refactor(engine): simplify"));
    }
    recent.push((38, CAROL, vec![GUIDE], "docs: explain setup"));
    recent.push((12, CAROL, vec![GUIDE], "docs: explain flags"));
    recent.push((
        24,
        BOB,
        vec![CORE, PARSER, HANDLERS, CLIENT, GUIDE, LOCK],
        "style: format everything",
    ));
    recent.sort_by_key(|(day, _, _, _)| -day);
    for (day, who, paths, message) in recent {
        s = s.commit(day, who, Modified, &paths, message);
    }

    // Day 10 is Alice's last commit before Carol's branch.
    let base = s.commits;
    s = s.commit(8, CAROL, Modified, &[GUIDE], "docs: explain the map");
    let side = s.commits;
    s.repo = s.repo.at(base);
    s = s.commit(
        7,
        ALICE,
        Modified,
        &[CORE],
        "fix(engine): handle an edge case",
    );
    s.repo = s.repo.merge(ANCHOR - 6 * DAY - 3600, CAROL, side, &[]);
    s.commits += 1;
    s = s
        .commit(
            4,
            ALICE,
            Modified,
            &[CORE, PARSER],
            "feat(engine): parse a new form",
        )
        .commit(
            1,
            ALICE,
            Modified,
            &[CORE],
            "fix(engine): handle an edge case",
        );

    s.repo
        .head_file(CORE.as_bytes(), &code(210, 6, "    "))
        .head_file(PARSER.as_bytes(), &code(120, 4, "    "))
        .head_file(OLD.as_bytes(), &code(60, 3, "    "))
        .head_file(STRINGS.as_bytes(), &code(30, 1, "    "))
        .head_file(HANDLERS.as_bytes(), &code(80, 3, "  "))
        .head_file(CLIENT.as_bytes(), &code(42, 2, "  "))
        .head_file(GUIDE.as_bytes(), "# Guide\n\nHow to run acme.\n")
        .head_file(
            LOCK.as_bytes(),
            "# This file is automatically @generated by Cargo.\n[[package]]\nname = \"acme\"\n",
        )
}

pub fn options() -> Options {
    Options {
        max_changeset_size: 5,
        ..Options::default()
    }
}

/// `acme` with all of its history loaded.
pub fn session(span: Span) -> Session {
    session_of(acme(), span)
}

/// Any repository with all of its history loaded, anchored where `acme` is.
pub fn session_of(repo: ScriptedRepo, span: Span) -> Session {
    let index = match index_from_scratch(&repo) {
        Ok(index) => index,
        Err(never) => match never {},
    };
    Session {
        name: "acme".to_string(),
        index,
        anchor: ANCHOR,
        span,
        options: options(),
        older: None,
        github: Err("not asked in tests".to_string()),
        people: Some(people()),
        link_accounts: None,
        lines: None,
    }
}

/// `acme` as a warm start shows it: only the months `span` needs are read
/// from the cache in `dir`, and the rest comes later.
pub fn sliced(span: Span, dir: &Path) -> Session {
    let repo = acme();
    let cache = CacheOptions {
        root: Some(dir.to_path_buf()),
    };
    let from = span.window(ANCHOR).from.map_or(Since::All, Since::Time);
    let loaded = |since| match load(&repo, &cache, since, &mut |_| {}) {
        Ok(loaded) => loaded,
        Err(never) => match never {},
    };
    loaded(Since::All);
    let mut recent = loaded(from);
    let older: Option<LoadOlder> = recent
        .take_rest()
        .map(|rest| -> LoadOlder { Box::new(move |index: &Index| rest.complete(index).ok()) });
    assert!(older.is_some(), "the slice leaves older history behind");
    Session {
        name: "acme".to_string(),
        index: recent.index,
        anchor: ANCHOR,
        span,
        options: options(),
        older,
        github: Err("not asked in tests".to_string()),
        people: Some(people()),
        link_accounts: None,
        lines: None,
    }
}

/// Undoes and redoes merges as the binary does, keeping the undos in
/// memory rather than in a cache directory.
pub fn people() -> ChangePeople {
    let kept: Arc<Mutex<Vec<Vec<String>>>> = Arc::default();
    Arc::new(move |table, change| {
        let mut kept = kept.lock().ok()?;
        let rules = |kept: &[Vec<String>]| IdentityRules {
            kept_apart: kept.to_vec(),
            ..IdentityRules::default()
        };
        match change {
            PeopleChange::Undo(p) => {
                let keys = keys_of(table, p, &rules(&kept));
                kept.push(keys);
            }
            PeopleChange::Redo(p) => {
                let keys = keys_of(table, p, &rules(&kept));
                kept.retain(|g| !g.iter().any(|k| keys.contains(k)));
            }
        }
        let (signatures, used) = table.clone().into_signatures();
        Some(resolve_authors(signatures, used, &rules(&kept)))
    })
}

/// The screen, as text.
pub fn screen(app: &mut App) -> String {
    screen_sized(app, WIDTH, HEIGHT)
}

pub fn screen_sized(app: &mut App, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("a test terminal");
    terminal.draw(|frame| app.draw(frame)).expect("drawing");
    terminal.backend().to_string()
}

/// A drawn buffer's text, a line per row.
pub fn text(buffer: &ratatui::buffer::Buffer) -> String {
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer.cell((x, y)).map_or(" ", |c| c.symbol()))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Presses keys in order. Work a key starts finishes before the next key,
/// as if it took no time.
pub fn press(app: &mut App, keys: &[KeyCode]) {
    for key in keys {
        let commands = press_only(app, *key);
        settle(app, commands);
    }
}

/// Clicks where `label` is drawn on the screen as it is now: the first
/// row showing it, at the label's first character. Work the click starts
/// is done before this returns.
pub fn click(app: &mut App, label: &str) {
    let shown = screen(app);
    let (row, column) = shown
        .lines()
        .enumerate()
        .find_map(|(y, line)| {
            let line = line.trim_matches('"');
            line.find(label).map(|x| (y, line[..x].chars().count()))
        })
        .expect("the label is on the screen");
    let event = ratatui::crossterm::event::MouseEvent {
        kind: ratatui::crossterm::event::MouseEventKind::Down(
            ratatui::crossterm::event::MouseButton::Left,
        ),
        column: column as u16,
        row: row as u16,
        modifiers: ratatui::crossterm::event::KeyModifiers::NONE,
    };
    let commands = match Event::mouse(event) {
        Some(e) => app.update(e),
        None => Vec::new(),
    };
    settle(app, commands);
}

/// Presses a key and returns the work it started, not yet run.
pub fn press_only(app: &mut App, key: KeyCode) -> Vec<Command> {
    app.update(Event::key(KeyEvent::from(key)))
}

/// Runs work, and whatever work it leads to, until none is left.
pub fn settle(app: &mut App, mut commands: Vec<Command>) {
    while let Some(command) = commands.pop() {
        let more = app.update(command.run());
        commands.extend(more);
    }
}

/// A fresh interface on all of `acme`'s history, with the work it starts
/// done: the Map laid out.
pub fn opened(span: Span) -> App {
    let (mut app, work) = App::new(session(span));
    settle(&mut app, work);
    app
}

/// What GitHub might say about acme, for the GitHub Panel.
pub fn github() -> GitHub {
    let at = |days: i64, hours: i64| ANCHOR - days * DAY + hours * 3600;
    let pr = |created: i64, merged: Option<i64>, author: &str| PullRequest {
        created,
        merged,
        closed: merged,
        state: if merged.is_some() {
            PrState::Merged
        } else {
            PrState::Open
        },
        author: author.to_string(),
    };
    GitHub {
        name_with_owner: "acme/acme".to_string(),
        description: Some("An engine, an API and a web client.".to_string()),
        url: "https://github.com/acme/acme".to_string(),
        homepage: None,
        created: Some(ANCHOR - 700 * DAY),
        pushed: Some(ANCHOR - DAY),
        private: false,
        fork: false,
        archived: false,
        stars: 1234,
        forks: 56,
        watchers: 12,
        open_issues: 7,
        closed_issues: 93,
        open_prs: 1,
        merged_prs: 210,
        closed_prs: 14,
        releases: 9,
        latest_release: Some(Release {
            name: Some("acme 1.2".to_string()),
            tag: "v1.2.0".to_string(),
            published: Some(ANCHOR - 30 * DAY),
        }),
        license: Some("MIT".to_string()),
        topics: vec!["engine".to_string(), "api".to_string()],
        languages: vec![("Rust".to_string(), 900), ("TypeScript".to_string(), 300)],
        // Merged 1, 8 and 15 days ago after 6 hours each; one still open.
        recent_prs: vec![
            pr(at(15, -6), Some(at(15, 0)), "alice"),
            pr(at(8, -6), Some(at(8, 0)), "bob"),
            pr(at(1, -6), Some(at(1, 0)), "alice"),
            pr(at(0, -2), None, "carol"),
        ],
        recent_issues: vec![Issue {
            created: at(3, 0),
            closed: None,
            open: true,
        }],
    }
}
