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
use support::{opened, press, press_only, screen, screen_sized, settle, sliced};

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
