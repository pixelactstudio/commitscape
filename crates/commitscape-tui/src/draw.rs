//! Drawing. A frame is a function of the state it is given: nothing here
//! computes a metric.

use commitscape_core::Index;
use commitscape_metrics::{Age, Options, Span};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Style, Stylize};
use ratatui::text::Line;
use ratatui::widgets::{Block, Cell, Paragraph, Row, Table, TableState, Tabs, Wrap};
use ratatui::Frame;

use crate::app::{headlines, Headline, Panel};
use crate::detail::{
    CommitLine, Detail, DirectoryDetail, FileDetail, ListedFile, Opened, PairDetail, Person,
};
use crate::findings::Findings;
use crate::format::{bytes, counted, date, days, grouped, percent, percentile};
use crate::list::Cursor;

/// Marks the selected row.
const SELECTED: &str = "› ";
const UNSELECTED: &str = "  ";

/// The widest a bar in a distribution grows.
const BAR: usize = 40;

/// What every part of a frame may need besides the findings.
pub(crate) struct Context<'a> {
    pub index: &'a Index,
    pub span: Span,
    pub anchor: i64,
    pub options: Options,
}

/// A Window's span in words: `the last 90 days`.
pub(crate) fn phrase(span: Span) -> &'static str {
    match span {
        Span::Month => "the last 30 days",
        Span::Quarter => "the last 90 days",
        Span::Year => "the last year",
        Span::All => "all of history",
    }
}

pub(crate) fn header(
    frame: &mut Frame,
    area: Rect,
    name: &str,
    cx: &Context<'_>,
    findings: Option<&Findings>,
) {
    let from = cx
        .span
        .window(cx.anchor)
        .from
        .or(cx.index.span.oldest)
        .map(date)
        .unwrap_or_default();
    let mut line = vec![
        " commitscape ".bold(),
        format!(
            " {name} · {}: {from} to {}",
            cx.span.label(),
            date(cx.anchor)
        )
        .into(),
    ];
    match findings {
        Some(f) if f.counts.in_window == 0 => line.push(" · no commits".into()),
        Some(f) => line.push(
            format!(
                " · {}; {} and {} not counted",
                counted(f.counts.in_window, "commit", "commits"),
                counted(f.counts.merges, "merge", "merges"),
                counted(f.counts.bulk, "bulk commit", "bulk commits"),
            )
            .into(),
        ),
        None => {}
    }
    frame.render_widget(Paragraph::new(Line::from(line)), area);
}

pub(crate) fn tabs(frame: &mut Frame, area: Rect, panel: Panel) {
    let titles = Panel::EVERY
        .iter()
        .enumerate()
        .map(|(i, p)| format!("{} {}", i + 1, p.title()));
    let tabs = Tabs::new(titles)
        .select(panel.position())
        .highlight_style(Style::new().reversed())
        .divider("│");
    frame.render_widget(tabs, area);
}

pub(crate) fn footer(frame: &mut Frame, area: Rect, span: Span, in_detail: bool) {
    let keys = if in_detail {
        " ↑↓ move  enter open  esc back  q quit"
    } else {
        " ↑↓ move  enter open  ←→ panel  q quit"
    };
    let mut windows = vec!["w window ".into()];
    for s in Span::EVERY {
        windows.push(if s == span {
            format!("[{}]", s.label()).bold()
        } else {
            format!(" {} ", s.label()).dim()
        });
    }
    let windows = Line::from(windows);
    let [left, right] = Layout::horizontal([
        Constraint::Fill(1),
        Constraint::Length(windows.width() as u16 + 1),
    ])
    .areas(area);
    frame.render_widget(Paragraph::new(keys.dim()), left);
    frame.render_widget(Paragraph::new(windows), right);
}

pub(crate) fn waiting(frame: &mut Frame, area: Rect, message: &str) {
    frame.render_widget(
        Paragraph::new(format!("\n  {message}"))
            .wrap(Wrap { trim: false })
            .block(Block::bordered()),
        area,
    );
}

