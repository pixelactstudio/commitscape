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

pub const ANCHOR: i64 = 1_751_328_000;
const DAY: i64 = 86_400;

pub const WIDTH: u16 = 110;
pub const HEIGHT: u16 = 26;

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const ALICE_HOME: (&str, &str) = ("alice", "alice@home.example.net");
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

pub fn session(span: Span) -> Session {
    session_of(acme(), span)
}

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
        releases: None,
        theme: commitscape_tui::Theme::Dark,
    }
}

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
        releases: None,
        theme: commitscape_tui::Theme::Dark,
    }
}

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

pub fn screen(app: &mut App) -> String {
    screen_sized(app, WIDTH, HEIGHT)
}

pub fn screen_sized(app: &mut App, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("a test terminal");
    terminal.draw(|frame| app.draw(frame)).expect("drawing");
    terminal.backend().to_string()
}

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

pub fn press(app: &mut App, keys: &[KeyCode]) {
    for key in keys {
        let commands = press_only(app, *key);
        settle(app, commands);
    }
}

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

pub fn press_only(app: &mut App, key: KeyCode) -> Vec<Command> {
    app.update(Event::key(KeyEvent::from(key)))
}

pub fn settle(app: &mut App, mut commands: Vec<Command>) {
    while let Some(command) = commands.pop() {
        let more = app.update(command.run());
        commands.extend(more);
    }
}

pub fn opened(span: Span) -> App {
    let (mut app, work) = App::new(session(span));
    settle(&mut app, work);
    app
}

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
            first_answer: None,
        }],
    }
}
