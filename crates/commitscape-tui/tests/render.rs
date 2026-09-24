//! The interface's seam: keys in, the screen out, drawn through ratatui's
//! `TestBackend` and compared with snapshots in `tests/snapshots/`.
//!
//! Every value on these screens was worked out by hand in `support/mod.rs`
//! before the snapshots were first accepted, and checked against them.
//! Snapshots hold text; colour is checked through the buffer where it
//! carries meaning. Accept a deliberate change with `INSTA_UPDATE=always`
//! and review the diff; CI never writes snapshots.

#![allow(clippy::expect_used)]

mod support;

use commitscape_metrics::Span;
use commitscape_tui::{App, Session};
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::KeyCode::{self, Char, Down, End, Enter, Esc};
use ratatui::style::Modifier;
use ratatui::Terminal;
use support::{click, opened, press, press_only, screen, screen_sized, settle, sliced};

/// Each Panel, as its number key opens it.
fn panel(key: char) -> String {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char(key)]);
    screen(&mut app)
}

#[test]
fn overview() {
    insta::assert_snapshot!(screen(&mut opened(Span::Quarter)));
}

#[test]
fn activity() {
    insta::assert_snapshot!(panel('2'));
}

#[test]
fn people() {
    insta::assert_snapshot!(panel('3'));
}

#[test]
fn map() {
    insta::assert_snapshot!(panel('4'));
}

#[test]
fn hotspots() {
    insta::assert_snapshot!(panel('5'));
}

#[test]
fn coupling() {
    insta::assert_snapshot!(panel('6'));
}

#[test]
fn ownership() {
    insta::assert_snapshot!(panel('7'));
}

#[test]
fn age() {
    insta::assert_snapshot!(panel('8'));
}

#[test]
fn github_without_gh_says_how_to_get_it() {
    insta::assert_snapshot!(panel('9'));
}

