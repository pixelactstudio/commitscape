//! A drawn frame as an SVG image: what `commitscape card` writes, and how the
//! interface is looked at while it is designed.
//!
//! Every cell is placed exactly, so the picture keeps its shape whatever
//! font the viewer has. Blocks, box lines, braille dots and heatmap squares
//! are drawn as shapes rather than as characters: fonts disagree about them,
//! and a picture meant for sharing must look the same everywhere.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use ratatui::buffer::Buffer;
use ratatui::style::{Color, Modifier};

use crate::theme::{SURFACE, TEXT};

/// One cell, in SVG units. The width is 0.6 of the font size, the advance of
/// a typical monospace face.
const CELL_W: f64 = 9.0;
const CELL_H: f64 = 19.0;
const FONT_SIZE: f64 = 15.0;
const FONTS: &str = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', \
                     'Liberation Mono', monospace";

/// The frame in `buffer` as a standalone SVG document.
pub fn svg(buffer: &Buffer) -> String {
    let area = buffer.area;
    let (cols, rows) = (area.width, area.height);
    let (width, height) = (f64::from(cols) * CELL_W, f64::from(rows) * CELL_H);
    let mut out = String::with_capacity(usize::from(cols) * usize::from(rows) * 40);
    let _ = write!(
        out,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><style>text{{font-family:{FONTS};font-size:{FONT_SIZE}px;white-space:pre}}</style><rect width="100%" height="100%" fill="{}"/>"#,
        hex(SURFACE, SURFACE)
    );

    // Backgrounds, one rectangle per run of cells sharing a colour.
    for y in 0..rows {
        let mut x = 0;
        while x < cols {
            let bg = background(buffer, x, y);
            let start = x;
            while x < cols && background(buffer, x, y) == bg {
                x += 1;
            }
            if bg != SURFACE {
                let _ = write!(
                    out,
                    r#"<rect x="{}" y="{}" width="{}" height="{CELL_H}" fill="{}"/>"#,
                    f64::from(start) * CELL_W,
                    f64::from(y) * CELL_H,
                    f64::from(x - start) * CELL_W,
                    hex(bg, SURFACE)
                );
            }
        }
    }

    // Glyphs: runs of text in one style as one element, each character
    // placed at its own cell, so the words can be searched and copied;
    // shapes on their own. Straight box lines are gathered and drawn after,
    // joined where they touch.
    let mut strokes = Strokes::default();
    for y in 0..rows {
        let mut run = Run::default();
        // Full blocks side by side in one colour are one rectangle: a bar
        // is a few shapes rather than one a cell.
        let mut blocks: Option<(f64, f64, String)> = None;
        let top = f64::from(y) * CELL_H;
        let flush = |blocks: &mut Option<(f64, f64, String)>, out: &mut String| {
            if let Some((from, to, colour)) = blocks.take() {
                let _ = write!(
                    out,
                    r#"<rect x="{from}" y="{top}" width="{}" height="{CELL_H}" fill="{colour}"/>"#,
                    to - from
                );
            }
        };
        for x in 0..cols {
            let Some(cell) = buffer.cell((area.x + x, area.y + y)) else {
                continue;
            };
            let symbol = cell.symbol();
            let left = f64::from(x) * CELL_W;
            if symbol != "█" {
                flush(&mut blocks, &mut out);
            }
            if symbol.is_empty() || symbol == " " {
                run.space(left);
                continue;
            }
            let reversed = cell.modifier.contains(Modifier::REVERSED);
            let fg = if reversed { cell.bg } else { cell.fg };
            let colour = hex(fg, TEXT);
            let straight = symbol
                .chars()
                .next()
                .and_then(arms)
                .filter(|&(_, _, rounded)| !rounded && symbol.chars().count() == 1);
            if let Some((sides, width, _)) = straight {
                run.write(&mut out, top);
                strokes.add(&colour, width, sides, left, top);
                continue;
            }
            if symbol == "█" && !cell.modifier.contains(Modifier::UNDERLINED) {
                run.write(&mut out, top);
                match &mut blocks {
                    Some((_, to, same)) if *same == colour && *to == left => *to = left + CELL_W,
                    _ => {
                        flush(&mut blocks, &mut out);
                        blocks = Some((left, left + CELL_W, colour));
                    }
                }
                continue;
            }
            let mut chars = symbol.chars();
            let single = match (chars.next(), chars.next()) {
                (Some(c), None) => Some(c),
                _ => None,
            };
            match single.and_then(|c| shape(c, left, top, &colour)) {
                Some(shape) => {
                    run.write(&mut out, top);
                    out.push_str(&shape);
                }
                None => {
                    let style = Style {
                        colour: colour.clone(),
                        bold: cell.modifier.contains(Modifier::BOLD),
                        dim: cell.modifier.contains(Modifier::DIM),
                    };
                    if single.is_none() || run.style.as_ref() != Some(&style) {
                        run.write(&mut out, top);
                        run.style = Some(style);
                    }
                    run.push(left, symbol);
                    if single.is_none() {
                        run.write(&mut out, top);
                    }
                }
            }
            if cell.modifier.contains(Modifier::UNDERLINED) {
                let _ = write!(
                    out,
                    r#"<rect x="{left}" y="{}" width="{CELL_W}" height="1" fill="{colour}"/>"#,
                    top + CELL_H - 2.0
                );
            }
        }
        flush(&mut blocks, &mut out);
        run.write(&mut out, top);
    }
    strokes.write(&mut out);
    out.push_str("</svg>\n");
    out
}

