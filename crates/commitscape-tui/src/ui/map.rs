//! The Map: the code at HEAD as rectangles, each as large as its lines,
//! coloured by where the work is, how long since it was touched, or who
//! holds it.

use commitscape_metrics::MapNode;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, clip, dot, faint, plain, short_phrase};
use crate::app::{App, MapColour};
use crate::format::{ago, compact, grouped, share};
use crate::list::Cursor;
use crate::theme::{self, BLUES, GRID, HEAT, MUTED, SERIES, SURFACE, TEXT};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let nodes = f.nodes();
    if nodes.is_empty() {
        let inner = boxed(frame, area, &format!("Map of {}", app.name), None);
        super::empty(frame, inner, "Drawing the map…");
        return;
    }
    let at = if nodes.get(app.map.at).is_some() {
        app.map.at
    } else {
        0
    };
    let Some(here) = nodes.get(at) else {
        return;
    };
    let [map_area, info_area] =
        Layout::vertical([Constraint::Fill(1), Constraint::Length(4)]).areas(area);

    let title = if here.path.is_empty() {
        app.name.clone()
    } else {
        here.path.clone()
    };
    let colour_name = match app.map.colour {
        MapColour::Heat => "coloured by commits",
        MapColour::Age => "coloured by last touch",
        MapColour::Owner => "coloured by owner",
    };
    let inner = boxed(
        frame,
        map_area,
        &format!("Map of {title}"),
        Some(format!("sized by lines · {colour_name} · c to change")),
    );

    // Every child, even one without lines, so the selection matches what
    // Enter opens.
    let children: Vec<&MapNode> = here.children.iter().filter_map(|&c| nodes.get(c)).collect();
    cursor.step(0, children.len());
    if here.lines == 0 {
        super::empty(frame, inner, "Nothing here has lines of code.");
        return;
    }
    let sizes: Vec<u64> = children.iter().map(|n| n.lines).collect();
    let rects = charts::treemap(&sizes, inner);
    // One heat scale for everything drawn: the folders here and the
    // folders and files inside them.
    let hottest = children
        .iter()
        .flat_map(|n| {
            std::iter::once(n.churn).chain(
                n.children
                    .iter()
                    .filter_map(|&c| nodes.get(c))
                    .map(|g| g.churn),
            )
        })
        .max()
        .unwrap_or(0);
    let selected = cursor.selected();
    let buf = frame.buffer_mut();
    for (k, (node, rect)) in children.iter().zip(&rects).enumerate() {
        if rect.width == 0 || rect.height == 0 {
            continue;
        }
        // A gap of surface on the right and bottom edges separates
        // neighbours, where there is room for one.
        let gap_x = u16::from(rect.width > 2);
        let gap_y = u16::from(rect.height > 1);
        let body = Rect {
            width: rect.width - gap_x,
            height: rect.height - gap_y,
            ..*rect
        };
        let nested = node.file.is_none()
            && !node.children.is_empty()
            && body.width >= 14
            && body.height >= 5;
        if nested {
            // A folder large enough to show what is inside it: a title bar,
            // then its own contents laid out in the rest.
            paint(buf, body, GRID);
            buf.set_string(
                body.x + 1,
                body.y,
                clip(&label(node), usize::from(body.width.saturating_sub(2))),
                Style::new().fg(TEXT).bg(GRID).add_modifier(Modifier::BOLD),
            );
            let inside = Rect {
                x: body.x + 1,
                y: body.y + 1,
                width: body.width.saturating_sub(2),
                height: body.height.saturating_sub(2),
            };
            let grand: Vec<&MapNode> = node.children.iter().filter_map(|&c| nodes.get(c)).collect();
            let grand_sizes: Vec<u64> = grand.iter().map(|g| g.lines).collect();
            for (g, grect) in grand.iter().zip(charts::treemap(&grand_sizes, inside)) {
                tile(buf, g, grect, fill(app, g, hottest), true);
            }
        } else {
            tile(buf, node, *rect, fill(app, node, hottest), false);
        }
        if k == selected {
            let name = if nested { label(node) } else { name(node) };
            outline(buf, *rect, gap_x, gap_y, &name);
        }
    }

    // What is selected, in words.
    let Some(node) = children.get(selected.min(children.len().saturating_sub(1))) else {
        return;
    };
    let owner = node
        .owner
        .map(|o| (o.author, app.display_name(o.author), o.commits));
    let mut first = vec![
        Span::raw(" "),
        bold(if node.file.is_none() {
            format!("{}/", node.name)
        } else {
            node.name.clone()
        }),
        faint(format!(
            "   {} lines in {}",
            grouped(node.lines),
            if node.file.is_some() {
                "one file".to_string()
            } else {
                format!("{} files", grouped(u64::from(node.files)))
            }
        )),
        faint(format!(
            " · {} of {}",
            share(node.lines, here.lines),
            if here.path.is_empty() {
                "the code"
            } else {
                "this folder"
            }
        )),
    ];
    if node.file.is_none() {
        first.push(faint("   enter to go in"));
    } else {
        first.push(faint("   enter to open"));
    }
    let mut second = vec![
        Span::raw(" "),
        plain(format!(
            "{} in {}",
            if node.churn == 1 {
                "1 commit".to_string()
            } else {
                format!("{} commits", grouped(u64::from(node.churn)))
            },
            short_phrase(app.span)
        )),
        faint(format!(
            " · last touched {}",
            ago((app.anchor - node.last_touched).div_euclid(86_400))
        )),
    ];
    if let Some((author, name, commits)) = owner {
        second.push(faint(format!(
            " · {} by ",
            share(u64::from(commits), u64::from(node.churn))
        )));
        second.push(dot(app.colour_of(author)));
        second.push(plain(name));
    }
    let shown: Vec<&MapNode> = children
        .iter()
        .flat_map(|n| std::iter::once(*n).chain(n.children.iter().filter_map(|&c| nodes.get(c))))
        .collect();
    let width = usize::from(info_area.width);
    frame.render_widget(
        Paragraph::new(vec![
            super::fit_line(Line::from(first), width),
            super::fit_line(Line::from(second), width),
            super::fit_line(legend(app, &shown), width),
        ]),
        info_area,
    );
}