#[test]
fn github_with_an_answer() {
    let mut session = support::session(Span::Quarter);
    let answer = support::github();
    session.github = Ok(Box::new(move || Ok(answer)));
    let (mut app, work) = App::new(session);
    settle(&mut app, work);
    press(&mut app, &[Char('9')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_hotspot_opens_onto_its_file() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('5'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_coupled_pair_opens_onto_the_commits_it_shared() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('6'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_directory_opens_onto_its_owners_and_the_80_percent_line() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('7'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_person_opens_onto_when_and_what_they_work_on_and_who_they_may_also_be() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('3'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn changing_the_window_keeps_what_is_open_and_shows_it_for_the_new_window() {
    // The files untouched for a month, then the first of them, opened over
    // 90 days. After `w` the same two are open, now over a year, exactly as
    // if they had been opened there.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('8'), Down, Enter, Enter]);
    press(&mut app, &[Char('w')]);
    let mut year = opened(Span::Year);
    press(&mut year, &[Char('8'), Down, Enter, Enter]);
    let after = screen(&mut app);
    assert!(after.contains("1 year"), "{after}");
    assert_eq!(after, screen(&mut year));
    press(&mut app, &[Esc]);
    press(&mut year, &[Esc]);
    assert_eq!(
        screen(&mut app),
        screen(&mut year),
        "and the one beneath it"
    );
}

#[test]
fn a_merged_person_says_what_was_merged_and_why_and_can_be_undone() {
    // Bob, second in the People list, committed once from his laptop under
    // his full name: 8 commits as bob@example.com in 90 days and before,
    // 10 in all, and 1 from the laptop.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('3'), Down, Enter]);
    insta::assert_snapshot!(screen(&mut app));

    // Undone, the laptop is a person of its own, and Bob's profile, open
    // again, says he was kept apart.
    press(&mut app, &[Char('u')]);
    let profile = screen(&mut app);
    assert!(
        profile.contains("You kept these identities apart"),
        "{profile}"
    );
    press(&mut app, &[Esc]);
    let people = screen(&mut app);
    assert!(people.contains("5 people"), "{people}");

    // And redone, from the same row.
    press(&mut app, &[Enter, Char('u'), Esc]);
    let redone = screen(&mut app);
    assert!(redone.contains("4 people"), "{redone}");
    assert!(redone.contains("Bob Builder      "), "{redone}");
    assert!(!redone.contains("laptop"), "{redone}");
}

#[test]
fn a_click_does_what_the_keys_do() {
    // A tab, then a row: the second Hotspot, parser.rs.
    let mut clicked = opened(Span::Quarter);
    click(&mut clicked, "5 Hotspots");
    click(&mut clicked, "parser.rs");
    let mut keyed = opened(Span::Quarter);
    press(&mut keyed, &[Char('5'), Down, Enter]);
    assert_eq!(screen(&mut clicked), screen(&mut keyed));

    // A Window, from the header.
    click(&mut clicked, " 1y ");
    press(&mut keyed, &[Char('w')]);
    assert_eq!(screen(&mut clicked), screen(&mut keyed));

    // A block of the Map: the src folder opens as Enter opens it.
    let mut clicked = opened(Span::Quarter);
    click(&mut clicked, "4 Map");
    click(&mut clicked, "src");
    let mut keyed = opened(Span::Quarter);
    press(&mut keyed, &[Char('4'), Enter]);
    assert_eq!(screen(&mut clicked), screen(&mut keyed));
}

#[test]
fn bots_are_named_but_not_ranked_among_people() {
    // Alice makes three commits in the last month, dependabot two.
    use commitscape_index::source::RawChangeKind::{Added, Modified};
    let at = |days: i64| support::ANCHOR - days * 86_400;
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOT: (&str, &str) = (
        "dependabot[bot]",
        "49699333+dependabot[bot]@users.noreply.github.com",
    );
    let repo = commitscape_index::ScriptedRepo::new()
        .commit(at(20), ALICE, &[(b"src/main.rs", Added, blob(1))])
        .commit(at(15), BOT, &[(b"Cargo.lock", Added, blob(2))])
        .commit(at(10), ALICE, &[(b"src/main.rs", Modified, blob(3))])
        .commit(at(5), BOT, &[(b"Cargo.lock", Modified, blob(4))])
        .commit(at(2), ALICE, &[(b"src/main.rs", Modified, blob(5))])
        .head_file(b"src/main.rs", "fn main() {}\n")
        .head_file(b"Cargo.lock", "# lock\n");
    let (mut app, work) = App::new(support::session_of(repo, Span::Quarter));
    settle(&mut app, work);
    press(&mut app, &[Char('3')]);
    let people = screen(&mut app);
    assert!(people.contains("1 person"), "{people}");
    assert!(people.contains("1 committed in 90 days"), "{people}");
    assert!(
        people.contains("Left out as bots: dependabot[bot], 2 commits in 90 days"),
        "{people}"
    );
}

#[test]
fn worth_a_look_names_a_folder_once_and_work_leaves_out_manifests() {
    // Dev makes twelve commits in app/marketing/src/, each bumping
    // package.json too; Pat one in app/marketing/; Ann five in app/.
    // app/marketing/ is Dev's 12 of 13 (92%), and its src/ Dev's 12 of 12:
    // one finding, not two. app/ and the root are Dev's 12 of 18 (67%).
    use commitscape_index::source::RawChangeKind::{Added, Modified};
    let at = |days: i64| support::ANCHOR - days * 86_400;
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const DEV: (&str, &str) = ("Dev Example", "dev@example.com");
    const PAT: (&str, &str) = ("Pat Example", "pat@example.com");
    let mut repo = commitscape_index::ScriptedRepo::new();
    for n in 0..12u8 {
        let kind = if n == 0 { Added } else { Modified };
        repo = repo.commit(
            at(40 - i64::from(n)),
            DEV,
            &[
                (b"app/marketing/src/page.ts", kind, blob(2 * n + 1)),
                (b"package.json", kind, blob(2 * n + 2)),
            ],
        );
    }
    const ANN: (&str, &str) = ("Ann Example", "ann@example.com");
    for n in 0..5u8 {
        let kind = if n == 0 { Added } else { Modified };
        repo = repo.commit(
            at(25 - i64::from(n)),
            ANN,
            &[(b"app/api.ts", kind, blob(50 + n))],
        );
    }
    let repo = repo
        .commit(at(3), PAT, &[(b"app/marketing/index.ts", Added, blob(99))])
        .head_file(b"app/api.ts", "export const api = 1;\n")
        .head_file(b"app/marketing/src/page.ts", "export const page = 1;\n")
        .head_file(b"app/marketing/index.ts", "export * from './src/page';\n")
        .head_file(b"package.json", "{}\n");
    let (mut app, work) = App::new(support::session_of(repo, Span::Quarter));
    settle(&mut app, work);
    let overview = screen(&mut app);
    assert!(
        overview.contains("app/marketing/: 92% of commits by Dev Example"),
        "{overview}"
    );
    assert!(!overview.contains("app/marketing/src/:"), "{overview}");

    press(&mut app, &[Char('3'), Enter]);
    let profile = screen(&mut app);
    assert!(profile.contains("page.ts"), "{profile}");
    assert!(!profile.contains("package.json"), "{profile}");
    assert!(profile.contains("12 of 13"), "{profile}");
}

#[test]
fn people_show_lines_once_they_are_counted() {
    // Alice adds src/main.rs, 3 lines, then changes one and adds one: +5
    // -1. Bob adds src/lib.rs, 4 lines, and a 50-line lockfile, which is
    // not anyone's writing: +4 -0.
    use commitscape_index::source::RawChangeKind::{Added, Modified};
    let at = |days: i64| support::ANCHOR - days * 86_400;
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOB: (&str, &str) = ("Bob Builder", "bob@example.com");
    let lock: String = (1..=50).map(|n| format!("dep-{n}\n")).collect();
    let repo = commitscape_index::ScriptedRepo::new()
        .commit(at(20), ALICE, &[(b"src/main.rs", Added, blob(1))])
        .commit(at(10), ALICE, &[(b"src/main.rs", Modified, blob(2))])
        .commit(
            at(5),
            BOB,
            &[
                (b"src/lib.rs", Added, blob(3)),
                (b"Cargo.lock", Added, blob(4)),
            ],
        )
        .blob(blob(1), "a\nb\nc\n")
        .blob(blob(2), "a\nB\nc\nd\n")
        .blob(blob(3), "1\n2\n3\n4\n")
        .blob(blob(4), &lock)
        .head_file(b"src/main.rs", "a\nB\nc\nd\n")
        .head_file(b"src/lib.rs", "1\n2\n3\n4\n")
        .head_file(b"Cargo.lock", &lock);
    let mut session = support::session_of(repo.clone(), Span::Quarter);
    session.lines = Some(Box::new(move |index: &commitscape_core::Index| {
        commitscape_index::line_pass(&repo, index, None, &mut |_, _| {}).ok()
    }));
    let (mut app, work) = App::new(session);
    press(&mut app, &[Char('3')]);
    let counting = screen(&mut app);
    assert!(counting.contains("counting…"), "{counting}");

    settle(&mut app, work);
    let counted = screen(&mut app);
    assert!(counted.contains("+5 −1"), "{counted}");
    assert!(counted.contains("+4 −0"), "{counted}");
}

#[test]
fn an_age_bucket_opens_onto_its_files_and_a_file_onto_itself() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('8'), Down, Enter]);
    insta::assert_snapshot!("month_bucket", screen(&mut app));
    press(&mut app, &[End, Enter]);
    insta::assert_snapshot!("file_from_the_month_bucket", screen(&mut app));
}

#[test]
fn the_map_goes_into_a_folder_and_back_out() {
    // src/ is the largest folder at the top, so it is selected first.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('4'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
    press(&mut app, &[Esc]);
    assert_eq!(screen(&mut app), panel('4'), "Esc comes back out");
}

#[test]
fn the_map_is_laid_out_after_the_first_frame() {
    // On Linux the Map takes 70ms to lay out, most of the first frame's
    // budget, so it comes after that frame. Until then the Panel says so.
    let (mut app, work) = App::new(support::session(Span::Quarter));
    press(&mut app, &[Char('4')]);
    assert!(screen(&mut app).contains("Drawing the map…"));
    settle(&mut app, work);
    assert_eq!(screen(&mut app), panel('4'));
}

#[test]
fn the_map_colours_by_owner() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('4'), Char('c'), Char('c')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn help_explains_the_screen_it_opens_on() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('5'), Char('?')]);
    insta::assert_snapshot!(screen(&mut app));
    press(&mut app, &[Esc]);
    assert_eq!(screen(&mut app), panel('5'), "Esc closes it");
}

#[test]
fn a_search_narrows_a_list() {
    let mut app = opened(Span::Quarter);
    press(
        &mut app,
        &[Char('5'), Char('/'), Char('c'), Char('l'), Char('i'), Enter],
    );
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn the_selected_row_is_marked_with_a_background_not_inverted() {
    // The first version inverted the selected row's colours, which turned
    // its bars into blocks of background. It now keeps every colour and
    // lays a dark blue behind the row.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('8')]);
    let mut terminal = Terminal::new(TestBackend::new(110, 26)).expect("a test terminal");
    terminal.draw(|frame| app.draw(frame)).expect("drawing");
    let buffer = terminal.backend().buffer();
    let reversed = buffer
        .content
        .iter()
        .filter(|cell| cell.modifier.contains(Modifier::REVERSED))
        .count();
    assert_eq!(reversed, 0, "nothing is drawn inverted");
    let text_of = |y: u16| -> String {
        (0..buffer.area.width)
            .filter_map(|x| buffer.cell((x, y)).map(|c| c.symbol().to_string()))
            .collect()
    };
    let row = (0..buffer.area.height)
        .find(|&y| text_of(y).contains("under a week"))
        .expect("the first bucket is on screen");
    let selected = ratatui::style::Color::Rgb(0x0d, 0x36, 0x6b);
    let marked = (0..buffer.area.width)
        .filter(|&x| buffer.cell((x, row)).is_some_and(|c| c.bg == selected))
        .count();
    assert!(
        marked >= 40,
        "the row carries the selection colour across its box: {marked}"
    );
}

/// The screen below the tabs: what a detail shows, whichever Panel it was
/// opened from.
fn below_tabs(screen: String) -> String {
    screen.lines().skip(3).collect::<Vec<_>>().join("\n")
}

#[test]
fn every_overview_finding_opens() {
    // Directory, hotspot, pair, staleness, people: each is the detail its
    // own Panel opens, or for people the Panel itself.
    let expect: [(Vec<KeyCode>, usize); 5] = [
        (vec![Char('7'), Enter], 0),
        (vec![Char('5'), Enter], 1),
        (vec![Char('6'), Enter], 2),
        (vec![Char('8'), End, Enter], 3),
        (vec![Char('3')], 4),
    ];
    for (keys, row) in expect {
        let mut via_panel = opened(Span::Quarter);
        press(&mut via_panel, &keys);
        let mut via_overview = opened(Span::Quarter);
        let mut path = vec![Down; row];
        path.push(Enter);
        press(&mut via_overview, &path);
        assert_eq!(
            below_tabs(screen(&mut via_overview)),
            below_tabs(screen(&mut via_panel)),
            "overview row {row}"
        );
    }
}

#[test]
fn escape_backs_out_one_level() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('8'), Down]);
    let bucket_panel = screen(&mut app);
    press(&mut app, &[Enter, Enter, Esc, Esc]);
    assert_eq!(screen(&mut app), bucket_panel);
}

