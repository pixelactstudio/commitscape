//! The interface's seam: keys in, the screen out, drawn through ratatui's
//! `TestBackend` and compared with snapshots in `tests/snapshots/`.
//!
//! Every value on these screens was worked out by hand in `support/mod.rs`
//! before the snapshots were first accepted, and checked against them.
//! Accept a deliberate change with `INSTA_UPDATE=always` and review the
//! diff; CI never writes snapshots.

#![allow(clippy::expect_used)]

mod support;

use commitscape_metrics::Span;
use commitscape_tui::App;
use ratatui::crossterm::event::KeyCode::{Char, Down, End, Enter, Esc};
use support::{opened, press, press_only, screen, screen_sized, settle, sliced};

#[test]
fn overview() {
    insta::assert_snapshot!(screen(&mut opened(Span::Quarter)));
}

#[test]
fn hotspots() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('2')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn coupling() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('3')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn ownership() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('4')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn staleness() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('5')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn code_age() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('6')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn people() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('7')]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_hotspot_opens_onto_its_file() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('2'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_coupled_pair_opens_onto_the_commits_it_shared() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('3'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_directory_opens_onto_its_owners_and_the_80_percent_line() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('4'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_staleness_bucket_opens_onto_its_files_and_a_file_onto_itself() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('5'), Down, Enter]);
    insta::assert_snapshot!("month_bucket", screen(&mut app));
    press(&mut app, &[End, Enter]);
    insta::assert_snapshot!("file_from_the_month_bucket", screen(&mut app));
}

#[test]
fn a_quarter_opens_onto_the_code_that_appeared_in_it() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('6'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn a_group_of_people_opens_onto_the_mailmap_lines_that_would_join_them() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('7'), Enter]);
    insta::assert_snapshot!(screen(&mut app));
}

#[test]
fn every_overview_finding_opens() {
    // Directory, hotspot, pair, staleness, people: each is the detail its own
    // Panel opens, or for people the Panel itself.
    let expect = [
        (vec![Char('4'), Enter], 0),
        (vec![Char('2'), Enter], 1),
        (vec![Char('3'), Enter], 2),
        (vec![Char('5'), End, Enter], 3),
        (vec![Char('7')], 4),
    ];
    for (keys, row) in expect {
        let mut via_panel = opened(Span::Quarter);
        press(&mut via_panel, &keys);
        let mut via_overview = opened(Span::Quarter);
        let mut path = vec![Down; row];
        path.push(Enter);
        press(&mut via_overview, &path);
        assert_eq!(
            screen(&mut via_overview),
            screen(&mut via_panel),
            "overview row {row}"
        );
    }
}

#[test]
fn escape_backs_out_one_level() {
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('5'), Down]);
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
    press(&mut app, &[Char('w'), Char('4')]);
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
    let (mut app, older) = App::new(sliced(Span::Quarter, dir.path()));
    assert_eq!(older.len(), 1, "reading the rest starts with the interface");

    let started = press_only(&mut app, Char('w'));
    assert!(
        started.is_empty(),
        "nothing to compute until history arrives"
    );
    insta::assert_snapshot!(screen(&mut app));

    settle(&mut app, older);
    let mut full = opened(Span::Year);
    assert_eq!(screen(&mut app), screen(&mut full));
}

#[test]
fn a_list_taller_than_the_screen_scrolls_to_keep_the_selection_in_view() {
    // Eight rows leave room for two of the four Hotspots.
    let mut app = opened(Span::Quarter);
    press(&mut app, &[Char('2'), Down, Down, Down]);
    insta::assert_snapshot!(screen_sized(&mut app, 100, 8));
}
