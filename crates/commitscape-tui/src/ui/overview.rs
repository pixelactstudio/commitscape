//! The Overview: the repository at a glance, then what is worth a look.

use commitscape_core::CommitKind;
use commitscape_metrics::Span as Window;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts::{self, blend};
use super::{bold, boxed, dot, faint, highlight, plain, short_phrase, split_path, tile};
use crate::app::{headlines, App, GitHubState, Headline};
use crate::findings::Findings;
use crate::format::{compact, grouped, hour, long_date, share, short_date, span_of_days};
use crate::list::Cursor;
use crate::theme::{self, ACCENT, CRITICAL, HEAT, MUTED, SERIES, WARNING};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let big = charts::big_text(&app.name).filter(|rows| {
        rows[0].chars().count() + 34 <= usize::from(area.width) && area.height >= 30
    });
    let hero_height = if big.is_some() { 5 } else { 2 };
    let bottom_height = if area.height >= 34 { 8 } else { 7 };
    let [hero, tiles, languages, middle, bottom] = Layout::vertical([
        Constraint::Length(hero_height),
        Constraint::Length(5),
        Constraint::Length(3),
        Constraint::Min(6),
        Constraint::Length(bottom_height),
    ])
    .areas(area);

    draw_hero(app, f, frame, hero, big);
    draw_tiles(app, f, frame, tiles);
    draw_languages(f, frame, languages);

    let [activity, people] =
        Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(middle);
    draw_activity(app, f, frame, activity);
    draw_people(app, f, frame, people);

    let [facts_area, worth_area] =
        Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).areas(bottom);
    draw_facts(app, f, frame, facts_area, 1);
    draw_worth(app, f, frame, worth_area, cursor);
}

/// "Did you know?": the facts, in `columns` side by side, whole facts
/// only, each wrapped under its own bullet.
pub(super) fn draw_facts(app: &App, f: &Findings, frame: &mut Frame, area: Rect, columns: u16) {
    let inner = boxed(frame, area, "Did you know?", None);
    let areas = Layout::horizontal(vec![Constraint::Fill(1); usize::from(columns.max(1))])
        .spacing(2)
        .split(inner);
    let mut facts = facts(app, f).into_iter();
    for column in areas.iter() {
        let mut lines: Vec<Line> = Vec::new();
        for fact in facts.by_ref() {
            let mut spans = vec![Span::styled("▸ ", Style::new().fg(ACCENT))];
            spans.extend(fact.spans);
            let wrapped = super::wrap_spans(spans, usize::from(column.width), 2);
            if lines.len() + wrapped.len() > usize::from(column.height) {
                break;
            }
            lines.extend(wrapped);
        }
        frame.render_widget(Paragraph::new(lines), *column);
    }
}

pub(super) fn draw_hero(
    app: &App,
    f: &Findings,
    frame: &mut Frame,
    area: Rect,
    big: Option<[String; 3]>,
) {
    let description = match &app.github {
        GitHubState::Ready(g) => g.description.clone(),
        _ => None,
    };
    let language = f.languages.languages.first().map(|l| l.name);
    let age = f
        .totals
        .first_commit
        .map(|first| span_of_days((app.anchor - first) / 86_400));
    let subtitle = description.unwrap_or_else(|| match (language, &age) {
        (Some(l), Some(a)) => format!("A {l} repository, {a} old."),
        (None, Some(a)) => format!("A repository {a} old."),
        _ => String::new(),
    });

    let badges = badges(app);
    let [name_area, badge_area] =
        Layout::horizontal([Constraint::Fill(1), Constraint::Length(32)]).areas(area);
    match big {
        Some(rows) => {
            let width = rows[0].chars().count().max(2);
            let buf = frame.buffer_mut();
            for (r, row) in rows.iter().enumerate() {
                for (c, ch) in row.chars().enumerate() {
                    if ch == ' ' {
                        continue;
                    }
                    let t = c as f64 / (width - 1) as f64;
                    let colour = if t < 0.5 {
                        blend(ACCENT, SERIES[6], t * 2.0)
                    } else {
                        blend(SERIES[6], SERIES[4], (t - 0.5) * 2.0)
                    };
                    let (x, y) = (name_area.x + 1 + c as u16, name_area.y + r as u16);
                    if x < name_area.x + name_area.width {
                        if let Some(cell) = buf.cell_mut((x, y)) {
                            cell.set_char(ch).set_fg(colour);
                        }
                    }
                }
            }
            let line = Line::from(vec![Span::raw(" "), plain(subtitle)]);
            frame.render_widget(
                Paragraph::new(line),
                Rect {
                    y: name_area.y + 3,
                    height: 1,
                    ..name_area
                },
            );
        }
        None => {
            let lines = vec![
                Line::from(vec![Span::raw(" "), bold(app.name.clone())]),
                Line::from(vec![Span::raw(" "), plain(subtitle)]),
            ];
            frame.render_widget(Paragraph::new(lines), name_area);
        }
    }
    frame.render_widget(Paragraph::new(badges), badge_area);
}

