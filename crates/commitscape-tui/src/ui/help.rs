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
        ],
        Panel::Activity => &[
            "When commits are made. Every time is on the author's own clock, so 23:00 means 23:00 where they were, from the time zone recorded in the commit.",
            "A commit counts on the day it landed, which is what puts it in the window, and at the hour it was written. The two differ only for a commit rebased or amended after it was written.",
            "In the calendar and the hours of the week, each square is a day or an hour; the lighter it is, the more commits it holds.",
            "What kind of work comes from commit messages written as feat: ..., fix: ... and so on (the Conventional Commits style). Repositories that do not write messages that way show no breakdown.",
        ],
        Panel::People => &[
            "Everyone who committed in the window, most commits first. Each person keeps the same colour on every screen.",
            "Enter opens a profile: when they work, what they work on, and which folders rest on them alone. If two names might be one person, the profile shows the .mailmap lines that would join them.",
        ],
        Panel::Map => &[
            "The code at HEAD as rectangles, each as large as its lines of code. Enter goes into a folder, Esc comes back out, and Enter on a file opens it.",
            "c changes the colours: commits in the window, which shows where the work is; time since last touched, which shows what has been left alone; or who made most of the commits there.",
        ],
        Panel::Hotspots => &[
            "Files that change often and are deeply nested. Bugs and slow changes gather in them, so they are the first code worth simplifying or covering with tests.",
            "Each row has two bars: blue for how often the file changed in the window, orange for how deeply nested it is. Both bars are measured against the largest among the hotspots, so a file with two long bars is high on both.",
            "Under each file is where it ranks. \"The 2nd most changed of 40 files\" compares it with the files that changed in the window; \"the 3rd most nested of 120\" compares it with all the code.",
        ],
        Panel::Coupling => &[
            "Pairs of files that keep changing in the same commits. 75% means three of every four commits that changed either file changed both.",
            "Two files in one folder changing together is normal. In different folders, it often means one depends on the other in a way nobody wrote down, and changing one will break the other.",
        ],
        Panel::Ownership => &[
            "Who made the commits under each folder. The bar splits its commits by person, in each person's colour.",
            "The bus factor is the fewest people who together made more than 80% of those commits. A bus factor of 1 means one person leaving would take most of what anyone knows about the folder.",
        ],
        Panel::Age => &[
            "How long since each file was last changed, and when the code that exists today first appeared.",
            "Old, untouched code is not bad by itself. It is code that few people remember, so it is worth knowing where it is before changing it.",
        ],
        Panel::GitHub => &[
            "What GitHub says about the repository: stars, forks, issues, pull requests and releases, asked through the GitHub CLI (gh) and kept by it for up to an hour.",
            "Nothing else in the app needs GitHub. Start with --offline to never ask it.",
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
    ("w  W", "a longer or shorter window"),
    ("/", "find a file, folder or person in a list"),
    ("c", "change the Map's colours"),
    ("?", "this help"),
    ("q", "quit"),
];