pub(crate) fn panel(
    frame: &mut Frame,
    area: Rect,
    panel: Panel,
    f: &Findings,
    cx: &Context<'_>,
    cursor: &mut Cursor,
) {
    match panel {
        Panel::Overview => overview(frame, area, f, cx, cursor),
        Panel::Hotspots => hotspots(frame, area, f, cx, cursor),
        Panel::Coupling => coupling(frame, area, f, cx, cursor),
        Panel::Ownership => ownership(frame, area, f, cx, cursor),
        Panel::Staleness => staleness(frame, area, f, cursor),
        Panel::CodeAge => code_age(frame, area, f, cursor),
        Panel::People => people(frame, area, f, cx, cursor),
    }
}

fn overview(frame: &mut Frame, area: Rect, f: &Findings, cx: &Context<'_>, cursor: &mut Cursor) {
    let items = headlines(f);
    cursor.step(0, items.len());
    let selected = items.get(cursor.selected()).copied();
    let mark = |h: Headline| {
        if selected == Some(h) {
            SELECTED
        } else {
            UNSELECTED
        }
    };
    let mut lines: Vec<Line<'static>> = Vec::new();
    if f.counts.in_window == 0 {
        lines.push(heading(format!(
            "Nothing was committed in {}. Press w for a longer Window.",
            phrase(cx.span)
        )));
    } else {
        changes(&mut lines, &items, f, cx, &mark);
    }

    lines.push(Line::default());
    lines.push(heading("Staleness".to_string()));
    let older = f
        .staleness
        .buckets
        .iter()
        .find(|b| b.age == Age::Older)
        .map_or(0, |b| b.files);
    lines.push(Line::from(format!(
        "{}{} of the {} files people wrote untouched for a year or more",
        mark(Headline::Stale),
        grouped(u64::from(older)),
        grouped(u64::from(f.files())),
    )));

    if !f.duplicates.is_empty() {
        lines.push(Line::default());
        lines.push(heading("People".to_string()));
        lines.push(Line::from(format!(
            "{}{} may be one person each. Nothing was merged.",
            mark(Headline::People),
            counted(
                f.duplicates.len() as u64,
                "group of people",
                "groups of people"
            ),
        )));
    }
    frame.render_widget(
        Paragraph::new(lines).block(titled("Overview".to_string(), None)),
        area,
    );
}