fn badges(app: &App) -> Vec<Line<'static>> {
    match &app.github {
        GitHubState::Ready(g) if g.private || g.stars == 0 => vec![
            Line::from(faint(if g.private {
                "private on GitHub"
            } else {
                "on GitHub"
            })),
            Line::from(vec![
                bold(grouped(g.open_prs)),
                faint(if g.open_prs == 1 {
                    " open pull request"
                } else {
                    " open pull requests"
                }),
            ]),
            Line::from(vec![
                bold(grouped(g.open_issues)),
                faint(if g.open_issues == 1 {
                    " open issue"
                } else {
                    " open issues"
                }),
            ]),
        ],
        GitHubState::Ready(g) => {
            let mut lines = vec![
                Line::from(vec![
                    Span::styled("★ ", Style::new().fg(theme::TEXT_2)),
                    bold(grouped(g.stars)),
                    faint(" stars"),
                ]),
                Line::from(vec![
                    bold(grouped(g.forks)),
                    faint(" forks   "),
                    bold(grouped(g.watchers)),
                    faint(" watching"),
                ]),
            ];
            let mut third = Vec::new();
            if let Some(license) = &g.license {
                third.push(bold(license.clone()));
                third.push(faint("   "));
            }
            if g.releases > 0 {
                third.push(bold(grouped(g.releases)));
                third.push(faint(if g.releases == 1 {
                    " release"
                } else {
                    " releases"
                }));
            }
            lines.push(Line::from(third));
            lines
        }
        GitHubState::Asking => vec![Line::from(faint("asking GitHub…"))],
        GitHubState::Unavailable(_) => Vec::new(),
    }
}

pub(super) fn draw_tiles(app: &App, f: &Findings, frame: &mut Frame, area: Rect) {
    let span = short_phrase(app.span);
    let t = &f.totals;
    let areas = Layout::horizontal([Constraint::Ratio(1, 6); 6]).split(area);
    let age = t
        .first_commit
        .map(|first| short_age((app.anchor - first) / 86_400))
        .unwrap_or_default();
    // Over all of history the notes say what the counts do not: how many
    // a week, how few people made most of it, and how many days there have
    // been.
    let all = t.first_commit.filter(|_| app.span == Window::All);
    let (commits_note, people_note, days_note) = match all {
        Some(first) => {
            let days = (app.anchor - first).div_euclid(86_400) + 1;
            (
                format!("{} a week", pace(t.commits as f64 * 7.0 / days as f64)),
                format!("{} made 80%", grouped(most_of_it(&f.contributors) as u64)),
                format!("of {}", super::many(days as u64, "day", "days")),
            )
        }
        None => (
            format!("{} in {span}", grouped(f.counts.in_window)),
            format!("{} in {span}", grouped(f.contributors.len() as u64)),
            format!("in {span}"),
        ),
    };
    let tiles = [
        (grouped(t.commits), "commits".to_string(), commits_note),
        (grouped(t.people as u64), "people".to_string(), people_note),
        (
            grouped(u64::from(t.files)),
            "files".to_string(),
            format!("{} are code", grouped(u64::from(t.code_files))),
        ),
        (
            compact(t.code_lines),
            "lines of code".to_string(),
            format!("{} of prose", compact(t.prose_lines)),
        ),
        (
            age,
            "old".to_string(),
            t.first_commit
                .map(|first| format!("since {}", short_date(first)))
                .unwrap_or_default(),
        ),
        (
            grouped(u64::from(f.pulse.active_days)),
            "active days".to_string(),
            days_note,
        ),
    ];
    for (area, (value, label, note)) in areas.iter().zip(tiles) {
        tile(frame, *area, &value, &label, &note);
    }
}

