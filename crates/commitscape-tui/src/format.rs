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

/// Where a value ranks in its population: `p83` when 83% of it is at or
/// below the value.
pub fn percentile(share: f64) -> String {
    format!("p{}", (share * 100.0).floor() as u32)
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
