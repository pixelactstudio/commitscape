//! Charts drawn into the frame cell by cell: columns, heat grids, bars, a
//! treemap layout and a pixel font.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

use crate::format::month_name;
use crate::theme::{self, GRID, MUTED};

const EIGHTHS: [char; 8] = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇'];
const LEFT_EIGHTHS: [char; 8] = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

fn put(buf: &mut Buffer, x: u16, y: u16, symbol: &str, style: Style) {
    if let Some(cell) = buf.cell_mut((x, y)) {
        cell.set_symbol(symbol).set_style(style);
    }
}

/// Sums `values` into at most `slots` buckets of equal length, the last one
/// possibly shorter. Returns the buckets and how many values each holds.
pub(crate) fn bucket(values: &[u32], slots: usize) -> (Vec<u64>, usize) {
    if values.is_empty() || slots == 0 {
        return (Vec::new(), 1);
    }
    let per = values.len().div_ceil(slots);
    (
        values
            .chunks(per)
            .map(|c| c.iter().map(|&v| u64::from(v)).sum())
            .collect(),
        per,
    )
}

/// A column chart of `values`, oldest on the left, in `colour`, scaled so
/// the tallest reaches the top of `area`. The bottom row carries labels
/// from `label`, which is asked about each column and answers for the
/// first column of a period (a month, a year).
pub(crate) fn columns(
    buf: &mut Buffer,
    area: Rect,
    values: &[u64],
    colour: Color,
    label: impl Fn(usize) -> Option<String>,
) {
    if area.height < 2 || area.width == 0 || values.is_empty() {
        return;
    }
    let plot = Rect {
        height: area.height - 1,
        ..area
    };
    let n = values.len();
    let width = usize::from(plot.width);
    // Columns as wide as fit, with a gap once there is room for one.
    let span = (width / n).max(1);
    let bar = if span >= 3 { span - 1 } else { span };
    let most = values.iter().copied().max().unwrap_or(0);
    let eighths_high = u64::from(plot.height) * 8;
    for (i, &v) in values.iter().enumerate() {
        let x0 = plot.x + (i * span) as u16;
        if usize::from(x0 - plot.x) + bar > width {
            break;
        }
        let mut h = if most == 0 {
            0
        } else {
            (v * eighths_high).div_ceil(most)
        };
        if v > 0 {
            h = h.max(1);
        }
        for row in 0..plot.height {
            let y = plot.y + plot.height - 1 - row;
            let filled = h.saturating_sub(u64::from(row) * 8).min(8) as usize;
            let symbol = match filled {
                0 => continue,
                8 => "█".to_string(),
                f => EIGHTHS.get(f).copied().unwrap_or(' ').to_string(),
            };
            for dx in 0..bar as u16 {
                put(buf, x0 + dx, y, &symbol, Style::new().fg(colour));
            }
        }
    }
    // Labels, left to right, never overlapping. One that would run past
    // the right edge ends there instead, if that keeps it clear of the one
    // before.
    let y = area.y + area.height - 1;
    let mut free_from = area.x;
    for i in 0..n {
        let x = area.x + (i * span) as u16;
        if x < free_from || x >= area.x + area.width {
            continue;
        }
        if let Some(text) = label(i) {
            let long = text.chars().count() as u16;
            let x = x
                .min((area.x + area.width).saturating_sub(long))
                .max(free_from);
            let room = usize::from(area.x + area.width - x);
            let text: String = text.chars().take(room).collect();
            buf.set_string(x, y, &text, Style::new().fg(MUTED));
            free_from = x + text.chars().count() as u16 + 1;
        }
    }
}

/// Labels for a run of days: the month's name at the first column in which
/// a month begins, and the year when the month is January.
pub(crate) fn month_labels(first_day: i64, per: usize) -> impl Fn(usize) -> Option<String> {
    move |i| {
        let start = first_day + (i * per) as i64;
        let day_of = |d: i64| commitscape_core::civil_from_unix(d * 86_400);
        let (_, month, _) = day_of(start);
        let before = day_of(start - 1).1;
        let starts = i == 0 || (0..per as i64).any(|k| day_of(start + k).2 == 1) || month != before;
        if !starts {
            return None;
        }
        let (year, month, _) = day_of(start + per as i64 - 1);
        Some(if month == 1 || i == 0 {
            format!("{} {year}", month_name(month))
        } else {
            month_name(month).to_string()
        })
    }
}

/// A horizontal bar `width` cells long at most, for `value` out of `most`,
/// with eighth-cell precision.
pub(crate) fn bar(value: u64, most: u64, width: u16) -> String {
    if most == 0 || width == 0 {
        return String::new();
    }
    let eighths = (value * u64::from(width) * 8)
        .div_ceil(most)
        .min(u64::from(width) * 8);
    let eighths = if value > 0 { eighths.max(1) } else { 0 };
    let mut s = "█".repeat((eighths / 8) as usize);
    if eighths % 8 > 0 {
        s.push(
            LEFT_EIGHTHS
                .get((eighths % 8) as usize)
                .copied()
                .unwrap_or(' '),
        );
    }
    s
}