/// The fewest people who together made more than 80% of the commits: the
/// Bus Factor of the whole repository.
fn most_of_it(people: &[commitscape_metrics::Contributor]) -> usize {
    let total: u64 = people.iter().map(|c| u64::from(c.commits)).sum();
    let mut made = 0u64;
    for (n, c) in people.iter().enumerate() {
        made += u64::from(c.commits);
        if made * 5 > total * 4 {
            return n + 1;
        }
    }
    people.len()
}

/// A rate in a few characters: `0.6`, `12`, `1,204`.
fn pace(rate: f64) -> String {
    if rate < 10.0 {
        let one = format!("{rate:.1}");
        one.trim_end_matches(".0").to_string()
    } else {
        grouped(rate.round() as u64)
    }
}

/// An age in a few characters: `12 days`, `8 months`, `2.4 years`.
fn short_age(days: i64) -> String {
    match days {
        ..=44 => format!("{} days", days.max(0)),
        45..=364 => format!("{} months", days / 30),
        _ => {
            let years = format!("{:.1}", days as f64 / 365.25);
            let years = years.trim_end_matches(".0");
            format!("{years} {}", if years == "1" { "year" } else { "years" })
        }
    }
}

/// Languages take the categorical colours by their rank at HEAD; the tail
/// shares grey.
pub(super) fn language_colours(f: &Findings) -> Vec<(&'static str, u64, Color)> {
    let shown = 7;
    let mut parts: Vec<(&'static str, u64, Color)> = f
        .languages
        .languages
        .iter()
        .take(shown)
        .zip(SERIES)
        .map(|(l, colour)| (l.name, l.lines, colour))
        .collect();
    let rest: u64 = f
        .languages
        .languages
        .iter()
        .skip(shown)
        .map(|l| l.lines)
        .sum();
    if rest > 0 {
        parts.push(("other", rest, MUTED));
    }
    parts
}

pub(super) fn draw_languages(f: &Findings, frame: &mut Frame, area: Rect) {
    let parts = language_colours(f);
    let total: u64 = parts.iter().map(|p| p.1).sum();
    let inner = Rect {
        x: area.x + 1,
        width: area.width.saturating_sub(2),
        ..area
    };
    if total == 0 {
        frame.render_widget(
            Paragraph::new(faint("No code at HEAD in a language this tool knows.")),
            inner,
        );
        return;
    }
    let bar = charts::stacked(
        &parts.iter().map(|p| (p.1, p.2)).collect::<Vec<_>>(),
        inner.width,
    );
    let mut legend = Vec::new();
    for (name, lines, colour) in &parts {
        let pct = *lines * 100 / total;
        if pct == 0 && *name != "other" {
            continue;
        }
        legend.push(dot(*colour));
        legend.push(plain(name.to_string()));
        legend.push(faint(format!(" {}   ", share(*lines, total))));
    }
    frame.render_widget(
        Paragraph::new(vec![bar, Line::from(legend)]),
        Rect { height: 2, ..inner },
    );
}

pub(super) fn draw_activity(app: &App, f: &Findings, frame: &mut Frame, area: Rect) {
    let p = &f.pulse;
    let inner = boxed(
        frame,
        area,
        "Commits over time",
        Some(format!(
            "{} in {}",
            grouped(u64::from(p.commits)),
            short_phrase(app.span)
        )),
    );
    if p.commits == 0 {
        super::empty(frame, inner, "No commits in this window.");
        return;
    }
    let (values, per) = charts::bucket(&p.days, usize::from(inner.width));
    let most = values.iter().copied().max().unwrap_or(0);
    let chart = Rect {
        y: inner.y + 1,
        height: inner.height.saturating_sub(1),
        ..inner
    };
    frame.render_widget(
        Paragraph::new(super::activity::caption(per, most)),
        Rect { height: 1, ..inner },
    );
    charts::columns(
        frame.buffer_mut(),
        chart,
        &values,
        ACCENT,
        charts::month_labels(p.first_day, per),
    );
}

pub(super) fn draw_people(app: &App, f: &Findings, frame: &mut Frame, area: Rect) {
    let inner = boxed(
        frame,
        area,
        "Who writes the code",
        Some(short_phrase(app.span).to_string()),
    );
    let total: u64 = f.contributors.iter().map(|c| u64::from(c.commits)).sum();
    if total == 0 {
        super::empty(frame, inner, "Nobody committed in this window.");
        return;
    }
    let most = f.contributors.first().map_or(0, |c| u64::from(c.commits));
    let shown = f
        .contributors
        .get(..f.contributors.len().min(usize::from(inner.height)))
        .unwrap_or_default();
    // Names as wide as the longest, leaving the bars at least six columns.
    let name_width = shown
        .iter()
        .map(|c| app.display_name(c.author).chars().count())
        .max()
        .unwrap_or(0)
        .min(usize::from(inner.width.saturating_sub(22)))
        .max(8);
    let bar_width = inner.width.saturating_sub(name_width as u16 + 16).max(4);
    let lines: Vec<Line> = shown
        .iter()
        .map(|c| {
            let name = app.display_name(c.author);
            let colour = app.colour_of(c.author);
            Line::from(vec![
                dot(colour),
                plain(format!(
                    "{:<width$}",
                    super::clip(&name, name_width),
                    width = name_width
                )),
                Span::raw(" "),
                Span::styled(
                    format!(
                        "{:<width$}",
                        charts::bar(u64::from(c.commits), most, bar_width),
                        width = usize::from(bar_width)
                    ),
                    Style::new().fg(colour),
                ),
                bold(format!(" {:>6}", grouped(u64::from(c.commits)))),
                faint(format!(" {:>4}", share(u64::from(c.commits), total))),
            ])
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), inner);
}

/// Things the Window's commits say that are fun to know, most striking
/// first.
fn facts(app: &App, f: &Findings) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let p = &f.pulse;
    let total = u64::from(p.commits);
    let name = |path: String| split_path(&path).1.to_string();
    if total > 0 {
        let night = u64::from(p.night());
        let weekend = u64::from(p.weekend());
        if night * 4 >= total {
            out.push(Line::from(vec![
                plain("Night owls: "),
                bold(share(night, total)),
                plain(" of commits land between 22:00 and 05:00."),
            ]));
        } else if let Some(h) = p.busiest_hour() {
            out.push(Line::from(vec![
                plain("Most commits land around "),
                bold(hour(h)),
                plain(", local time."),
            ]));
        }
        if weekend * 5 >= total {
            out.push(Line::from(vec![
                plain("Weekend warriors: "),
                bold(share(weekend, total)),
                plain(" of commits land on a weekend."),
            ]));
        }
        if let Some((day, n)) = p.busiest_day.filter(|&(_, n)| n >= 2) {
            out.push(Line::from(vec![
                plain("The busiest day was "),
                bold(long_date(day * 86_400)),
                plain(", with "),
                bold(grouped(u64::from(n))),
                plain(if n == 1 { " commit." } else { " commits." }),
            ]));
        }
        if let Some(s) = p.longest_streak.filter(|s| s.days >= 3) {
            out.push(Line::from(vec![
                plain("Longest streak: "),
                bold(format!("{} days", s.days)),
                plain(" in a row, from "),
                bold(short_date(s.first_day * 86_400)),
                plain("."),
            ]));
        }
        let other = p
            .kinds
            .iter()
            .find(|k| k.kind == CommitKind::Other)
            .map_or(0, |k| u64::from(k.commits));
        if (total - other) * 10 >= total * 3 {
            let of = |kind: CommitKind| {
                p.kinds
                    .iter()
                    .find(|k| k.kind == kind)
                    .map_or(0, |k| u64::from(k.commits))
            };
            out.push(Line::from(vec![
                bold(share(of(CommitKind::Feature), total)),
                plain(" of commits are features and "),
                bold(share(of(CommitKind::Fix), total)),
                plain(" are fixes."),
            ]));
        }
    }
    if let Some(c) = f.churn.first() {
        out.push(Line::from(vec![
            bold(name(app.index.paths.path_lossy(c.file))),
            plain(" changed in "),
            bold(grouped(u64::from(c.commits))),
            plain(" commits, more than any other file."),
        ]));
    }
    if let Some(l) = f.largest.first() {
        out.push(Line::from(vec![
            plain("The biggest file is "),
            bold(name(app.index.paths.path_lossy(l.file))),
            plain(", with "),
            bold(grouped(u64::from(l.loc))),
            plain(" lines."),
        ]));
    }
    if let Some(s) = f.staleness.files.first().filter(|s| s.days >= 180) {
        out.push(Line::from(vec![
            bold(name(app.index.paths.path_lossy(s.file))),
            plain(" has not been touched in "),
            bold(span_of_days(s.days)),
            plain("."),
        ]));
    }
    out
}

