//! What opens when a row is entered.

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::activity::{draw_calendar, draw_week};
use super::charts;
use super::{
    bold, boxed, clip, dot, faint, fit, highlight, many, plain, section, short_phrase, split_path,
    tile, visible, wrap_spans,
};
use crate::app::App;
use crate::detail::{
    CommitLine, Detail, DirectoryDetail, FileDetail, ListedFile, Opened, PairDetail, PersonDetail,
};
use crate::format::{ago, bytes, compact, date, days, grouped, most, percent, share, short_date};
use crate::theme::{self, ACCENT, CRITICAL, MUTED, SERIES};
use commitscape_core::PersonTraits;

const DAY: i64 = 86_400;

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, opened: &mut Opened) {
    match &opened.detail {
        Detail::File(d) => file(app, frame, area, d, &mut opened.scroll),
        Detail::Pair(d) => pair(app, frame, area, d, &mut opened.scroll),
        Detail::Directory(d) => directory(app, frame, area, d, &mut opened.scroll),
        Detail::Person(d) => person(app, frame, area, d, &mut opened.scroll),
        Detail::Bucket { age, files } => files_list(
            app,
            frame,
            area,
            &format!("Files last touched {} ago", age.label()),
            ["days", "last touched"],
            files,
            &mut opened.cursor,
            |f| (grouped(f.number.max(0) as u64), date(f.other)),
        ),
    }
}

/// Lines in a section, scrolled by whole lines with ↑↓.
fn scrolled(frame: &mut Frame, area: Rect, title: &str, lines: Vec<Line<'_>>, scroll: &mut usize) {
    let height = usize::from(area.height.saturating_sub(2));
    *scroll = (*scroll).min(lines.len().saturating_sub(height));
    let note = (lines.len() > height).then(|| {
        format!(
            "{}–{} of {}",
            *scroll + 1,
            (*scroll + height).min(lines.len()),
            lines.len()
        )
    });
    let block = section(area.width, title, note);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .wrap(ratatui::widgets::Wrap { trim: false })
            .scroll((u16::try_from(*scroll).unwrap_or(u16::MAX), 0)),
        area,
    );
}