/// The Overview's findings about the Window's changes: the directories one
/// person holds, the top Hotspot, and the first pair across directories.
fn changes(
    lines: &mut Vec<Line<'static>>,
    items: &[Headline],
    f: &Findings,
    cx: &Context<'_>,
    mark: &dyn Fn(Headline) -> &'static str,
) {
    let path = |file| cx.index.paths.path_lossy(file);
    let min = cx.options.ownership_min_commits;
    let own = &f.ownership;
    lines.push(if own.directory_count == 0 {
        heading(format!(
            "No directory had {min} or more commits in {}",
            phrase(cx.span)
        ))
    } else if own.bus_factor_one == 0 {
        heading(format!(
            "No directory is held by one person: each of the {} with {min} or more commits takes two or more",
            grouped(u64::from(own.directory_count)),
        ))
    } else {
        heading(format!(
            "One person holds {} of {} directories with {min} or more commits",
            grouped(u64::from(own.bus_factor_one)),
            grouped(u64::from(own.directory_count)),
        ))
    });
    for item in items {
        let Headline::Directory(i) = *item else {
            continue;
        };
        let Some(d) = own.directories.get(i) else {
            continue;
        };
        let owner = d.owners.first();
        let name = owner
            .and_then(|o| cx.index.authors.get(o.author))
            .map(|a| a.name.to_string())
            .unwrap_or_default();
        let share = owner.map_or(0.0, |o| f64::from(o.commits) / f64::from(d.commits.max(1)));
        lines.push(Line::from(format!(
            "{}{:<36} {:<22} {:>4} of {} commits",
            mark(*item),
            fit(&d.label(), 36),
            fit(&name, 22),
            percent(share),
            grouped(u64::from(d.commits)),
        )));
    }

    lines.push(Line::default());
    lines.push(heading("Top hotspot".to_string()));
    lines.push(Line::from(match f.hotspots.first() {
        Some(h) => format!(
            "{}{}   churn {} ({}) · complexity {} ({})",
            mark(Headline::Hotspot),
            path(h.file),
            grouped(u64::from(h.churn)),
            percentile(h.churn_percentile),
            grouped(u64::from(h.complexity)),
            percentile(h.complexity_percentile),
        ),
        None => format!(
            "{UNSELECTED}Nothing a person wrote changed in {}.",
            phrase(cx.span)
        ),
    }));

    lines.push(Line::default());
    lines.push(heading(
        "Files in different directories that change together".to_string(),
    ));
    let pair = f
        .coupling
        .pairs
        .iter()
        .enumerate()
        .find(|(_, p)| p.cross_directory);
    lines.push(Line::from(match pair {
        Some((i, p)) => format!(
            "{}{}  ↔  {}   together in {} of their commits",
            mark(Headline::Pair(i)),
            path(p.first),
            path(p.second),
            percent(p.jaccard),
        ),
        None => format!(
            "{UNSELECTED}None with {} or more commits each changed together.",
            f.coupling.support
        ),
    }));
}

fn hotspots(frame: &mut Frame, area: Rect, f: &Findings, cx: &Context<'_>, cursor: &mut Cursor) {
    let len = f.hotspots.len();
    let block = titled(
        "Hotspots: code both changed often and deeply nested".to_string(),
        position(cursor, len),
    );
    if len == 0 {
        return empty(
            frame,
            area,
            block,
            &format!("Nothing a person wrote changed in {}.", phrase(cx.span)),
        );
    }
    let header = Row::new(["  #", "Score", " Churn", "", "Complexity", "", "File"]);
    let widths = [
        Constraint::Length(4),
        Constraint::Length(5),
        Constraint::Length(6),
        Constraint::Length(4),
        Constraint::Length(10),
        Constraint::Length(4),
        Constraint::Fill(1),
    ];
    list(frame, area, block, header, &widths, len, cursor, |i| {
        let Some(h) = f.hotspots.get(i) else {
            return Row::default();
        };
        Row::new(vec![
            number(i as u64 + 1),
            Cell::from(Line::from(format!("{:.2}", h.score)).right_aligned()),
            number(u64::from(h.churn)),
            Cell::from(percentile(h.churn_percentile)),
            number(u64::from(h.complexity)),
            Cell::from(percentile(h.complexity_percentile)),
            Cell::from(cx.index.paths.path_lossy(h.file)),
        ])
    });
}

fn coupling(frame: &mut Frame, area: Rect, f: &Findings, cx: &Context<'_>, cursor: &mut Cursor) {
    let c = &f.coupling;
    let len = c.pairs.len();
    let block = titled(
        format!(
            "Change coupling: files with {} or more commits that change together",
            c.support
        ),
        position(cursor, len),
    );
    if len == 0 {
        return empty(
            frame,
            area,
            block,
            &format!(
                "No two files with {} or more commits in {} changed together.",
                c.support,
                phrase(cx.span)
            ),
        );
    }
    let header = Row::new(["  #", "Degree", "Together", "", "Files"]);
    let widths = [
        Constraint::Length(4),
        Constraint::Length(6),
        Constraint::Length(8),
        Constraint::Length(6),
        Constraint::Fill(1),
    ];
    list(frame, area, block, header, &widths, len, cursor, |i| {
        let Some(p) = c.pairs.get(i) else {
            return Row::default();
        };
        Row::new(vec![
            number(i as u64 + 1),
            Cell::from(Line::from(percent(p.jaccard)).right_aligned()),
            number(u64::from(p.both)),
            Cell::from(if p.cross_directory { "across" } else { "" }),
            Cell::from(format!(
                "{}  ↔  {}",
                cx.index.paths.path_lossy(p.first),
                cx.index.paths.path_lossy(p.second)
            )),
        ])
    });
}