/// A bar made of parts, each `(amount, colour)`, filling `width` cells in
/// proportion. A part too small for a cell of its own is left out rather
/// than drawn wider than it is.
pub(crate) fn stacked(parts: &[(u64, Color)], width: u16) -> Line<'static> {
    let total: u64 = parts.iter().map(|p| p.0).sum();
    if total == 0 || width == 0 {
        return Line::default();
    }
    let mut spans = Vec::new();
    let mut used = 0u64;
    let mut before = 0u64;
    for &(amount, colour) in parts {
        before += amount;
        let end = (before * u64::from(width) + total / 2) / total;
        let cells = end.saturating_sub(used);
        if cells > 0 {
            spans.push(Span::styled(
                "█".repeat(cells as usize),
                Style::new().fg(colour),
            ));
            used = end;
        }
    }
    Line::from(spans)
}

/// A grid of squares, one per value, `rows` high and filled column by
/// column, each two cells wide. Used for the calendar (weeks by weekday)
/// and the week (hours by weekday).
pub(crate) fn heat_grid(buf: &mut Buffer, area: Rect, cells: &[Vec<Option<u64>>], most: u64) {
    for (col, column) in cells.iter().enumerate() {
        for (row, value) in column.iter().enumerate() {
            let Some(value) = value else {
                continue;
            };
            let (x, y) = (area.x + (col * 2) as u16, area.y + row as u16);
            if x >= area.right() || y >= area.bottom() {
                continue;
            }
            let colour = theme::step(&theme::BLUES, *value, most).unwrap_or(GRID);
            put(buf, x, y, "■", Style::new().fg(colour));
        }
    }
}

/// The key to a heat grid: `less ■ ■ ■ ■ ■ more`.
pub(crate) fn heat_key() -> Line<'static> {
    let mut spans = vec![Span::styled(" less ", Style::new().fg(MUTED))];
    spans.push(Span::styled("■ ", Style::new().fg(GRID)));
    for colour in theme::BLUES {
        spans.push(Span::styled("■ ", Style::new().fg(colour)));
    }
    spans.push(Span::styled("more ", Style::new().fg(MUTED)));
    Line::from(spans)
}

/// Squarified treemap layout (Bruls, Huizing and van Wijk): rectangles for
/// `sizes`, largest first, filling `area`, as close to square as they can
/// be. A cell is about twice as tall as it is wide, which the layout
/// allows for.
pub(crate) fn treemap(sizes: &[u64], area: Rect) -> Vec<Rect> {
    let total: f64 = sizes.iter().map(|&s| s as f64).sum();
    if total <= 0.0 || area.width == 0 || area.height == 0 {
        return vec![Rect::default(); sizes.len()];
    }
    // Work in a space where a cell is square: height counts double.
    let (w, h) = (f64::from(area.width), f64::from(area.height) * 2.0);
    let scale = w * h / total;
    let areas: Vec<f64> = sizes.iter().map(|&s| s as f64 * scale).collect();
    let mut out = vec![(0.0, 0.0, 0.0, 0.0); sizes.len()];
    let mut free = (0.0, 0.0, w, h);
    let mut start = 0;
    while start < areas.len() {
        let short = free.2.min(free.3);
        let mut end = start + 1;
        let mut best = worst(areas.get(start..end).unwrap_or_default(), short);
        while end < areas.len() {
            let next = worst(areas.get(start..=end).unwrap_or_default(), short);
            if next > best {
                break;
            }
            best = next;
            end += 1;
        }
        let row = areas.get(start..end).unwrap_or_default();
        let sum: f64 = row.iter().sum();
        let (fx, fy, fw, fh) = free;
        if fw >= fh {
            // A column down the left side.
            let cw = if fh > 0.0 { sum / fh } else { 0.0 };
            let mut y = fy;
            for (k, a) in row.iter().enumerate() {
                let rh = if cw > 0.0 { a / cw } else { 0.0 };
                if let Some(slot) = out.get_mut(start + k) {
                    *slot = (fx, y, cw, rh);
                }
                y += rh;
            }
            free = (fx + cw, fy, fw - cw, fh);
        } else {
            // A row across the top.
            let rh = if fw > 0.0 { sum / fw } else { 0.0 };
            let mut x = fx;
            for (k, a) in row.iter().enumerate() {
                let cw = if rh > 0.0 { a / rh } else { 0.0 };
                if let Some(slot) = out.get_mut(start + k) {
                    *slot = (x, fy, cw, rh);
                }
                x += cw;
            }
            free = (fx, fy + rh, fw, fh - rh);
        }
        start = end;
    }
    // Back to cells, rounding edges rather than sizes so neighbours meet.
    out.into_iter()
        .map(|(x, y, cw, ch)| {
            let left = x.round() as u16;
            let right = (x + cw).round() as u16;
            let top = (y / 2.0).round() as u16;
            let bottom = ((y + ch) / 2.0).round() as u16;
            Rect {
                x: area.x + left.min(area.width),
                y: area.y + top.min(area.height),
                width: right.saturating_sub(left).min(area.width),
                height: bottom.saturating_sub(top).min(area.height),
            }
        })
        .collect()
}