/// Fills a rectangle's cells with a colour, leaving their symbols.
fn paint(buf: &mut ratatui::buffer::Buffer, r: Rect, colour: Color) {
    for y in r.y..r.y + r.height {
        for x in r.x..r.x + r.width {
            if let Some(cell) = buf.cell_mut((x, y)) {
                cell.set_symbol(" ").set_bg(colour);
            }
        }
    }
}

/// One rectangle of the map: its fill, less a gap to its neighbours, and
/// its name, with its size below when there is room.
fn tile(buf: &mut ratatui::buffer::Buffer, node: &MapNode, rect: Rect, fill: Color, inner: bool) {
    if rect.width == 0 || rect.height == 0 {
        return;
    }
    let gap_x = u16::from(rect.width > 2);
    let gap_y = u16::from(rect.height > 1 && !inner || rect.height > 2);
    let body = Rect {
        width: rect.width - gap_x,
        height: rect.height - gap_y,
        ..rect
    };
    paint(buf, body, fill);
    let ink = theme::ink_on(fill);
    let room = usize::from(body.width.saturating_sub(1));
    if room >= 3 {
        buf.set_string(
            body.x + 1,
            body.y,
            clip(&name(node), room),
            Style::new().fg(ink).bg(fill).add_modifier(Modifier::BOLD),
        );
        if body.height > 2 {
            buf.set_string(
                body.x + 1,
                body.y + 1,
                clip(&format!("{} lines", compact(node.lines)), room),
                Style::new().fg(ink).bg(fill),
            );
        }
    }
}

fn fill(app: &App, node: &MapNode, hottest: u32) -> Color {
    match app.map.colour {
        MapColour::Heat => {
            theme::step(&HEAT, u64::from(node.churn), u64::from(hottest)).unwrap_or(GRID)
        }
        MapColour::Age => {
            let days = (app.anchor - node.last_touched).div_euclid(86_400).max(0);
            // The longer untouched, the lighter: stale code stands out.
            let step = match days {
                ..=30 => 0,
                31..=180 => 1,
                181..=365 => 2,
                _ => 3,
            };
            BLUES.get(step).copied().unwrap_or(GRID)
        }
        MapColour::Owner => node.owner.map_or(GRID, |o| app.colour_of(o.author)),
    }
}