fn file(app: &App, frame: &mut Frame, area: Rect, d: &FileDetail, scroll: &mut usize) {
    let (dir, name) = split_path(&d.path);
    let [title, tiles, body] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Length(5),
        Constraint::Fill(1),
    ])
    .areas(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(vec![
                Span::raw(" "),
                bold(name.to_string()),
                faint(format!("   {dir}")),
            ]),
            Line::from(vec![
                Span::raw(" "),
                faint(
                    d.former
                        .first()
                        .map_or(String::new(), |f| format!("formerly {f}")),
                ),
            ]),
        ]),
        title,
    );
    let areas = Layout::horizontal([Constraint::Ratio(1, 4); 4]).split(tiles);
    let span = short_phrase(app.span);
    let head = d.head;
    let tiles_data = [
        (
            head.map_or("-".to_string(), |h| grouped(u64::from(h.loc))),
            "lines",
            head.map_or(String::new(), |h| bytes(h.bytes)),
        ),
        (
            head.map_or("-".to_string(), |h| grouped(u64::from(h.indent_levels))),
            "nesting",
            head.map_or(String::new(), |h| {
                format!("{:.1} levels a line", h.indent_mean)
            }),
        ),
        (grouped(u64::from(d.churn)), "changes", format!("in {span}")),
        (
            d.history.map_or("-".to_string(), |h| {
                days((app.anchor - h.last_touched).div_euclid(DAY))
            }),
            "since last touched",
            d.history.map_or(String::new(), |h| {
                format!("first seen {}", short_date(h.first_seen))
            }),
        ),
    ];
    for (area, (value, label, note)) in areas.iter().zip(tiles_data) {
        tile(frame, *area, &value, label, &note);
    }

    let [left, right] =
        Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(body);
    let room = usize::from(left.width.saturating_sub(2));
    let mut lines = Vec::new();
    if let Some(h) = d.hotspot {
        lines.push(Line::from(bold("Why it is a hotspot")));
        lines.push(Line::from(vec![
            plain("It is "),
            bold(most(h.churn_rank.place, "changed")),
            plain(format!(
                " of {} that changed in {span}, and ",
                many(u64::from(h.churn_rank.of), "code file", "code files")
            )),
            bold(most(h.complexity_rank.place, "deeply nested")),
            plain(format!(
                " of {} at HEAD. ",
                many(u64::from(h.complexity_rank.of), "code file", "code files")
            )),
            faint("Code that is both is where changes are most likely to go wrong."),
        ]));
        lines.push(Line::default());
    }
    lines.push(Line::from(bold(format!("Who changed it in {span}"))));
    let total: u32 = d.owners.iter().map(|o| o.commits).sum();
    let most_commits = d.owners.first().map_or(0, |o| u64::from(o.commits));
    if d.owners.is_empty() {
        lines.push(Line::from(faint(
            "Nobody, outside merges and bulk commits.",
        )));
    }
    let name_width = room.saturating_sub(30).clamp(8, 26);
    for (k, p) in d.owners.iter().enumerate() {
        let colour = owner_colour(app, &p.email, k);
        lines.push(super::fit_line(
            Line::from(vec![
                dot(colour),
                plain(format!(
                    "{:<name_width$}",
                    clip(&app.label_for(&p.name, &p.email), name_width)
                )),
                Span::styled(
                    format!(
                        " {:<16}",
                        charts::bar(u64::from(p.commits), most_commits, 16)
                    ),
                    Style::new().fg(colour),
                ),
                bold(format!(" {:>5}", grouped(u64::from(p.commits)))),
                faint(format!(
                    " {:>4}",
                    share(u64::from(p.commits), u64::from(total))
                )),
            ]),
            room,
        ));
    }
    if !d.coupled.is_empty() {
        lines.push(Line::default());
        lines.push(Line::from(bold("Changes together with")));
        let name_width = d
            .coupled
            .iter()
            .map(|(other, _)| split_path(other).1.chars().count())
            .max()
            .unwrap_or(0)
            .min(name_width);
        for (other, pair) in &d.coupled {
            let (_, other_name) = split_path(other);
            lines.push(super::fit_line(
                Line::from(vec![
                    Span::styled("⇄ ", Style::new().fg(ACCENT)),
                    plain(format!("{:<name_width$}", clip(other_name, name_width))),
                    bold(format!("  {:>4}", percent(pair.jaccard))),
                    faint(format!(
                        " of their commits, {} together",
                        grouped(u64::from(pair.both))
                    )),
                ]),
                room,
            ));
        }
    }
    super::prose(frame, left, lines);
    scrolled(
        frame,
        right,
        &format!("Its commits in {span}"),
        commit_lines(&d.commits, d.more),
        scroll,
    );
}

/// A person's colour from their email, matched against the Window's
/// people; the `k`-th colour when they are not among the eight.
fn owner_colour(app: &App, email: &str, k: usize) -> Color {
    app.index
        .authors
        .iter()
        .find(|(_, a)| a.email == email)
        .map(|(id, _)| app.colour_of(id))
        .unwrap_or_else(|| SERIES.get(k).copied().unwrap_or(MUTED))
}

fn commit_lines(commits: &[CommitLine], more: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Line> = commits
        .iter()
        .map(|c| {
            Line::from(vec![
                faint(format!(" {}  ", date(c.time))),
                Span::styled(format!("{}  ", c.id), Style::new().fg(theme::TEXT_2)),
                plain(c.author.clone()),
            ])
        })
        .collect();
    if commits.is_empty() {
        lines.push(Line::from(faint(" None, outside merges and bulk commits.")));
    }
    if more > 0 {
        lines.push(Line::from(faint(format!(
            " and {} more",
            grouped(more as u64)
        ))));
    }
    lines
}