/// The worst aspect ratio in a row of areas laid along a side `short` long.
fn worst(row: &[f64], short: f64) -> f64 {
    let sum: f64 = row.iter().sum();
    let (max, min) = row
        .iter()
        .fold((f64::MIN, f64::MAX), |(hi, lo), &a| (hi.max(a), lo.min(a)));
    if sum <= 0.0 || min <= 0.0 {
        return f64::MAX;
    }
    let s2 = short * short;
    let sum2 = sum * sum;
    (s2 * max / sum2).max(sum2 / (s2 * min))
}

/// Three rows of block text in a 3-by-5 pixel font, each letter three cells
/// wide with a cell between: the repository's name at the top of the
/// Overview. `None` for text with characters the font lacks.
pub(crate) fn big_text(text: &str) -> Option<[String; 3]> {
    let mut rows = [String::new(), String::new(), String::new()];
    for (n, c) in text.chars().enumerate() {
        let glyph = glyph(c.to_ascii_lowercase())?;
        for (r, row) in rows.iter_mut().enumerate() {
            if n > 0 {
                row.push(' ');
            }
            for col in 0..3 {
                let pixel = |p: usize| {
                    glyph
                        .get(p)
                        .and_then(|line| line.as_bytes().get(col))
                        .is_some_and(|&b| b == b'#')
                };
                row.push(match (pixel(r * 2), pixel(r * 2 + 1)) {
                    (true, true) => '█',
                    (true, false) => '▀',
                    (false, true) => '▄',
                    (false, false) => ' ',
                });
            }
        }
    }
    Some(rows)
}

fn glyph(c: char) -> Option<[&'static str; 5]> {
    Some(match c {
        'a' => [".#.", "#.#", "###", "#.#", "#.#"],
        'b' => ["##.", "#.#", "##.", "#.#", "##."],
        'c' => [".##", "#..", "#..", "#..", ".##"],
        'd' => ["##.", "#.#", "#.#", "#.#", "##."],
        'e' => ["###", "#..", "###", "#..", "###"],
        'f' => ["###", "#..", "###", "#..", "#.."],
        'g' => [".##", "#..", "#.#", "#.#", ".##"],
        'h' => ["#.#", "#.#", "###", "#.#", "#.#"],
        'i' => ["###", ".#.", ".#.", ".#.", "###"],
        'j' => ["..#", "..#", "..#", "#.#", ".#."],
        'k' => ["#.#", "#.#", "##.", "#.#", "#.#"],
        'l' => ["#..", "#..", "#..", "#..", "###"],
        'm' => ["#.#", "###", "###", "#.#", "#.#"],
        'n' => ["##.", "#.#", "#.#", "#.#", "#.#"],
        'o' => [".#.", "#.#", "#.#", "#.#", ".#."],
        'p' => ["##.", "#.#", "##.", "#..", "#.."],
        'q' => [".#.", "#.#", "#.#", "##.", ".##"],
        'r' => ["##.", "#.#", "##.", "#.#", "#.#"],
        's' => [".##", "#..", ".#.", "..#", "##."],
        't' => ["###", ".#.", ".#.", ".#.", ".#."],
        'u' => ["#.#", "#.#", "#.#", "#.#", ".##"],
        'v' => ["#.#", "#.#", "#.#", ".#.", ".#."],
        'w' => ["#.#", "#.#", "###", "###", "#.#"],
        'x' => ["#.#", "#.#", ".#.", "#.#", "#.#"],
        'y' => ["#.#", "#.#", ".#.", ".#.", ".#."],
        'z' => ["###", "..#", ".#.", "#..", "###"],
        '0' => ["###", "#.#", "#.#", "#.#", "###"],
        '1' => [".#.", "##.", ".#.", ".#.", "###"],
        '2' => ["##.", "..#", ".#.", "#..", "###"],
        '3' => ["##.", "..#", ".#.", "..#", "##."],
        '4' => ["#.#", "#.#", "###", "..#", "..#"],
        '5' => ["###", "#..", "##.", "..#", "##."],
        '6' => [".##", "#..", "###", "#.#", "###"],
        '7' => ["###", "..#", ".#.", "#..", "#.."],
        '8' => ["###", "#.#", "###", "#.#", "###"],
        '9' => ["###", "#.#", "###", "..#", "##."],
        '-' => ["...", "...", "###", "...", "..."],
        '_' => ["...", "...", "...", "...", "###"],
        '.' => ["...", "...", "...", "...", ".#."],
        ' ' => ["...", "...", "...", "...", "..."],
        _ => return None,
    })
}

/// A colour between `from` and `to`, `t` of the way along.
pub(crate) fn blend(from: Color, to: Color, t: f64) -> Color {
    match (from, to) {
        (Color::Rgb(r1, g1, b1), Color::Rgb(r2, g2, b2)) => {
            let mix =
                |a: u8, b: u8| (f64::from(a) + (f64::from(b) - f64::from(a)) * t).round() as u8;
            Color::Rgb(mix(r1, r2), mix(g1, g2), mix(b1, b2))
        }
        _ => from,
    }
}
