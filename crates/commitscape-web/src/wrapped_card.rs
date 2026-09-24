//! The Wrapped card: one person's year on a 1,200 by 630 image, as SVG,
//! in the dark palette validated for the browser (STATE.md, Phase 19).
//! Every bar has its number written beside it; each chart is one series.

use std::fmt::Write as _;

use crate::api::WrappedYear;

const W: i64 = 1200;
const H: i64 = 630;
const SURFACE: &str = "#1a1a19";
const TEXT: &str = "#ffffff";
const TEXT_2: &str = "#c3c2b7";
const MUTED: &str = "#898781";
const LINE: &str = "#383835";
const BLUE: &str = "#3987e5";
const ORANGE: &str = "#d95926";
const GREEN: &str = "#199e70";

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 1234567 → "1,234,567".
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// 1234 → "1.2k", 2500000 → "2.5M".
fn compact(n: u64) -> String {
    for (size, unit) in [(1_000_000_000u64, "B"), (1_000_000, "M"), (1_000, "k")] {
        if n >= size {
            // Rounded down, as the interfaces do: 999,600 is "999k", never
            // "1000k".
            let v = n as f64 / size as f64;
            return if v >= 10.0 {
                format!("{}{unit}", v.floor())
            } else {
                format!("{}{unit}", (v * 10.0).floor() / 10.0)
            };
        }
    }
    grouped(n)
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn short_date(day: i64) -> String {
    let (_, m, d) = commitscape_core::civil_from_unix(day * 86_400);
    format!(
        "{d} {}",
        MONTHS.get((m as usize).saturating_sub(1)).unwrap_or(&"")
    )
}

/// How a piece of text is set.
#[derive(Clone, Copy)]
struct Style {
    size: u32,
    fill: &'static str,
    weight: u32,
    anchor: &'static str,
}

const fn style(size: u32, fill: &'static str, weight: u32, anchor: &'static str) -> Style {
    Style {
        size,
        fill,
        weight,
        anchor,
    }
}

fn text(out: &mut String, x: i64, y: i64, st: Style, s: &str) {
    let Style {
        size,
        fill,
        weight,
        anchor,
    } = st;
    let _ = write!(
        out,
        r#"<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}">{}</text>"#,
        escape(s)
    );
}

/// Ranked bars, each with its label on the left and its number on the right.
fn bars(
    out: &mut String,
    x: i64,
    y: i64,
    width: i64,
    title: &str,
    rows: &[(String, u64, String)],
    colour: &str,
) {
    text(out, x, y, style(18, TEXT_2, 600, "start"), title);
    let most = rows.iter().map(|r| r.1).max().unwrap_or(1).max(1);
    let label_w = 170;
    let value_w = 70;
    let track = width - label_w - value_w;
    for (i, (label, value, shown)) in rows.iter().enumerate() {
        let row_y = y + 22 + i as i64 * 30;
        let mut name = label.clone();
        if name.chars().count() > 18 {
            name = format!("{}…", name.chars().take(17).collect::<String>());
        }
        text(out, x, row_y + 14, style(16, TEXT, 400, "start"), &name);
        let w = ((*value as f64 / most as f64) * track as f64).max(3.0) as i64;
        let _ = write!(
            out,
            r#"<rect x="{}" y="{}" width="{w}" height="12" rx="3" fill="{colour}"/>"#,
            x + label_w,
            row_y + 3
        );
        text(
            out,
            x + width,
            row_y + 14,
            style(16, TEXT_2, 400, "end"),
            shown,
        );
    }
}

/// The card for a year.
pub fn card(y: &WrappedYear) -> String {
    let mut s = String::new();
    let _ = write!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"><rect width="{W}" height="{H}" fill="{SURFACE}"/>"#
    );
    let title = y.title.clone();
    text(&mut s, 56, 84, style(44, TEXT, 700, "start"), &title);
    let repos_with = y.repositories.len() as u64;
    let sub = format!(
        "{} across {} {} · {} days with a commit",
        if y.commits == 1 {
            "1 commit".to_string()
        } else {
            format!("{} commits", grouped(u64::from(y.commits)))
        },
        grouped(repos_with),
        if repos_with == 1 {
            "repository"
        } else {
            "repositories"
        },
        grouped(u64::from(y.active_days))
    );
    text(&mut s, 56, 122, style(20, MUTED, 400, "start"), &sub);

    // Four big numbers.
    let tiles: [(String, String); 4] = [
        (grouped(u64::from(y.commits)), "commits".to_string()),
        (
            y.lines_added.map_or_else(|| "—".to_string(), compact),
            if y.lines_added.is_some() {
                "lines added".to_string()
            } else {
                "lines not counted".to_string()
            },
        ),
        (
            format!(
                "{} {}",
                y.streak_days,
                if y.streak_days == 1 { "day" } else { "days" }
            ),
            "longest streak".to_string(),
        ),
        (
            y.busiest_day.map_or_else(|| "—".to_string(), short_date),
            format!("busiest day, {} commits", y.busiest_commits),
        ),
    ];
    for (i, (value, label)) in tiles.iter().enumerate() {
        let x = 56 + i as i64 * 276;
        let _ = write!(
            s,
            r#"<rect x="{x}" y="156" width="256" height="112" rx="12" fill="none" stroke="{LINE}" stroke-width="1.5"/>"#
        );
        text(&mut s, x + 20, 214, style(40, TEXT, 700, "start"), value);
        text(&mut s, x + 20, 246, style(17, TEXT_2, 400, "start"), label);
    }

    // Where and in what.
    let repos: Vec<(String, u64, String)> = y
        .repositories
        .iter()
        .take(5)
        .map(|r| {
            (
                r.name.clone(),
                u64::from(r.commits),
                grouped(u64::from(r.commits)),
            )
        })
        .collect();
    bars(
        &mut s,
        56,
        318,
        520,
        "Where: commits by repository",
        &repos,
        BLUE,
    );
    let languages: Vec<(String, u64, String)> = y
        .languages
        .iter()
        .take(5)
        .map(|l| (l.name.clone(), l.lines, compact(l.lines)))
        .collect();
    if languages.is_empty() {
        text(
            &mut s,
            624,
            318,
            style(18, TEXT_2, 600, "start"),
            "In what: languages",
        );
        text(
            &mut s,
            624,
            354,
            style(16, MUTED, 400, "start"),
            "Lines were not counted.",
        );
    } else {
        bars(
            &mut s,
            624,
            318,
            520,
            "In what: lines added by language",
            &languages,
            ORANGE,
        );
    }

    // When: commits by hour.
    let total: u32 = y.hours.iter().sum();
    let night = if total == 0 {
        0
    } else {
        (f64::from(y.night) * 100.0 / f64::from(total)).round() as u32
    };
    let when = format!("When: by hour of the day · {night}% between 22:00 and 05:00");
    text(&mut s, 56, 506, style(18, TEXT_2, 600, "start"), &when);
    let most = y.hours.iter().copied().max().unwrap_or(1).max(1);
    let (left, bottom, height, step) = (56i64, 588i64, 56.0f64, 45i64);
    for (h, &n) in y.hours.iter().enumerate() {
        let bh = ((f64::from(n) / f64::from(most)) * height).max(if n > 0 { 2.0 } else { 0.0 });
        let x = left + h as i64 * step;
        let _ = write!(
            s,
            r#"<rect x="{x}" y="{:.1}" width="{}" height="{bh:.1}" rx="3" fill="{GREEN}"/>"#,
            bottom as f64 - bh,
            step - 8
        );
    }
    let _ = write!(
        s,
        r#"<line x1="{left}" x2="{}" y1="{bottom}" y2="{bottom}" stroke="{LINE}"/>"#,
        left + 24 * step - 8
    );
    for h in [0i64, 6, 12, 18] {
        text(
            &mut s,
            left + h * step,
            bottom + 22,
            style(14, MUTED, 400, "start"),
            &format!("{h:02}:00"),
        );
    }
    text(
        &mut s,
        W - 56,
        bottom + 22,
        style(14, MUTED, 400, "end"),
        "commitscape wrapped",
    );
    s.push_str("</svg>");
    s
}