fn ownership(frame: &mut Frame, area: Rect, f: &Findings, cx: &Context<'_>, cursor: &mut Cursor) {
    let own = &f.ownership;
    let len = own.directories.len();
    let block = titled(
        format!(
            "Ownership: directories with {} or more commits, fewest owners first",
            cx.options.ownership_min_commits
        ),
        position(cursor, len),
    );
    if len == 0 {
        return empty(
            frame,
            area,
            block,
            &format!(
                "No directory had {} or more commits in {}.",
                cx.options.ownership_min_commits,
                phrase(cx.span)
            ),
        );
    }
    let header = Row::new([
        "  #",
        "Bus factor",
        "Commits",
        "Top owner",
        "Share",
        "Directory",
    ]);
    let widths = [
        Constraint::Length(4),
        Constraint::Length(10),
        Constraint::Length(7),
        Constraint::Length(22),
        Constraint::Length(5),
        Constraint::Fill(1),
    ];
    list(frame, area, block, header, &widths, len, cursor, |i| {
        let Some(d) = own.directories.get(i) else {
            return Row::default();
        };
        let owner = d.owners.first();
        let name = owner
            .and_then(|o| cx.index.authors.get(o.author))
            .map(|a| a.name.to_string())
            .unwrap_or_default();
        let share = owner.map_or(0.0, |o| f64::from(o.commits) / f64::from(d.commits.max(1)));
        Row::new(vec![
            number(i as u64 + 1),
            number(u64::from(d.bus_factor)),
            number(u64::from(d.commits)),
            Cell::from(name),
            Cell::from(Line::from(percent(share)).right_aligned()),
            Cell::from(d.label()),
        ])
    });
}

fn staleness(frame: &mut Frame, area: Rect, f: &Findings, cursor: &mut Cursor) {
    let total = f.files();
    let buckets = &f.staleness.buckets;
    let block = titled(
        format!(
            "Staleness: when each of the {} files people wrote was last touched",
            grouped(u64::from(total))
        ),
        None,
    );
    let most = buckets.iter().map(|b| b.files).max().unwrap_or(0);
    let header = Row::new(["Last touched", "  Files", "Share", ""]);
    let widths = [
        Constraint::Length(16),
        Constraint::Length(7),
        Constraint::Length(5),
        Constraint::Fill(1),
    ];
    list(
        frame,
        area,
        block,
        header,
        &widths,
        buckets.len(),
        cursor,
        |i| {
            let Some(b) = buckets.get(i) else {
                return Row::default();
            };
            Row::new(vec![
                Cell::from(b.age.label()),
                number(u64::from(b.files)),
                Cell::from(
                    Line::from(percent(f64::from(b.files) / f64::from(total.max(1))))
                        .right_aligned(),
                ),
                Cell::from(bar(u64::from(b.files), u64::from(most))),
            ])
        },
    );
}