/// How a run of text is drawn.
#[derive(PartialEq)]
struct Style {
    colour: String,
    bold: bool,
    dim: bool,
}

/// Characters in one style along a row, each with its own position.
#[derive(Default)]
struct Run {
    style: Option<Style>,
    xs: Vec<f64>,
    text: String,
    /// Spaces seen since the last character, kept only if one follows.
    gap: Vec<f64>,
}

impl Run {
    fn push(&mut self, x: f64, symbol: &str) {
        if !self.text.is_empty() {
            for &at in &self.gap {
                self.xs.push(at);
                self.text.push(' ');
            }
        }
        self.gap.clear();
        self.xs.push(x);
        self.text.push_str(symbol);
    }

    fn space(&mut self, x: f64) {
        if !self.text.is_empty() {
            self.gap.push(x);
        }
    }

    /// Writes the run, if it holds anything, and starts another.
    fn write(&mut self, out: &mut String, top: f64) {
        if let Some(style) = self.style.take().filter(|_| !self.text.is_empty()) {
            let xs: Vec<String> = self.xs.iter().map(f64::to_string).collect();
            let weight = if style.bold {
                r#" font-weight="700""#
            } else {
                ""
            };
            let faint = if style.dim { r#" opacity="0.6""# } else { "" };
            let _ = write!(
                out,
                r#"<text x="{}" y="{}" fill="{}"{weight}{faint}>{}</text>"#,
                xs.join(" "),
                top + CELL_H * 0.75,
                style.colour,
                escape(&self.text)
            );
        }
        *self = Run::default();
    }
}

fn background(buffer: &Buffer, x: u16, y: u16) -> Color {
    let area = buffer.area;
    match buffer.cell((area.x + x, area.y + y)) {
        Some(cell) if cell.modifier.contains(Modifier::REVERSED) => match cell.fg {
            Color::Reset => TEXT,
            c => c,
        },
        Some(cell) => match cell.bg {
            Color::Reset => SURFACE,
            c => c,
        },
        None => SURFACE,
    }
}

/// A character drawn as shapes, or `None` for one drawn as text.
fn shape(c: char, x: f64, y: f64, colour: &str) -> Option<String> {
    let (w, h) = (CELL_W, CELL_H);
    let rect = |fx: f64, fy: f64, fw: f64, fh: f64| {
        format!(
            r#"<rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" fill="{colour}"/>"#,
            x + fx * w,
            y + fy * h,
            fw * w,
            fh * h
        )
    };
    let code = c as u32;
    Some(match c {
        '█' => rect(0.0, 0.0, 1.0, 1.0),
        '▀' => rect(0.0, 0.0, 1.0, 0.5),
        '▔' => rect(0.0, 0.0, 1.0, 0.125),
        '▐' => rect(0.5, 0.0, 0.5, 1.0),
        '▕' => rect(0.875, 0.0, 0.125, 1.0),
        // Lower eighths, ▁ to ▇.
        '\u{2581}'..='\u{2587}' => {
            let f = f64::from(code - 0x2580) / 8.0;
            rect(0.0, 1.0 - f, 1.0, f)
        }
        // Left eighths, ▉ (seven) down to ▏ (one); ▌ is four.
        '\u{2589}'..='\u{258f}' => rect(0.0, 0.0, f64::from(0x2590 - code) / 8.0, 1.0),
        '░' | '▒' | '▓' => {
            let opacity = match c {
                '░' => 0.25,
                '▒' => 0.5,
                _ => 0.75,
            };
            format!(
                r#"<rect x="{x:.2}" y="{y:.2}" width="{w}" height="{h}" fill="{colour}" fill-opacity="{opacity}"/>"#
            )
        }
        '\u{2596}'..='\u{259f}' => {
            // Quadrants: upper left, upper right, lower left, lower right.
            let [ul, ur, ll, lr] = match c {
                '▖' => [false, false, true, false],
                '▗' => [false, false, false, true],
                '▘' => [true, false, false, false],
                '▙' => [true, false, true, true],
                '▚' => [true, false, false, true],
                '▛' => [true, true, true, false],
                '▜' => [true, true, false, true],
                '▝' => [false, true, false, false],
                '▞' => [false, true, true, false],
                _ => [false, true, true, true],
            };
            let mut s = String::new();
            for (on, fx, fy) in [
                (ul, 0.0, 0.0),
                (ur, 0.5, 0.0),
                (ll, 0.0, 0.5),
                (lr, 0.5, 0.5),
            ] {
                if on {
                    s.push_str(&rect(fx, fy, 0.5, 0.5));
                }
            }
            s
        }
        '■' => rect(0.1, 0.25, 0.8, 0.5),
        '▪' => rect(0.25, 0.35, 0.5, 0.3),
        '●' => format!(
            r#"<circle cx="{:.2}" cy="{:.2}" r="{:.2}" fill="{colour}"/>"#,
            x + w / 2.0,
            y + h / 2.0,
            w * 0.38
        ),
        '\u{2800}'..='\u{28ff}' => {
            // Braille: dots 1 to 3 and 7 down the left, 4 to 6 and 8 down
            // the right.
            const DOTS: [(u32, f64, f64); 8] = [
                (0x01, 0.0, 0.0),
                (0x02, 0.0, 1.0),
                (0x04, 0.0, 2.0),
                (0x08, 1.0, 0.0),
                (0x10, 1.0, 1.0),
                (0x20, 1.0, 2.0),
                (0x40, 0.0, 3.0),
                (0x80, 1.0, 3.0),
            ];
            let bits = code - 0x2800;
            let mut s = String::new();
            for (bit, col, row) in DOTS {
                if bits & bit != 0 {
                    let _ = write!(
                        s,
                        r#"<circle cx="{:.2}" cy="{:.2}" r="1.4" fill="{colour}"/>"#,
                        x + (col + 0.5) * w / 2.0,
                        y + (row + 0.5) * h / 4.0
                    );
                }
            }
            s
        }
        _ => return lines(c, x, y, colour),
    })
}

/// Box-drawing characters as strokes from the cell's centre to its edges.
/// A straight segment in hundredths of a unit: the row or column it runs
/// along, and where it starts and ends on it.
type Segment = (i64, i64, i64);

/// Straight box lines by colour and width in tenths: horizontal segments,
/// then vertical ones.
#[derive(Default)]
struct Strokes {
    styles: BTreeMap<(String, u32), (Vec<Segment>, Vec<Segment>)>,
}

impl Strokes {
    /// A cell's arms, from its middle to the edges it reaches.
    fn add(
        &mut self,
        colour: &str,
        width: f64,
        [left, right, up, down]: [bool; 4],
        x: f64,
        y: f64,
    ) {
        let at = |v: f64| (v * 100.0).round() as i64;
        let (cx, cy) = (at(x + CELL_W / 2.0), at(y + CELL_H / 2.0));
        let (x0, x1, y0, y1) = (at(x), at(x + CELL_W), at(y), at(y + CELL_H));
        let (across, down_) = self
            .styles
            .entry((colour.to_string(), (width * 10.0).round() as u32))
            .or_default();
        if left {
            across.push((cy, x0, cx));
        }
        if right {
            across.push((cy, cx, x1));
        }
        if up {
            down_.push((cx, y0, cy));
        }
        if down {
            down_.push((cx, cy, y1));
        }
    }