#[test]
fn the_year_shows_what_ninety_days_hide() {
    // Within the year, Alice's home address adds three commits to
    // src/engine/, which drops her own share to 30 of 37, 81%: still one
    // person holds it, but only just.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('w'), Char('7')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_slice_of_history_draws_the_same_first_frame_as_all_of_it() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut recent, _) = App::new(sliced(Span::Quarter, dir.path()));
    assert_eq!(screen(&mut recent), screen(&mut opened(Span::Quarter)));
}

#[test]
fn a_longer_window_waits_for_the_rest_of_history_then_shows_it() {
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut app, work) = App::new(sliced(Span::Quarter, dir.path()));
    assert_eq!(
        work.len(),
        2,
        "reading the rest and laying out the Map start with the interface"
    );

    let started = press_only(&mut app, Char('w'));
    assert!(
        started.is_empty(),
        "nothing to compute until history arrives"
    );
    insta::assert_snapshot!(screen(&mut app));

    settle(&mut app, work);
    let mut full = opened(Span::Year);
    assert_eq!(screen(&mut app), screen(&mut full));
}

#[test]
fn a_list_taller_than_the_screen_scrolls_to_keep_the_selection_in_view() {
    // Sixteen rows leave room for three of the four Hotspots.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('5'), Down, Down, Down]);
    insta::assert_snapshot!(screen_sized(&mut app, 110, 16));
}

#[test]
fn a_quiet_window_says_so_rather_than_showing_blanks() {
    // A year and a half after acme's last commit, the last 90 days hold
    // nothing; the totals and the language bar still describe the code.
    let mut session: Session = support::session(Span::Quarter);
    session.anchor = support::ANCHOR + 540 * 86_400;
    let (mut app, _) = App::new(session);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn the_card_tells_the_story_of_all_of_history() {
    // All of acme's history: 58 commits by four people since 31 July 2023,
    // 542 lines of code, 77% of it Rust, and the facts the Overview finds.
    let card = commitscape_tui::card(support::session(Span::All));
    insta::assert_snapshot!(support::text(&card));
    // 120 by 36 cells of 9 by 19 pixels.
    let svg = commitscape_tui::svg(&card);
    assert!(svg.starts_with(r#"<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="684""#));
    assert!(svg.trim_end().ends_with("</svg>"), "a whole SVG document");
    assert!(
        svg.contains(">all of history · made with</text>"),
        "words stay together, so the image's text can be searched and copied"
    );
}