fn code_age(frame: &mut Frame, area: Rect, f: &Findings, cursor: &mut Cursor) {
    let quarters = &f.code_age;
    let block = titled(
        "Code age: lines at HEAD by the quarter their file first appeared".to_string(),
        position(cursor, quarters.len()),
    )
    .title_bottom(
        Line::from(" A file's lines all count toward the quarter it was created in ").dim(),
    );
    if quarters.is_empty() {
        return empty(frame, area, block, "There is no code at HEAD.");
    }
    let most = quarters.iter().map(|q| q.lines).max().unwrap_or(0);
    let header = Row::new(["Quarter", "   Lines", "Files", ""]);
    let widths = [
        Constraint::Length(8),
        Constraint::Length(8),
        Constraint::Length(5),
        Constraint::Fill(1),
    ];
    list(
        frame,
        area,
        block,
        header,
        &widths,
        quarters.len(),
        cursor,
        |i| {
            let Some(q) = quarters.get(i) else {
                return Row::default();
            };
            Row::new(vec![
                Cell::from(format!("{}-Q{}", q.year, q.quarter)),
                number(q.lines),
                number(u64::from(q.files)),
                Cell::from(bar(q.lines, most)),
            ])
        },
    );
}

fn people(frame: &mut Frame, area: Rect, f: &Findings, cx: &Context<'_>, cursor: &mut Cursor) {
    let groups = &f.duplicates;
    let block = titled(
        "People who may be one person".to_string(),
        position(cursor, groups.len()),
    )
    .title_bottom(
        Line::from(" Nothing was merged. Open a group for the .mailmap lines that would join it ")
            .dim(),
    );
    if groups.is_empty() {
        return empty(
            frame,
            area,
            block,
            "No two people share a name or an email name: every identity resolved cleanly.",
        );
    }
    let header = Row::new(["  #", "Commits", "People"]);
    let widths = [
        Constraint::Length(4),
        Constraint::Length(12),
        Constraint::Fill(1),
    ];
    list(
        frame,
        area,
        block,
        header,
        &widths,
        groups.len(),
        cursor,
        |i| {
            let Some(g) = groups.get(i) else {
                return Row::default();
            };
            let commits: Vec<String> = g.commits.iter().map(|c| grouped(u64::from(*c))).collect();
            let people: Vec<String> = g
                .people
                .iter()
                .filter_map(|p| cx.index.authors.get(*p))
                .map(|a| format!("{} <{}>", a.name, a.email))
                .collect();
            Row::new(vec![
                number(i as u64 + 1),
                Cell::from(commits.join(" · ")),
                Cell::from(people.join(" · ")),
            ])
        },
    );
}

pub(crate) fn detail(frame: &mut Frame, area: Rect, opened: &mut Opened, cx: &Context<'_>) {
    match &opened.detail {
        Detail::File(d) => document(frame, area, &d.path, file_lines(d, cx), &mut opened.scroll),
        Detail::Pair(d) => document(
            frame,
            area,
            "Change coupling",
            pair_lines(d, cx),
            &mut opened.scroll,
        ),
        Detail::Directory(d) => document(
            frame,
            area,
            &d.ownership.label(),
            directory_lines(d, cx),
            &mut opened.scroll,
        ),
        Detail::Group { people, mailmap } => document(
            frame,
            area,
            "People who may be one person",
            group_lines(people, mailmap),
            &mut opened.scroll,
        ),
        Detail::Bucket { age, files } => files_list(
            frame,
            area,
            format!("Files people wrote, last touched {} ago", age.label()),
            ["    Days", "Last touched", "File"],
            files,
            &mut opened.cursor,
            |f| (grouped(f.number.max(0) as u64), date(f.other)),
        ),
        Detail::Quarter { quarter, files } => files_list(
            frame,
            area,
            format!(
                "Code from {}-Q{}: {} in {}",
                quarter.year,
                quarter.quarter,
                counted(quarter.lines, "line", "lines"),
                counted(u64::from(quarter.files), "file", "files")
            ),
            ["   Lines", "Complexity", "File"],
            files,
            &mut opened.cursor,
            |f| {
                (
                    grouped(f.number.max(0) as u64),
                    grouped(f.other.max(0) as u64),
                )
            },
        ),
    }
}

