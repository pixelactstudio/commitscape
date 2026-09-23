//! Numbers, shares and dates as the interface shows them.

use commitscape_core::civil_from_unix;

/// `1234567` as `1,234,567`.
pub fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `n` and its noun: `1 commit`, `2,000 commits`.
pub fn counted(n: u64, one: &str, many: &str) -> String {
    format!("{} {}", grouped(n), if n == 1 { one } else { many })
}

/// A share as a whole percentage: `0.666` as `67%`.
pub fn percent(share: f64) -> String {
    format!("{:.0}%", share * 100.0)
}

/// A Unix time as its UTC date: `2025-06-30`.
pub fn date(unix: i64) -> String {
    let (y, m, d) = civil_from_unix(unix);
    format!("{y:04}-{m:02}-{d:02}")
}

/// A number of days, roughly: `today`, `1 day`, `12 days`, `5 weeks`,
/// `7 months`, `2 years`.
pub fn days(n: i64) -> String {
    match n {
        ..=0 => "today".to_string(),
        1 => "1 day".to_string(),
        2..=13 => format!("{n} days"),
        14..=59 => format!("{} weeks", n / 7),
        60..=729 => format!("{} months", n / 30),
        _ => format!("{} years", n / 365),
    }
}

/// How long ago, roughly: `today`, `1 day ago`, `5 weeks ago`.
pub fn ago(n: i64) -> String {
    if n <= 0 {
        "today".to_string()
    } else {
        format!("{} ago", days(n))
    }
}

/// A size in bytes, in the largest unit that keeps it at or above one:
/// `980 B`, `12.3 KB`, `4.1 MB`.
pub fn bytes(n: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if n < 1024 {
        return format!("{n} B");
    }
    let mut size = n as f64 / 1024.0;
    let mut unit = 0;
    while size >= 1024.0 && unit + 1 < UNITS.len() {
        size /= 1024.0;
        unit += 1;
    }
    format!("{size:.1} {}", UNITS.get(unit).copied().unwrap_or("TB"))
}

/// A number in four characters or fewer: `987`, `1.2k`, `23k`, `1.5M`.
pub fn compact(n: u64) -> String {
    let short = |value: f64, unit: &str| {
        let text = format!("{value:.1}");
        format!("{}{unit}", text.trim_end_matches(".0"))
    };
    match n {
        0..=999 => n.to_string(),
        1_000..=9_999 => short(n as f64 / 1_000.0, "k"),
        10_000..=999_999 => format!("{}k", n / 1_000),
        1_000_000..=9_999_999 => short(n as f64 / 1_000_000.0, "M"),
        _ => format!("{}M", n / 1_000_000),
    }
}

/// `Jan` for 1 through `Dec` for 12.
pub fn month_name(month: u32) -> &'static str {
    const NAMES: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    NAMES
        .get(month.saturating_sub(1) as usize)
        .copied()
        .unwrap_or("")
}

/// `Mon` for 0 through `Sun` for 6.
pub fn weekday_name(day: usize) -> &'static str {
    const NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    NAMES.get(day).copied().unwrap_or("")
}

/// A Unix time as a day people read: `Sun 17 May 2026`.
pub fn long_date(unix: i64) -> String {
    let day = unix.div_euclid(86_400);
    let (y, m, d) = civil_from_unix(unix);
    let weekday = (day + 3).rem_euclid(7) as usize;
    format!("{} {d} {} {y}", weekday_name(weekday), month_name(m))
}

/// A Unix time as `17 May 2026`.
pub fn short_date(unix: i64) -> String {
    let (y, m, d) = civil_from_unix(unix);
    format!("{d} {} {y}", month_name(m))
}

/// A span of days as a person would say it: `12 days`, `4 months`,
/// `2 years and 3 months`.
pub fn span_of_days(days: i64) -> String {
    let plural = |n: i64, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    match days {
        ..=0 => "less than a day".to_string(),
        1..=44 => plural(days, "day", "days"),
        45..=364 => plural(days / 30, "month", "months"),
        _ => {
            let (years, months) = (days / 365, days % 365 / 30);
            if months == 0 {
                plural(years, "year", "years")
            } else {
                format!(
                    "{} and {}",
                    plural(years, "year", "years"),
                    plural(months, "month", "months")
                )
            }
        }
    }
}

/// An hour of the day, on a 24-hour clock: `23:00`.
pub fn hour(h: usize) -> String {
    format!("{h:02}:00")
}

/// `part` of `whole` as a whole percentage, `0%` of nothing.
pub fn share(part: u64, whole: u64) -> String {
    if whole == 0 {
        return "0%".to_string();
    }
    percent(part as f64 / whole as f64)
}

/// `n` as an ordinal: `1st`, `2nd`, `3rd`, `11th`, `1,001st`.
pub fn ordinal(n: u32) -> String {
    let suffix = match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{}{suffix}", grouped(u64::from(n)))
}

/// A place in a ranking with the word it ranks by: `the most changed`,
/// `the 2nd most changed`.
pub fn most(place: u32, what: &str) -> String {
    if place <= 1 {
        format!("the most {what}")
    } else {
        format!("the {} most {what}", ordinal(place))
    }
}