fn pair(app: &App, frame: &mut Frame, area: Rect, d: &PairDetail, scroll: &mut usize) {
    let p = d.pair;
    // The box's inside, less its margins.
    let inside = area.width.saturating_sub(2);
    let (a_only, b_only) = (p.first_commits - p.both, p.second_commits - p.both);
    let either = a_only + p.both + b_only;
    let (a, b) = (split_path(&d.first).1, split_path(&d.second).1);
    let bar = charts::stacked(
        &[
            (u64::from(a_only), SERIES[0]),
            (u64::from(p.both), SERIES[6]),
            (u64::from(b_only), SERIES[1]),
        ],
        inside.saturating_sub(2),
    );
    let mut lines = vec![
        Line::from(vec![
            dot(SERIES[0]),
            bold(a.to_string()),
            faint(format!("  in {}", super::home(split_path(&d.first).0))),
        ]),
        Line::from(vec![
            dot(SERIES[1]),
            bold(b.to_string()),
            faint(format!("  in {}", super::home(split_path(&d.second).0))),
        ]),
        Line::default(),
        bar,
        Line::from(vec![
            dot(SERIES[0]),
            faint(format!("{} only {}   ", a, grouped(u64::from(a_only)))),
            dot(SERIES[6]),
            plain(format!("both {}   ", grouped(u64::from(p.both)))),
            dot(SERIES[1]),
            faint(format!("{} only {}", b, grouped(u64::from(b_only)))),
        ]),
        Line::default(),
        Line::from(vec![
            plain("Of the "),
            bold(grouped(u64::from(either))),
            plain(" commits that changed either file, "),
            bold(grouped(u64::from(p.both))),
            plain(" changed both: "),
            bold(percent(p.jaccard)),
            plain(". When "),
            plain(b.to_string()),
            plain(" changed, "),
            plain(a.to_string()),
            plain(" changed too "),
            bold(format!("{} of {} times", p.both, p.second_commits)),
            plain("; when "),
            plain(a.to_string()),
            plain(" changed, "),
            plain(b.to_string()),
            plain(" changed too "),
            bold(format!("{} of {} times", p.both, p.first_commits)),
            plain("."),
        ]),
    ];
    if p.cross_directory {
        lines.push(Line::from(vec![
            Span::styled("▲ ", Style::new().fg(theme::WARNING)),
            plain("They live in different folders, so this may be a dependency nobody wrote down."),
        ]));
    }
    let height = super::prose_height(&lines, inside) + 2;
    let [top, bottom] =
        Layout::vertical([Constraint::Length(height), Constraint::Fill(1)]).areas(area);
    let inner = boxed(frame, top, "Changing together", None);
    super::prose(frame, inner, lines);
    scrolled(
        frame,
        bottom,
        &format!("Commits in {} that changed both", short_phrase(app.span)),
        commit_lines(&d.commits, d.more),
        scroll,
    );
}

fn directory(app: &App, frame: &mut Frame, area: Rect, d: &DirectoryDetail, scroll: &mut usize) {
    let o = &d.ownership;
    let total = u64::from(o.commits);
    let mut lines = vec![
        Line::from(vec![
            plain(" "),
            bold(many(total, "commit", "commits")),
            plain(format!(
                " in {} touched files people wrote in ",
                short_phrase(app.span)
            )),
            bold(super::folder(&o.label()).to_string()),
            plain("."),
        ]),
        Line::from(vec![
            plain(" Bus factor "),
            Span::styled(
                o.bus_factor.to_string(),
                Style::new().fg(if o.bus_factor == 1 {
                    CRITICAL
                } else {
                    theme::TEXT
                }),
            ),
            plain(": the fewest people who together made more than 80% of them."),
        ]),
        Line::default(),
    ];
    let parts: Vec<(u64, Color)> = d
        .owners
        .iter()
        .enumerate()
        .map(|(k, p)| (u64::from(p.commits), owner_colour(app, &p.email, k)))
        .collect();
    let mut bar = vec![Span::raw(" ")];
    bar.extend(charts::stacked(&parts, area.width.saturating_sub(6)).spans);
    lines.push(Line::from(bar));
    lines.push(Line::default());
    lines.push(Line::from(faint(format!(
        " {:<24} {:<30} {:>8} {:>6} {:>8}",
        "person", "email", "commits", "share", "running"
    ))));
    let mut running = 0u64;
    for (k, p) in d.owners.iter().enumerate() {
        running += u64::from(p.commits);
        let mut spans = vec![
            Span::raw(" "),
            dot(owner_colour(app, &p.email, k)),
            plain(format!(
                "{:<22} ",
                clip(&app.label_for(&p.name, &p.email), 22)
            )),
            faint(format!("{:<30}", clip(&p.email, 30))),
            bold(format!(" {:>8}", grouped(u64::from(p.commits)))),
            plain(format!(" {:>6}", share(u64::from(p.commits), total))),
            plain(format!(" {:>8}", share(running, total))),
        ];
        if k + 1 == o.bus_factor as usize {
            spans.push(Span::styled("   past 80%", Style::new().fg(ACCENT)));
        }
        lines.push(Line::from(spans));
    }
    scrolled(
        frame,
        area,
        &format!("Who holds {}", super::folder(&o.label())),
        lines,
        scroll,
    );
}