fn file_lines<'a>(d: &FileDetail, cx: &Context<'_>) -> Vec<Line<'a>> {
    let mut lines = Vec::new();
    if let Some(h) = d.head {
        let class = match h.class {
            commitscape_core::FileClass::Source => "Code",
            commitscape_core::FileClass::Prose => "Prose",
            commitscape_core::FileClass::Generated => "Generated",
            commitscape_core::FileClass::Vendored => "Vendored",
            commitscape_core::FileClass::Binary => "Binary",
            commitscape_core::FileClass::Symlink => "Symbolic link",
        };
        lines.push(Line::from(format!(
            "{class} · {} · {}",
            counted(u64::from(h.loc), "line", "lines"),
            bytes(h.bytes)
        )));
        if h.class.is_code() {
            lines.push(Line::from(format!(
                "Complexity Proxy {}: {:.1} indentation levels per line on average, spread {:.1}",
                grouped(u64::from(h.indent_levels)),
                h.indent_mean,
                h.indent_stddev
            )));
        }
    }
    lines.push(Line::from(format!(
        "Churn {} in {}",
        counted(u64::from(d.churn), "commit", "commits"),
        phrase(cx.span)
    )));
    if let Some(h) = d.hotspot {
        lines.push(Line::from(format!(
            "Hotspot score {:.2}: churn {} × complexity {}",
            h.score,
            percentile(h.churn_percentile),
            percentile(h.complexity_percentile)
        )));
    }
    if let Some(h) = d.history {
        lines.push(Line::from(format!(
            "First seen {} · last touched {} ({} ago)",
            date(h.first_seen),
            date(h.last_touched),
            days((cx.anchor - h.last_touched) / 86_400)
        )));
    }
    for former in &d.former {
        lines.push(Line::from(format!("Formerly {former}")));
    }

    lines.push(Line::default());
    lines.push(heading(format!("Who changed it in {}", phrase(cx.span))));
    if d.owners.is_empty() {
        lines.push(Line::from("  Nobody, outside merges and bulk commits."));
    }
    let total: u32 = d.owners.iter().map(|o| o.commits).sum();
    for p in &d.owners {
        lines.push(person_line(p, total));
    }

    if !d.coupled.is_empty() {
        lines.push(Line::default());
        lines.push(heading("Changes with".to_string()));
        for (other, pair) in &d.coupled {
            lines.push(Line::from(format!(
                "  {other}   together in {} of their commits ({})",
                percent(pair.jaccard),
                counted(u64::from(pair.both), "commit", "commits")
            )));
        }
    }

    lines.push(Line::default());
    lines.push(heading(format!(
        "Its commits in {}, newest first",
        phrase(cx.span)
    )));
    lines.extend(commit_lines(&d.commits, d.more));
    lines
}

fn pair_lines<'a>(d: &PairDetail, cx: &Context<'_>) -> Vec<Line<'a>> {
    let p = d.pair;
    let either = p.first_commits + p.second_commits - p.both;
    let mut lines = vec![
        Line::from(format!("  {}", d.first)),
        Line::from(format!("  {}", d.second)),
        Line::from(if p.cross_directory {
            "  in different directories"
        } else {
            "  in the same directory"
        }),
        Line::default(),
        Line::from(format!(
            "Changed together in {} of the {} that changed either: a degree of {}.",
            grouped(u64::from(p.both)),
            counted(u64::from(either), "commit", "commits"),
            percent(p.jaccard)
        )),
        Line::from(format!(
            "When {} changed, {} changed too: {}.",
            d.second,
            d.first,
            times(p.both, p.second_commits)
        )),
        Line::from(format!(
            "When {} changed, {} changed too: {}.",
            d.first,
            d.second,
            times(p.both, p.first_commits)
        )),
        Line::default(),
        heading(format!(
            "Commits in {} that changed both, newest first",
            phrase(cx.span)
        )),
    ];
    lines.extend(commit_lines(&d.commits, d.more));
    lines
}

