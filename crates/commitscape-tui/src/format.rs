use commitscape_core::civil_from_unix;

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

pub fn counted(n: u64, one: &str, many: &str) -> String {
    format!("{} {}", grouped(n), if n == 1 { one } else { many })
}

pub fn percent(share: f64) -> String {
    format!("{:.0}%", share * 100.0)
}

pub fn date(unix: i64) -> String {
    let (y, m, d) = civil_from_unix(unix);
    format!("{y:04}-{m:02}-{d:02}")
}

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

pub fn ago(n: i64) -> String {
    if n <= 0 {
        "today".to_string()
    } else {
        format!("{} ago", days(n))
    }
}

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

pub fn month_name(month: u32) -> &'static str {
    const NAMES: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    NAMES
        .get(month.saturating_sub(1) as usize)
        .copied()
        .unwrap_or("")
}

pub fn weekday_name(day: usize) -> &'static str {
    const NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    NAMES.get(day).copied().unwrap_or("")
}

pub fn long_date(unix: i64) -> String {
    let day = unix.div_euclid(86_400);
    let (y, m, d) = civil_from_unix(unix);
    let weekday = (day + 3).rem_euclid(7) as usize;
    format!("{} {d} {} {y}", weekday_name(weekday), month_name(m))
}

pub fn short_date(unix: i64) -> String {
    let (y, m, d) = civil_from_unix(unix);
    format!("{d} {} {y}", month_name(m))
}

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

pub fn hour(h: usize) -> String {
    format!("{h:02}:00")
}

pub fn share(part: u64, whole: u64) -> String {
    if whole == 0 {
        return "0%".to_string();
    }
    percent(part as f64 / whole as f64)
}

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

pub fn most(place: u32, what: &str) -> String {
    if place <= 1 {
        format!("the most {what}")
    } else {
        format!("the {} most {what}", ordinal(place))
    }
}
