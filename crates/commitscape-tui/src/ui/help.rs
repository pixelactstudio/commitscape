//! The help window: what the open screen means, what every word means, and
//! the keys.

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use super::{bold, boxed, clear, faint, plain};
use crate::app::{App, Panel};
use crate::theme::{ACCENT, TEXT};

/// Draws the window over everything and returns the scroll, kept within the
/// text.
pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, scroll: usize) -> usize {
    let width = area.width.saturating_sub(8).min(100);
    let height = area.height.saturating_sub(4);
    let window = Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + 2,
        width,
        height,
    };
    clear(frame, window);
    let inner = boxed(
        frame,
        window,
        &format!("Help · {}", app.panel.title()),
        Some("↑↓ scroll · esc close".to_string()),
    );

    let mut lines = vec![heading("This screen")];
    for paragraph in this_screen(app.panel) {
        lines.push(Line::from(plain(*paragraph)));
        lines.push(Line::default());
    }
    lines.push(heading("What the words mean"));
    for (word, meaning) in WORDS {
        lines.push(Line::from(vec![bold(format!("{word}. ")), plain(*meaning)]));
        lines.push(Line::default());
    }
    lines.push(heading("Keys"));
    for (keys, what) in KEYS {
        lines.push(Line::from(vec![
            Span::styled(
                format!("{keys:<14}"),
                Style::new().fg(TEXT).add_modifier(Modifier::BOLD),
            ),
            faint(*what),
        ]));
    }

    // Scrolled by wrapped rows, as far as the last one.
    let rows = super::prose_height(&lines, inner.width);
    let scroll = scroll.min(usize::from(rows.saturating_sub(inner.height)));
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((u16::try_from(scroll).unwrap_or(u16::MAX), 0)),
        super::inset(inner),
    );
    scroll
}

fn heading(text: &str) -> Line<'static> {
    Line::from(Span::styled(
        text.to_string(),
        Style::new().fg(ACCENT).add_modifier(Modifier::BOLD),
    ))
}

fn this_screen(panel: Panel) -> &'static [&'static str] {
    match panel {
        Panel::Overview => &[
            "The repository at a glance. The tiles count all of its history; the chart, the people and the facts cover the window. Press w to change the window. Over all of history, the tiles also say how many commits land a week and how few people made 80% of them.",
            "Worth a look lists what deserves attention: folders that rest on one person, the hottest file, files that change together across folders. Select one and press Enter to open it.",
            "Did you know? tells only what is unusual: most commits at night or at the weekend, a streak of three weeks or more, a day five times as busy as a usual one, a file changed in a fifth of all commits, a file of 5,000 lines or more, one untouched for three years. When nothing is, it says so.",
            "Code age counts today's lines of code by the quarter their file first appeared.",
        ],
        Panel::Activity => &[
            "When commits are made. Every time is on the author's own clock, so 23:00 means 23:00 where they were, from the time zone recorded in the commit.",
            "A commit counts on the day it landed, which is what puts it in the window, and at the hour it was written. The two differ only for a commit rebased or amended after it was written.",
            "In the calendar and the hours of the week, each square is a day or an hour; the lighter it is, the more commits it holds.",
            "Commits over time are split among the five people who made the most, each in their own colour, and everyone else in grey. ▾ marks a release: a tag named like a version.",
            "What kind of work is judged from the files first: a commit that changed only tests is tests, only documentation docs, only manifests and lockfiles dependencies, only CI files CI. Otherwise its message decides, if it is written as feat: ..., fix: ... (Conventional Commits). When most commits can be told neither way, the breakdown is not shown.",
            "GitHub's numbers come from the latest hundred pull requests and issues, asked through the GitHub CLI (gh).",
        ],
        Panel::People => &[
            "Everyone who committed in the window, most commits first. Each person keeps the same colour on every screen.",
            "Enter opens a profile: when they work, what they work on, and which folders rest on them alone. If two names might be one person, the profile shows the .mailmap lines that would join them.",
        ],
        Panel::Map => &[
            "The code at HEAD as rectangles, each as large as its lines of code. Enter goes into a folder, Esc comes back out, and Enter on a file opens it.",
            "c colours it by activity (commits in the window: where the work is), by age (time since last touched: what has been left alone), or by owner (who made most of the commits there).",
        ],
        Panel::Risk => &[
            "Where a change is most likely to hurt, in three lists. Enter opens a row.",
            "Hotspots: files that change often and are deeply nested. Bugs and slow changes gather in them, so they are the first code worth simplifying or testing. \"The 2nd most changed of 40 files\" compares a file with the files that changed in the window; \"the 3rd most nested of 120\" with all the code.",
            "Change groups: files that keep changing in the same commits, every two of them in at least half of the commits that changed either. Files in different folders changing together often depend on each other in a way nobody wrote down.",
            "Knowledge silos: folders only one person committed to in the window. If they left, nobody would know the folder. Next to each is who else made the most commits in the nearest folder around it, who could take it over.",
        ],
    }
}

const WORDS: &[(&str, &str)] = &[
    ("Window", "The time every number covers: the last 30 days, 90 days, a year, or all of history. Press w to change it."),
    ("Changes", "How many commits in the window changed a file. Merge commits and very large commits (over 50 files, such as a reformat) do not count, because they would drown out everything else."),
    ("Nesting", "How deeply indented a file is: the indentation depth of every line, added up. Deeply nested code has more branches and loops to follow. It stands in for complexity and works the same in every language."),
    ("Hotspot", "A file that both changes often and is deeply nested. Its score multiplies the share of files it matches or beats on each, so only files high on both score high."),
    ("Coupling", "How often two files change in the same commit, out of all the commits that changed either one."),
    ("Bus factor", "The fewest people who together made more than 80% of a folder's commits."),
    ("Local time", "When the author made a commit, on their own clock, using the time zone recorded in the commit."),
    ("Lines + / −", "Lines a person added and removed, counted the way git diff counts them, in the background after the screen opens. Left out: lockfiles, generated and vendored files, very large commits, merges, and commits listed in .git-blame-ignore-revs. Binary files and files over a megabyte are not counted. Counts can differ from git's by a line where two diffs are equally short."),
    ("Areas", "Folders where a person made more than 80% of the commits: the folders that depend on them. A folder inside another of theirs is not counted again."),
    ("Merged identities", "One person who committed under several addresses. Addresses join when GitHub says they are one account or when they carry the same full name (two or more words). Press u on the person to undo it."),
    ("Bots", "Automation accounts such as dependabot[bot]. Their commits count as activity, but they are left out of the people and hold no folder."),
    ("Lines of code", "Lines in files people wrote. Lockfiles, generated files and vendored code are left out everywhere, as are configuration files from the language bar."),
    ("Last touched", "The last commit that changed a file, whatever kind of commit it was."),
];

const KEYS: &[(&str, &str)] = &[
    ("1 to 9", "open a screen"),
    ("← →  tab", "the next or previous screen"),
    ("↑ ↓  j k", "move through a list"),
    ("pgup pgdn", "a page at a time"),
    ("enter", "open what is selected"),
    ("esc", "go back"),
    (
        "w  W",
        "a longer or shorter window; what is open stays open",
    ),
    ("/", "find a file, folder or person in a list"),
    ("c", "colour the Map by activity, age or owner"),
    ("u", "on a person: undo a merge of identities, or redo it"),
    ("t", "the colours: the terminal's own, dark, or light"),
    (
        "mouse",
        "click a screen, a window, a row or a Map block; the wheel scrolls",
    ),
    ("?", "this help"),
    ("q", "quit"),
];
