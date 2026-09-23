//! GitHub: what GitHub says about the repository, asked through `gh`.

use commitscape_forge::GitHub;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, clip, faint, plain, tile};
use crate::app::{App, GitHubState};
use crate::format::{ago, grouped, share, short_date, span_of_days};
use crate::theme::{self, ACCENT};

const DAY: i64 = 86_400;

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect) {
    match &app.github {
        GitHubState::Asking => message(
            frame,
            area,
            vec![
                Line::from(bold("Asking GitHub…")),
                Line::from(faint(
                    "One query through the gh CLI; the rest of the app does not wait for it.",
                )),
            ],
        ),
        GitHubState::Unavailable(why) => message(
            frame,
            area,
            vec![
                Line::from(vec![
                    plain("GitHub's numbers are not here: "),
                    bold(why.clone()),
                ]),
                Line::default(),
                Line::from(plain(
                    "They come from the GitHub CLI. Install it from cli.github.com,",
                )),
                Line::from(plain("run gh auth login once, and open commitscape again.")),
                Line::default(),
                Line::from(faint(
                    "Repositories on other hosts, such as GitLab, are not supported yet.",
                )),
            ],
        ),
        GitHubState::Ready(g) => ready(app, g, frame, area),
    }
}

fn message(frame: &mut Frame, area: Rect, mut lines: Vec<Line<'static>>) {
    let mut padded = vec![Line::default(); usize::from(area.height / 3)];
    padded.append(&mut lines);
    frame.render_widget(
        Paragraph::new(padded)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn ready(app: &App, g: &GitHub, frame: &mut Frame, area: Rect) {
    let [head, tiles, middle, bottom] = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(5),
        Constraint::Fill(1),
        Constraint::Length(6),
    ])
    .areas(area);

    let mut title = vec![Span::raw(" "), bold(g.name_with_owner.clone())];
    for (flag, word) in [
        (g.private, "private"),
        (g.fork, "fork"),
        (g.archived, "archived"),
    ] {
        if flag {
            title.push(faint(format!("   {word}")));
        }
    }
    let mut lines = vec![Line::from(title)];
    if let Some(d) = &g.description {
        lines.push(Line::from(vec![Span::raw(" "), plain(d.clone())]));
    }
    if !g.topics.is_empty() {
        let mut chips = vec![Span::raw(" ")];
        for t in &g.topics {
            chips.push(Span::styled(
                format!(" {t} "),
                Style::new().fg(theme::TEXT).bg(theme::GRID),
            ));
            chips.push(Span::raw(" "));
        }
        lines.push(Line::from(chips));
    }
    frame.render_widget(Paragraph::new(lines), head);

    let areas = Layout::horizontal([Constraint::Ratio(1, 6); 6]).split(tiles);
    let now = app.anchor;
    let month_ago = now - 30 * DAY;
    let values = [
        (grouped(g.stars), "stars", String::new()),
        (grouped(g.forks), "forks", String::new()),
        (grouped(g.watchers), "watching", String::new()),
        (
            grouped(g.open_issues),
            "open issues",
            format!("{} closed", grouped(g.closed_issues)),
        ),
        (
            grouped(g.open_prs),
            "open pull requests",
            format!("{} merged", grouped(g.merged_prs)),
        ),
        (
            grouped(g.releases),
            "releases",
            g.latest_release
                .as_ref()
                .map(|r| r.tag.clone())
                .unwrap_or_default(),
        ),
    ];
    for (area, (value, label, note)) in areas.iter().zip(values) {
        tile(frame, *area, &value, label, &note);
    }

    let [prs, authors] =
        Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(middle);
    // The recent pull requests reach back to the oldest of them: a busy
    // repository's hundred span days, a quiet one's a year. Days are drawn
    // when they span three weeks or less, weeks otherwise.
    let oldest = g.recent_prs.iter().map(|p| p.created).min().unwrap_or(now);
    let reach = (now - oldest).div_euclid(DAY) + 1;
    let (bucket, slots, unit) = if reach <= 21 {
        (DAY, reach.max(7) as usize, "day")
    } else {
        (7 * DAY, 12, "week")
    };
    let inner = boxed(
        frame,
        prs,
        &format!("Pull requests merged each {unit}"),
        Some(format!("the last {} opened", g.recent_prs.len())),
    );
    let mut merged = vec![0u64; slots];
    for p in &g.recent_prs {
        if let Some(m) = p.merged {
            let back = (now - m).div_euclid(bucket);
            if (0..slots as i64).contains(&back) {
                if let Some(n) = merged.get_mut(slots - 1 - back as usize) {
                    *n += 1;
                }
            }
        }
    }
    let median = g.median_hours_to_merge().map(|h| {
        if h < 1.0 {
            super::many((h * 60.0).round().max(1.0) as u64, "minute", "minutes")
        } else if h < 48.0 {
            super::many(h.round() as u64, "hour", "hours")
        } else {
            super::many((h / 24.0).round() as u64, "day", "days")
        }
    });
    let mut summary = vec![
        bold(grouped(g.recent_prs.len() as u64)),
        faint(format!(" opened in {} · ", span_of_days(reach))),
        bold(grouped(g.prs_merged_since(oldest) as u64)),
        faint(" merged"),
    ];
    if let Some(median) = median {
        summary.push(faint(", half within "));
        summary.push(bold(median));
    }
    frame.render_widget(
        Paragraph::new(super::fit_line(
            Line::from(summary),
            usize::from(inner.width),
        )),
        Rect { height: 1, ..inner },
    );
    charts::columns(
        frame.buffer_mut(),
        Rect {
            y: inner.y + 1,
            height: inner.height.saturating_sub(1),
            ..inner
        },
        &merged,
        ACCENT,
        |i| {
            if i + 1 == slots {
                Some(if bucket == DAY { "today" } else { "this week" }.to_string())
            } else if i == 0 {
                Some(format!("{} {unit}s ago", slots - 1))
            } else {
                None
            }
        },
    );

    let inner = boxed(
        frame,
        authors,
        "Who opens pull requests",
        Some("recent".to_string()),
    );
    let people = g.pr_authors();
    let most = people.first().map_or(0, |p| p.1 as u64);
    let total = g.recent_prs.len() as u64;
    let bar_width = inner.width.saturating_sub(34).max(4);
    let lines: Vec<Line> = people
        .iter()
        .take(usize::from(inner.height))
        .map(|(login, n)| {
            // One series, so one colour: a GitHub login is not matched to
            // the people the rest of the interface colours.
            Line::from(vec![
                plain(format!(" {:<18}", clip(login, 18))),
                Span::styled(
                    format!(
                        "{:<width$}",
                        charts::bar(*n as u64, most, bar_width),
                        width = usize::from(bar_width)
                    ),
                    Style::new().fg(ACCENT),
                ),
                bold(format!(" {:>4}", n)),
                faint(format!(" {:>4}", share(*n as u64, total))),
            ])
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), inner);

    let inner = boxed(frame, bottom, "About", None);
    let mut about = Vec::new();
    if let Some(created) = g.created {
        about.push(Line::from(vec![
            faint(" created "),
            bold(short_date(created)),
            faint(format!(", {}", ago((now - created).div_euclid(DAY)))),
            faint("   last push "),
            bold(
                g.pushed
                    .map(|p| ago((now - p).div_euclid(DAY)))
                    .unwrap_or_default(),
            ),
        ]));
    }
    if let Some(r) = &g.latest_release {
        about.push(Line::from(vec![
            faint(" latest release "),
            bold(r.name.clone().unwrap_or_else(|| r.tag.clone())),
            faint(
                r.published
                    .map(|p| format!(", {}", ago((now - p).div_euclid(DAY))))
                    .unwrap_or_default(),
            ),
        ]));
    }
    // Only the latest issues are asked for; when they do not reach back a
    // month, there were more than they count.
    let more = if g.issues_reach(month_ago) { "" } else { "+" };
    about.push(Line::from(vec![
        faint(" issues opened in 30 days "),
        bold(format!(
            "{}{more}",
            grouped(g.issues_opened_since(month_ago) as u64)
        )),
        faint("   closed "),
        bold(format!(
            "{}{more}",
            grouped(g.issues_closed_since(month_ago) as u64)
        )),
        faint("   license "),
        bold(
            g.license
                .clone()
                .unwrap_or_else(|| "none found".to_string()),
        ),
    ]));
    if let Some(home) = &g.homepage {
        about.push(Line::from(vec![faint(" homepage "), plain(home.clone())]));
    }
    frame.render_widget(Paragraph::new(about), inner);
}