fn directory_lines<'a>(d: &DirectoryDetail, cx: &Context<'_>) -> Vec<Line<'a>> {
    let o = &d.ownership;
    let mut lines = vec![
        Line::from(format!(
            "{} in {} touched files people wrote here.",
            counted(u64::from(o.commits), "commit", "commits"),
            phrase(cx.span)
        )),
        Line::from(format!(
            "Bus factor {}: the fewest people who together made more than 80% of them.",
            o.bus_factor
        )),
        Line::default(),
        Line::from(format!(
            "  {:<22} {:<30} {:>7} {:>5} {:>7}",
            "Person", "Email", "Commits", "Share", "Running"
        ))
        .bold(),
    ];
    let mut running = 0u32;
    for (i, p) in d.owners.iter().enumerate() {
        running += p.commits;
        let share = |n: u32| f64::from(n) / f64::from(o.commits.max(1));
        let line = format!(
            "  {:<22} {:<30} {:>7} {:>5} {:>7}",
            fit(&p.name, 22),
            fit(&p.email, 30),
            grouped(u64::from(p.commits)),
            percent(share(p.commits)),
            percent(share(running)),
        );
        lines.push(if i + 1 == o.bus_factor as usize {
            Line::from(format!("{line}   past 80%"))
        } else {
            Line::from(line)
        });
    }
    lines
}

fn group_lines<'a>(people: &[Person], mailmap: &str) -> Vec<Line<'a>> {
    let mut lines = vec![
        Line::from("They share a name or an email name, so they may be one person:"),
        Line::default(),
    ];
    for p in people {
        lines.push(Line::from(format!(
            "  {:<22} {:<34} {:>12}",
            fit(&p.name, 22),
            fit(&p.email, 34),
            counted(u64::from(p.commits), "commit", "commits")
        )));
    }
    lines.push(Line::default());
    lines.push(Line::from(
        "Nothing was merged: joining two real people would make Bus Factor confidently wrong.",
    ));
    lines.push(Line::from(
        "If they are one person, add these lines to .mailmap at the repository root:",
    ));
    lines.push(Line::default());
    for line in mailmap.lines() {
        lines.push(Line::from(format!("  {line}")).bold());
    }
    lines.push(Line::default());
    lines.push(Line::from(
        "commitscape, git log and git shortlog will then count them as one.",
    ));
    lines
}

fn person_line<'a>(p: &Person, total: u32) -> Line<'a> {
    Line::from(format!(
        "  {:<22} {:<30} {:>7} {:>5}",
        fit(&p.name, 22),
        fit(&p.email, 30),
        grouped(u64::from(p.commits)),
        percent(f64::from(p.commits) / f64::from(total.max(1)))
    ))
}

fn commit_lines<'a>(commits: &[CommitLine], more: usize) -> Vec<Line<'a>> {
    let mut lines: Vec<Line> = commits
        .iter()
        .map(|c| Line::from(format!("  {}  {}  {}", date(c.time), c.id, c.author)))
        .collect();
    if commits.is_empty() {
        lines.push(Line::from("  None, outside merges and bulk commits."));
    }
    if more > 0 {
        lines.push(Line::from(format!("  and {} more", grouped(more as u64))).dim());
    }
    lines
}

/// A detail that is text, scrolled by whole lines.
fn document(frame: &mut Frame, area: Rect, title: &str, lines: Vec<Line<'_>>, scroll: &mut usize) {
    let height = usize::from(area.height.saturating_sub(2));
    *scroll = (*scroll).min(lines.len().saturating_sub(height));
    let more = if lines.len() > height {
        Some(format!(
            "lines {}–{} of {}",
            *scroll + 1,
            (*scroll + height).min(lines.len()),
            lines.len()
        ))
    } else {
        None
    };
    frame.render_widget(
        Paragraph::new(lines)
            .block(titled(title.to_string(), more))
            .scroll((u16::try_from(*scroll).unwrap_or(u16::MAX), 0)),
        area,
    );
}

