//! Colours and styles.
//!
//! Every colour is from the validated reference palette of the data
//! visualisation method, checked on this app's own dark surface with its
//! validator: the eight categorical colours pass every check, and the blue
//! and orange ramps pass the ordinal checks (STATE.md, Phase 11). The app
//! paints its own background so the checks hold in any terminal theme.
//!
//! Everything is drawn in 24-bit colour. A terminal without it gets each
//! colour mapped to the nearest of the 256 standard ones, once per frame, by
//! [`fit_to_terminal`].

use ratatui::buffer::Buffer;
use ratatui::style::{Color, Modifier, Style};

const fn rgb(hex: u32) -> Color {
    Color::Rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

/// The app's background.
pub(crate) const SURFACE: Color = rgb(0x1a1a19);
/// Hairline rules, empty heatmap cells, and the fill of things at rest.
pub(crate) const GRID: Color = rgb(0x2c2c2a);
/// Borders and axes.
pub(crate) const LINE: Color = rgb(0x383835);
/// The selected row's background: step 700 of the blue ramp.
pub(crate) const SELECTED: Color = rgb(0x0d366b);

pub(crate) const TEXT: Color = rgb(0xffffff);
pub(crate) const TEXT_2: Color = rgb(0xc3c2b7);
pub(crate) const MUTED: Color = rgb(0x898781);

/// Identity: people and languages take these in a fixed order, and keep
/// them whatever the Window. A ninth is never generated; the rest are
/// "others", in [`MUTED`].
pub(crate) const SERIES: [Color; 8] = [
    rgb(0x3987e5),
    rgb(0xd95926),
    rgb(0x199e70),
    rgb(0xc98500),
    rgb(0xd55181),
    rgb(0x008300),
    rgb(0x9085e9),
    rgb(0xe66767),
];

/// The accent: the first categorical colour.
pub(crate) const ACCENT: Color = SERIES[0];

/// How much: commits per day or hour. Darkest for the least, on this dark
/// surface.
pub(crate) const BLUES: [Color; 4] = [rgb(0x184f95), rgb(0x2a78d6), rgb(0x6da7ec), rgb(0xb7d3f6)];

/// How hot: churn and hotspot score. Built from the orange of the
/// categorical colours at the blue ramp's lightness steps.
pub(crate) const HEAT: [Color; 4] = [rgb(0xa42602), rgb(0xce4e2f), rgb(0xfc7856), rgb(0xfec1af)];

/// Reserved for state, always with a word or a mark beside it.
pub(crate) const GOOD: Color = rgb(0x0ca30c);
pub(crate) const WARNING: Color = rgb(0xfab219);
pub(crate) const CRITICAL: Color = rgb(0xd03b3b);

pub(crate) fn text() -> Style {
    Style::new().fg(TEXT)
}

pub(crate) fn secondary() -> Style {
    Style::new().fg(TEXT_2)
}

pub(crate) fn muted() -> Style {
    Style::new().fg(MUTED)
}

pub(crate) fn title() -> Style {
    Style::new().fg(TEXT).add_modifier(Modifier::BOLD)
}

/// A ramp step for `value` out of `most`: `None` for nothing at all, so an
/// empty cell stays at rest.
pub(crate) fn step(ramp: &[Color; 4], value: u64, most: u64) -> Option<Color> {
    if value == 0 || most == 0 {
        return None;
    }
    // Quartiles of the largest value: the smallest non-zero value still
    // lands on the first step.
    let i = ((value * 4).div_ceil(most)).clamp(1, 4) as usize - 1;
    ramp.get(i).copied()
}

/// The ink that reads on a fill: white on dark fills, near-black on light.
pub(crate) fn ink_on(fill: Color) -> Color {
    match fill {
        Color::Rgb(r, g, b) => {
            let luminance = 0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b);
            if luminance > 150.0 {
                rgb(0x0b0b0b)
            } else {
                TEXT
            }
        }
        _ => TEXT,
    }
}

/// Whether the terminal shows 24-bit colour, from what it says about itself.
pub fn truecolor() -> bool {
    let has = |var: &str, any: &[&str]| {
        std::env::var(var)
            .map(|v| any.iter().any(|a| v.to_ascii_lowercase().contains(a)))
            .unwrap_or(false)
    };
    has("COLORTERM", &["truecolor", "24bit"])
        || has(
            "TERM_PROGRAM",
            &["iterm", "wezterm", "vscode", "ghostty", "hyper", "tabby"],
        )
        || has("TERM", &["kitty", "alacritty", "foot", "direct"])
}

/// Maps every 24-bit colour in a drawn frame to the nearest of the 240
/// fixed colours of a 256-colour terminal. The first 16 are left out:
/// terminals theme them, so their real colour is unknown.
pub(crate) fn fit_to_terminal(buffer: &mut Buffer) {
    for cell in buffer.content.iter_mut() {
        if let Color::Rgb(r, g, b) = cell.fg {
            cell.fg = Color::Indexed(nearest_256(r, g, b));
        }
        if let Color::Rgb(r, g, b) = cell.bg {
            cell.bg = Color::Indexed(nearest_256(r, g, b));
        }
    }
}

fn nearest_256(r: u8, g: u8, b: u8) -> u8 {
    const LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];
    let level = |c: u8| {
        LEVELS
            .iter()
            .enumerate()
            .min_by_key(|(_, &l)| (i32::from(l) - i32::from(c)).abs())
            .map_or(0, |(i, _)| i)
    };
    let (ri, gi, bi) = (level(r), level(g), level(b));
    let cube = (16 + 36 * ri + 6 * gi + bi) as u8;
    let at = |i: usize| i32::from(LEVELS.get(i).copied().unwrap_or(0));
    let gray_level = ((i32::from(r) + i32::from(g) + i32::from(b)) / 3 - 8).clamp(0, 230) / 10;
    let gray = 232 + gray_level as u8;
    let gray_value = 8 + 10 * gray_level;
    let distance = |cr: i32, cg: i32, cb: i32| {
        (cr - i32::from(r)).pow(2) + (cg - i32::from(g)).pow(2) + (cb - i32::from(b)).pow(2)
    };
    if distance(gray_value, gray_value, gray_value) < distance(at(ri), at(gi), at(bi)) {
        gray
    } else {
        cube
    }
}
