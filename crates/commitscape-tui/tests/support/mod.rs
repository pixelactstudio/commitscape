//! The repository every snapshot is drawn from, `acme`, written out by hand,
//! and the helpers that drive the interface without a terminal.
//!
//! Anchored at 2025-07-01T00:00:00Z. A commit made `d` days ago is stamped
//! an hour before `anchor - d days`, so it is exactly `d` days old and never
//! sits on a Window's edge. The Bulk Commit threshold is 5 files.
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
//! - One group of people who may be one person: Alice (35 commits) and
//!   Alice at home (3).

#![allow(dead_code, clippy::expect_used)]

use std::path::Path;

use commitscape_core::{Index, Oid};
use commitscape_index::source::RawChangeKind::{self, Added, Modified};
use commitscape_index::{index_from_scratch, load, CacheOptions, ScriptedRepo, Since};
use commitscape_metrics::{Options, Span};
use commitscape_tui::{App, Command, Event, LoadOlder, Session};
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::Terminal;

/// 2025-07-01T00:00:00Z.
pub const ANCHOR: i64 = 1_751_328_000;
const DAY: i64 = 86_400;

pub const WIDTH: u16 = 110;
pub const HEIGHT: u16 = 26;

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const ALICE_HOME: (&str, &str) = ("Alice Example", "alice@home.example.net");
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

impl Script {
    fn commit(
        mut self,
        days_ago: i64,
        who: (&str, &str),
        kind: RawChangeKind,
        paths: &[&str],
    ) -> Self {
        let mut changes = Vec::new();
        for path in paths {
            self.blobs += 1;
            let mut id = [0u8; 20];
            id[..2].copy_from_slice(&self.blobs.to_be_bytes());
            changes.push((path.as_bytes(), kind, Oid(id)));
        }
        self.repo = self
            .repo
            .commit(ANCHOR - days_ago * DAY - 3600, who, &changes);
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
    .commit(700, ALICE, Added, &[CORE, PARSER, OLD, GUIDE, LOCK])
    .commit(600, ALICE, Modified, &[OLD])
    .commit(500, ALICE, Added, &[STRINGS])
    .commit(420, ALICE, Modified, &[CORE, LOCK])
    .commit(400, BOB, Added, &[HANDLERS, CLIENT])
    .commit(300, ALICE_HOME, Modified, &[PARSER])
    .commit(250, ALICE_HOME, Modified, &[PARSER])
    .commit(210, ALICE, Modified, &[STRINGS])
    .commit(200, ALICE_HOME, Modified, &[PARSER])
    .commit(150, CAROL, Modified, &[GUIDE])
    .commit(120, BOB, Modified, &[HANDLERS, CLIENT]);

    let mut recent: Vec<(i64, (&str, &str), Vec<&str>)> = Vec::new();
    for k in 0..27 {
        let day = 88 - 3 * k;
        let paths = if k % 2 == 0 {
            vec![CORE, PARSER]
        } else {
            vec![CORE]
        };
        recent.push((day, ALICE, paths));
    }
    for day in [80, 71, 60, 50, 41, 32] {
        recent.push((day, BOB, vec![HANDLERS, CLIENT]));
    }
    recent.push((20, BOB, vec![CLIENT]));
    recent.push((11, BOB, vec![HANDLERS]));
    for day in [45, 35, 26, 15] {
        recent.push((day, CAROL, vec![CORE]));
    }
    recent.push((38, CAROL, vec![GUIDE]));
    recent.push((12, CAROL, vec![GUIDE]));
    recent.push((24, BOB, vec![CORE, PARSER, HANDLERS, CLIENT, GUIDE, LOCK]));
    recent.sort_by_key(|(day, _, _)| -day);
    for (day, who, paths) in recent {
        s = s.commit(day, who, Modified, &paths);
    }

    // Day 10 is Alice's last commit before Carol's branch.
    let base = s.commits;
    s = s.commit(8, CAROL, Modified, &[GUIDE]);
    let side = s.commits;
    s.repo = s.repo.at(base);
    s = s.commit(7, ALICE, Modified, &[CORE]);
    s.repo = s.repo.merge(ANCHOR - 6 * DAY - 3600, CAROL, side, &[]);
    s.commits += 1;
    s = s
        .commit(4, ALICE, Modified, &[CORE, PARSER])
        .commit(1, ALICE, Modified, &[CORE]);

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
    let index = match index_from_scratch(&acme()) {
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
    }
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

/// Presses keys in order. Work a key starts finishes before the next key,
/// as if it took no time.
pub fn press(app: &mut App, keys: &[KeyCode]) {
    for key in keys {
        let commands = press_only(app, *key);
        settle(app, commands);
    }
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

/// A fresh interface on all of `acme`'s history.
pub fn opened(span: Span) -> App {
    App::new(session(span)).0
}