fn draw_worth(app: &App, f: &Findings, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let items = headlines(f);
    cursor.step(0, items.len());
    let inner = boxed(
        frame,
        area,
        "Worth a look",
        Some("enter to open".to_string()),
    );
    let path = |file| app.index.paths.path_lossy(file);
    let mut lines = Vec::new();
    for item in &items {
        let (mark, colour, text): (&str, Color, Vec<Span>) = match *item {
            Headline::Directory(i) => {
                let Some(d) = f.ownership.directories.get(i) else {
                    continue;
                };
                let owner = d.owners.first();
                let who = owner
                    .map(|o| app.display_name(o.author))
                    .unwrap_or_default();
                let pct = owner.map_or(0, |o| u64::from(o.commits));
                (
                    "▲",
                    CRITICAL,
                    vec![
                        bold(super::folder(&d.label()).to_string()),
                        plain(": "),
                        bold(share(pct, u64::from(d.commits))),
                        plain(" of commits by "),
                        bold(who),
                    ],
                )
            }
            Headline::Hotspot => {
                let Some(h) = f.hotspots.first() else {
                    continue;
                };
                let full = path(h.file);
                (
                    "◆",
                    HEAT[2],
                    vec![
                        plain("Hottest file: "),
                        bold(split_path(&full).1.to_string()),
                        faint(format!(", changed {} times", grouped(u64::from(h.churn)))),
                    ],
                )
            }
            Headline::Pair(i) => {
                let Some(p) = f.coupling.pairs.get(i) else {
                    continue;
                };
                let (a, b) = super::names_apart(&path(p.first), &path(p.second));
                (
                    "⇄",
                    WARNING,
                    vec![
                        bold(a),
                        plain(" and "),
                        bold(b),
                        plain(" change together"),
                        faint(format!(" ({})", crate::format::percent(p.jaccard))),
                    ],
                )
            }
            Headline::Stale => {
                let older = f
                    .staleness
                    .buckets
                    .iter()
                    .find(|b| b.age == commitscape_metrics::Age::Older)
                    .map_or(0, |b| b.files);
                (
                    "○",
                    MUTED,
                    vec![
                        bold(grouped(u64::from(older))),
                        plain(format!(
                            " of {} files untouched for a year",
                            grouped(u64::from(f.files()))
                        )),
                    ],
                )
            }
            Headline::People => (
                "●",
                SERIES[4],
                vec![
                    bold(grouped(f.duplicates.len() as u64)),
                    plain(if f.duplicates.len() == 1 {
                        " pair of names may be one person"
                    } else {
                        " groups of names may be one person each"
                    }),
                ],
            ),
        };
        let mut spans = vec![
            Span::raw(" "),
            Span::styled(format!("{mark} "), Style::new().fg(colour)),
        ];
        spans.extend(text);
        lines.push(super::fit_line(Line::from(spans), usize::from(inner.width)));
    }
    let height = usize::from(inner.height);
    let (shown, at) = super::visible(cursor, lines.len(), height);
    let first = shown.start;
    let visible: Vec<Line> = lines.into_iter().skip(first).take(height).collect();
    let count = visible.len();
    frame.render_widget(Paragraph::new(visible), inner);
    if count > 0 {
        highlight(frame, inner, inner.y + at as u16);
        super::clickable_rows(app, inner, shown, 1);
    }
}