fn person(app: &App, frame: &mut Frame, area: Rect, d: &PersonDetail, scroll: &mut usize) {
    let colour = app.colour_of(d.author);
    let [title, tiles, charts_area, lists] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(5),
        Constraint::Length(super::activity::GRID_HEIGHT),
        Constraint::Fill(1),
    ])
    .areas(area);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::raw(" "),
            dot(colour),
            bold(app.display_name(d.author)),
            faint(format!("   {}", d.email)),
        ])),
        title,
    );
    let span = short_phrase(app.span);
    let c = d.contributor;
    let p = &d.pulse;
    let values = [
        (
            c.map_or("0".to_string(), |c| grouped(u64::from(c.commits))),
            "commits".to_string(),
            format!("in {span}"),
        ),
        match (&app.lines, d.contribution) {
            (crate::app::Lines::Counted, Some(c)) if c.lines.counted > 0 => (
                format!("+{} −{}", compact(c.lines.added), compact(c.lines.removed)),
                "lines added, removed".to_string(),
                "not lockfiles, not generated".to_string(),
            ),
            (crate::app::Lines::Waiting(_) | crate::app::Lines::Counting, _) => (
                "…".to_string(),
                "lines added, removed".to_string(),
                "counting lines…".to_string(),
            ),
            _ => (
                "-".to_string(),
                "lines added, removed".to_string(),
                "none counted".to_string(),
            ),
        },
        (
            grouped(u64::from(p.active_days)),
            "active days".to_string(),
            format!("in {span}"),
        ),
        (
            p.longest_streak
                .map_or("-".to_string(), |s| many(u64::from(s.days), "day", "days")),
            "longest streak".to_string(),
            p.longest_streak.map_or(String::new(), |s| {
                if s.days == 1 {
                    "no two in a row".to_string()
                } else {
                    format!("from {}", short_date(s.first_day * DAY))
                }
            }),
        ),
        (
            c.map_or("-".to_string(), |c| short_date(c.first)),
            "first commit".to_string(),
            format!("in {span}"),
        ),
        (
            c.map_or("-".to_string(), |c| short_date(c.last)),
            "last commit".to_string(),
            c.map_or(
                String::new(),
                |c| ago((app.anchor - c.last).div_euclid(DAY)),
            ),
        ),
    ];
    let areas = Layout::horizontal([Constraint::Ratio(1, 6); 6]).split(tiles);
    for (area, (value, label, note)) in areas.iter().zip(values) {
        tile(frame, *area, &value, &label, &note);
    }
    let [calendar, week] =
        Layout::horizontal([Constraint::Fill(1), Constraint::Length(56)]).areas(charts_area);
    draw_calendar(p, frame, calendar);
    draw_week(p, frame, week);

    let [works, held] =
        Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(lists);
    let most = d.work.first().map_or(0, |w| u64::from(w.1));
    let room = usize::from(works.width.saturating_sub(2));
    let name_width = (room / 3).clamp(10, 24);
    let work: Vec<Line> = d
        .work
        .iter()
        .map(|(path, n)| {
            let (dir, name) = split_path(path);
            super::fit_line(
                Line::from(vec![
                    Span::raw(" "),
                    plain(format!("{:<name_width$}", clip(name, name_width))),
                    Span::styled(
                        format!("{:<12}", charts::bar(u64::from(*n), most, 12)),
                        Style::new().fg(colour),
                    ),
                    bold(format!(" {:>4}", grouped(u64::from(*n)))),
                    faint(format!("  {dir}")),
                ]),
                room,
            )
        })
        .collect();
    let work = if work.is_empty() {
        vec![Line::from(faint(" No files people wrote, in this window."))]
    } else {
        work
    };
    frame.render_widget(
        Paragraph::new(work).block(section(works.width, "Works on", Some(span.to_string()))),
        works,
    );

    let name = app.display_name(d.author);
    let first = name.split_whitespace().next().unwrap_or("them").to_string();
    let mut lines = Vec::new();
    let room = usize::from(held.width.saturating_sub(2));
    let say = |text: String| wrap_spans(vec![faint(text)], room.saturating_sub(1), 1);
    identities(&mut lines, d, room);
    if d.held.is_empty() {
        lines.push(Line::from(faint(format!(
            " No folder depends on {first} alone in {span}."
        ))));
    } else {
        lines.extend(say(format!(
            " In {span}, {first} made over 80% of the commits in these folders. \
             If {first} left, few others would know them."
        )));
    }
    let dir_width = room.saturating_sub(24).max(8);
    for (dir, theirs, all) in &d.held {
        lines.push(Line::from(vec![
            Span::styled(" ▲ ", Style::new().fg(CRITICAL)),
            plain(format!(
                "{:<dir_width$}",
                fit(super::folder(dir), dir_width)
            )),
            if theirs == all {
                bold(format!(
                    " all {}",
                    many(u64::from(*all), "commit", "commits")
                ))
            } else {
                bold(format!(
                    " {} of {} commits",
                    grouped(u64::from(*theirs)),
                    grouped(u64::from(*all))
                ))
            },
        ]));
    }
    if !d.maybe_also.is_empty() {
        lines.push(Line::default());
        lines.push(Line::from(bold(" May also be")));
        for other in &d.maybe_also {
            lines.push(Line::from(vec![
                Span::raw("  "),
                plain(other.email.clone()),
                faint(format!(
                    ", {}",
                    many(u64::from(other.commits), "commit", "commits")
                )),
            ]));
        }
        lines.push(Line::from(faint(
            " Nothing was merged. If they are one person, add to .mailmap:",
        )));
        for line in d.mailmap.lines() {
            lines.push(Line::from(Span::styled(
                format!("  {line}"),
                Style::new().fg(ACCENT),
            )));
        }
    }
    scrolled(frame, held, &format!("About {first}"), lines, scroll);
}