#[allow(clippy::too_many_arguments)]
fn files_list(
    frame: &mut Frame,
    area: Rect,
    title: String,
    columns: [&str; 3],
    files: &[ListedFile],
    cursor: &mut Cursor,
    numbers: impl Fn(&ListedFile) -> (String, String),
) {
    let block = titled(title, position(cursor, files.len()));
    if files.is_empty() {
        return empty(frame, area, block, "No files.");
    }
    let widths = [
        Constraint::Length(8),
        Constraint::Length(12),
        Constraint::Fill(1),
    ];
    list(
        frame,
        area,
        block,
        Row::new(columns),
        &widths,
        files.len(),
        cursor,
        |i| {
            let Some(f) = files.get(i) else {
                return Row::default();
            };
            let (a, b) = numbers(f);
            Row::new(vec![
                Cell::from(Line::from(a).right_aligned()),
                Cell::from(Line::from(b).right_aligned()),
                Cell::from(f.path.clone()),
            ])
        },
    );
}

/// A table of `len` rows. Only the rows in view are built, so a list of
/// thousands costs what a screenful does.
#[allow(clippy::too_many_arguments)]
fn list(
    frame: &mut Frame,
    area: Rect,
    block: Block<'_>,
    header: Row<'_>,
    widths: &[Constraint],
    len: usize,
    cursor: &mut Cursor,
    row: impl Fn(usize) -> Row<'static>,
) {
    let height = usize::from(area.height.saturating_sub(3));
    let shown = cursor.visible(len, height);
    let selected = cursor.selected().saturating_sub(shown.start);
    let rows: Vec<Row> = shown.map(row).collect();
    let table = Table::new(rows, widths.to_vec())
        .header(header.bold())
        .block(block)
        .column_spacing(2)
        .row_highlight_style(Style::new().reversed())
        .highlight_symbol(SELECTED);
    let mut state = TableState::default().with_selected(Some(selected));
    frame.render_stateful_widget(table, area, &mut state);
}

fn empty(frame: &mut Frame, area: Rect, block: Block<'_>, message: &str) {
    frame.render_widget(
        Paragraph::new(format!("\n  {message}"))
            .wrap(Wrap { trim: false })
            .block(block),
        area,
    );
}

fn titled<'a>(title: String, position: Option<String>) -> Block<'a> {
    let block = Block::bordered().title(format!(" {title} ").bold());
    match position {
        Some(p) => block.title_top(Line::from(format!(" {p} ")).right_aligned()),
        None => block,
    }
}

fn position(cursor: &Cursor, len: usize) -> Option<String> {
    (len > 0).then(|| {
        format!(
            "{} of {}",
            grouped((cursor.selected().min(len - 1) + 1) as u64),
            grouped(len as u64)
        )
    })
}

fn heading<'a>(text: String) -> Line<'a> {
    Line::from(text).bold()
}

fn number(n: u64) -> Cell<'static> {
    Cell::from(Line::from(grouped(n)).right_aligned())
}

/// `6 of 7 times (86%)`.
fn times(part: u32, whole: u32) -> String {
    format!(
        "{} of {} times ({})",
        grouped(u64::from(part)),
        grouped(u64::from(whole)),
        percent(f64::from(part) / f64::from(whole.max(1)))
    )
}

fn bar(n: u64, most: u64) -> String {
    if most == 0 || n == 0 {
        return String::new();
    }
    let width = ((n as f64 / most as f64) * BAR as f64).round().max(1.0) as usize;
    "█".repeat(width)
}

/// `s` in at most `width` characters, cut from the front: the end of a path
/// or name says more than its start.
fn fit(s: &str, width: usize) -> String {
    let n = s.chars().count();
    if n <= width {
        return s.to_string();
    }
    let keep: String = s.chars().skip(n + 1 - width).collect();
    format!("…{keep}")
}