/// A node's name, a folder's with a slash.
fn name(node: &MapNode) -> String {
    if node.file.is_none() {
        format!("{}/", node.name)
    } else {
        node.name.clone()
    }
}

/// The title bar of a folder drawn with its contents.
fn label(node: &MapNode) -> String {
    format!("{}  {} lines", name(node), compact(node.lines))
}

fn legend(app: &App, shown: &[&MapNode]) -> Line<'static> {
    let mut spans = vec![Span::raw(" ")];
    match app.map.colour {
        MapColour::Heat => {
            spans.push(faint("fewer commits "));
            spans.push(Span::styled("■ ", Style::new().fg(GRID)));
            for c in HEAT {
                spans.push(Span::styled("■ ", Style::new().fg(c)));
            }
            spans.push(faint("more commits"));
        }
        MapColour::Age => {
            spans.push(faint("touched "));
            for (c, label) in BLUES
                .iter()
                .zip(["this month", "half a year", "a year", "longer"])
            {
                spans.push(Span::styled("■ ", Style::new().fg(*c)));
                spans.push(faint(format!("{label}  ")));
            }
        }
        MapColour::Owner => {
            // Everyone who holds something on screen, in their colours,
            // in the order the colours were given out.
            let rank = |a| {
                SERIES
                    .iter()
                    .position(|&c| c == app.colour_of(a))
                    .unwrap_or(SERIES.len())
            };
            let mut owners: Vec<_> = shown
                .iter()
                .filter_map(|n| n.owner)
                .map(|o| o.author)
                .collect();
            owners.sort_by_key(|&a| (rank(a), a));
            owners.dedup();
            spans.push(faint("who made most of its commits: "));
            let mut others = false;
            for author in owners {
                if rank(author) < SERIES.len() {
                    spans.push(dot(app.colour_of(author)));
                    spans.push(plain(format!("{}  ", app.display_name(author))));
                } else {
                    others = true;
                }
            }
            if others {
                spans.push(dot(MUTED));
                spans.push(plain("others  "));
            }
            spans.push(dot(GRID));
            spans.push(faint("nobody in this window"));
        }
    }
    Line::from(spans)
}

/// Draws a frame of heavy lines inside a rectangle, over its fill, with
/// `title` in its top edge.
fn outline(buf: &mut ratatui::buffer::Buffer, r: Rect, gap_x: u16, gap_y: u16, title: &str) {
    let (right, bottom) = (r.x + r.width - 1 - gap_x, r.y + r.height - 1 - gap_y);
    if right <= r.x || bottom <= r.y {
        if let Some(cell) = buf.cell_mut((r.x, r.y)) {
            cell.set_fg(TEXT).set_bg(SURFACE).set_symbol("▶");
        }
        return;
    }
    let style = Style::new().fg(TEXT);
    for x in r.x..=right {
        for y in [r.y, bottom] {
            if let Some(cell) = buf.cell_mut((x, y)) {
                let corner = match (x == r.x, x == right, y == r.y) {
                    (true, _, true) => "┏",
                    (_, true, true) => "┓",
                    (true, _, false) => "┗",
                    (_, true, false) => "┛",
                    _ => "━",
                };
                cell.set_symbol(corner).set_style(style);
            }
        }
    }
    for y in r.y + 1..bottom {
        for x in [r.x, right] {
            if let Some(cell) = buf.cell_mut((x, y)) {
                cell.set_symbol("┃").set_style(style);
            }
        }
    }
    let room = usize::from(right - r.x).saturating_sub(3);
    if room >= 3 {
        buf.set_string(
            r.x + 1,
            r.y,
            format!(" {} ", clip(title, room)),
            style.add_modifier(Modifier::BOLD),
        );
    }
}