/// Which addresses a person was joined from, and why, with the key that
/// undoes it (ADR-0011).
fn identities(lines: &mut Vec<Line<'static>>, d: &PersonDetail, room: usize) {
    let kept = d.traits.contains(PersonTraits::KEPT_APART);
    if d.addresses.len() < 2 && !kept {
        return;
    }
    let why = match (
        d.traits.contains(PersonTraits::SAME_NAME),
        d.traits.contains(PersonTraits::SAME_ACCOUNT),
    ) {
        (true, true) => " · same full name, same GitHub account",
        (true, false) => " · same full name",
        (false, true) => " · same GitHub account",
        (false, false) => " · the same address, written differently",
    };
    if d.addresses.len() >= 2 {
        lines.push(Line::from(vec![
            bold(format!(" Merged {} identities", d.addresses.len())),
            faint(why),
        ]));
        let width = room.saturating_sub(18).max(8);
        for (email, n) in &d.addresses {
            lines.push(Line::from(vec![
                plain(format!("   {:<width$}", fit(email, width))),
                faint(format!(" {:>12}", many(u64::from(*n), "commit", "commits"))),
            ]));
        }
    }
    if d.traits.merged() {
        lines.push(Line::from(vec![
            Span::styled(" u", Style::new().fg(ACCENT)),
            faint(" undo, or make it permanent in .mailmap:"),
        ]));
        for line in d.merge_lines.lines() {
            lines.push(Line::from(Span::styled(
                format!("   {line}"),
                Style::new().fg(ACCENT),
            )));
        }
        lines.push(Line::default());
    } else if kept {
        lines.extend(wrap_spans(
            vec![
                faint(" You kept these identities apart. "),
                Span::styled("u", Style::new().fg(ACCENT)),
                faint(" merges them again."),
            ],
            room.saturating_sub(1),
            1,
        ));
        lines.push(Line::default());
    }
}

#[allow(clippy::too_many_arguments)]
fn files_list(
    app: &App,
    frame: &mut Frame,
    area: Rect,
    title: &str,
    columns: [&str; 2],
    files: &[ListedFile],
    cursor: &mut crate::list::Cursor,
    numbers: impl Fn(&ListedFile) -> (String, String),
) {
    let inner = boxed(frame, area, title, Some("enter for a file".to_string()));
    if files.is_empty() {
        super::empty(frame, inner, "No files.");
        return;
    }
    frame.render_widget(
        Paragraph::new(Line::from(faint(format!(
            " {:<32} {:>10} {:>14}   folder",
            "file", columns[0], columns[1]
        )))),
        Rect { height: 1, ..inner },
    );
    let body = Rect {
        y: inner.y + 1,
        height: inner.height.saturating_sub(1),
        ..inner
    };
    let (shown, at) = visible(cursor, files.len(), usize::from(body.height));
    let lines: Vec<Line> = files
        .get(shown.clone())
        .unwrap_or_default()
        .iter()
        .map(|f| {
            let (a, b) = numbers(f);
            let (dir, name) = split_path(&f.path);
            Line::from(vec![
                Span::raw(" "),
                bold(format!("{:<32}", clip(name, 32))),
                plain(format!(" {a:>10} {b:>14}")),
                faint(format!("   {dir}")),
            ])
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), body);
    highlight(frame, body, body.y + at as u16);
    super::clickable_rows(app, body, shown, 1);
}