    /// One path for each colour and width, each run of touching segments
    /// one line in it.
    fn write(self, out: &mut String) {
        let unit = |v: i64| v as f64 / 100.0;
        for ((colour, tenths), (mut across, mut down)) in self.styles {
            let mut d = String::new();
            for (segments, horizontal) in [(&mut across, true), (&mut down, false)] {
                segments.sort_unstable();
                let mut joined: Vec<Segment> = Vec::new();
                for &(line, from, to) in segments.iter() {
                    match joined.last_mut() {
                        Some(last) if last.0 == line && last.2 >= from => last.2 = last.2.max(to),
                        _ => joined.push((line, from, to)),
                    }
                }
                for (line, from, to) in joined {
                    let (a, b, c) = (unit(line), unit(from), unit(to));
                    let _ = if horizontal {
                        write!(d, "M{b},{a}H{c}")
                    } else {
                        write!(d, "M{a},{b}V{c}")
                    };
                }
            }
            let _ = write!(
                out,
                r#"<path d="{d}" stroke="{colour}" stroke-width="{}" fill="none" stroke-linecap="square"/>"#,
                f64::from(tenths) / 10.0
            );
        }
    }
}

/// A box-drawing character's arms (left, right, up, down), its stroke
/// width, and whether its corner is rounded.
fn arms(c: char) -> Option<([bool; 4], f64, bool)> {
    Some(match c {
        '─' => ([true, true, false, false], 1.0, false),
        '━' => ([true, true, false, false], 2.5, false),
        '│' => ([false, false, true, true], 1.0, false),
        '┃' => ([false, false, true, true], 2.5, false),
        '┌' => ([false, true, false, true], 1.0, false),
        '┐' => ([true, false, false, true], 1.0, false),
        '└' => ([false, true, true, false], 1.0, false),
        '┘' => ([true, false, true, false], 1.0, false),
        '┏' => ([false, true, false, true], 2.5, false),
        '┓' => ([true, false, false, true], 2.5, false),
        '┗' => ([false, true, true, false], 2.5, false),
        '┛' => ([true, false, true, false], 2.5, false),
        '╭' => ([false, true, false, true], 1.0, true),
        '╮' => ([true, false, false, true], 1.0, true),
        '╰' => ([false, true, true, false], 1.0, true),
        '╯' => ([true, false, true, false], 1.0, true),
        '├' => ([false, true, true, true], 1.0, false),
        '┤' => ([true, false, true, true], 1.0, false),
        '┬' => ([true, true, false, true], 1.0, false),
        '┴' => ([true, true, true, false], 1.0, false),
        '┼' => ([true, true, true, true], 1.0, false),
        _ => return None,
    })
}

fn lines(c: char, x: f64, y: f64, colour: &str) -> Option<String> {
    let (arms, width, rounded) = arms(c)?;
    let (cx, cy) = (x + CELL_W / 2.0, y + CELL_H / 2.0);
    let [left, right, up, down] = arms;
    let mut path = String::new();
    if rounded {
        // One arm across, one arm up or down, joined by a curve.
        let (hx, vy) = (
            if left { x } else { x + CELL_W },
            if up { y } else { y + CELL_H },
        );
        let _ = write!(
            path,
            "M{hx:.2},{cy:.2} Q{cx:.2},{cy:.2} {cx:.2},{:.2} L{cx:.2},{vy:.2}",
            (cy + vy) / 2.0
        );
    } else {
        if left {
            let _ = write!(path, "M{x:.2},{cy:.2} L{cx:.2},{cy:.2} ");
        }
        if right {
            let _ = write!(path, "M{cx:.2},{cy:.2} L{:.2},{cy:.2} ", x + CELL_W);
        }
        if up {
            let _ = write!(path, "M{cx:.2},{y:.2} L{cx:.2},{cy:.2} ");
        }
        if down {
            let _ = write!(path, "M{cx:.2},{cy:.2} L{cx:.2},{:.2} ", y + CELL_H);
        }
    }
    Some(format!(
        r#"<path d="{}" stroke="{colour}" stroke-width="{width}" fill="none" stroke-linecap="square"/>"#,
        path.trim_end()
    ))
}

fn hex(c: Color, default: Color) -> String {
    let (r, g, b) = match c {
        Color::Rgb(r, g, b) => (r, g, b),
        Color::Reset => return hex(default, TEXT),
        Color::Black => (0, 0, 0),
        Color::White | Color::Gray => (0xe5, 0xe5, 0xe5),
        Color::DarkGray => (0x76, 0x76, 0x76),
        Color::Red | Color::LightRed => (0xe6, 0x67, 0x67),
        Color::Green | Color::LightGreen => (0x0c, 0xa3, 0x0c),
        Color::Yellow | Color::LightYellow => (0xfa, 0xb2, 0x19),
        Color::Blue | Color::LightBlue => (0x39, 0x87, 0xe5),
        Color::Magenta | Color::LightMagenta => (0xd5, 0x51, 0x81),
        Color::Cyan | Color::LightCyan => (0x19, 0x9e, 0x70),
        Color::Indexed(_) => return hex(default, TEXT),
    };
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
