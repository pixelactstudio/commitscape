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
