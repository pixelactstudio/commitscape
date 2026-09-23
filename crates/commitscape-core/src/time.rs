//! Calendar arithmetic in UTC, without a date library.
//!
//! Commit times are seconds since the Unix epoch. The cache groups commits by
//! calendar month and the metrics report ages by month and quarter, so both
//! need the civil date of a timestamp. The conversions are Howard Hinnant's
//! `days_from_civil` and `civil_from_days`, exact over the whole `i64` range
//! git can produce.

use serde::{Deserialize, Serialize};

const SECONDS_PER_DAY: i64 = 86_400;

/// A calendar month in UTC, counted in months since January of year 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Month(pub i64);

impl Month {
    /// The month containing a Unix timestamp.
    pub fn of(unix: i64) -> Month {
        let (year, month, _) = civil_from_days(unix.div_euclid(SECONDS_PER_DAY));
        Month(year * 12 + (month as i64 - 1))
    }

    /// The first second of this month.
    pub fn start(self) -> i64 {
        let year = self.0.div_euclid(12);
        let month = self.0.rem_euclid(12) as u32 + 1;
        days_from_civil(year, month, 1) * SECONDS_PER_DAY
    }

    pub fn year(self) -> i64 {
        self.0.div_euclid(12)
    }

    /// 1 for January through 12 for December.
    pub fn number(self) -> u32 {
        self.0.rem_euclid(12) as u32 + 1
    }

    pub fn next(self) -> Month {
        Month(self.0 + 1)
    }
}

/// A Unix timestamp as an RFC 3339 / ISO 8601 UTC time, to the second:
/// `2024-01-05T00:00:00Z`.
pub fn iso8601(unix: i64) -> String {
    let (y, m, d) = civil_from_unix(unix);
    let secs = unix.rem_euclid(SECONDS_PER_DAY);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60
    )
}

/// Reads a UTC time written as GitHub writes them, `2024-01-05T00:00:00Z`,
/// as seconds since the epoch. Anything else is `None`.
pub fn parse_iso8601(text: &str) -> Option<i64> {
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let separators = [
        (4, "-"),
        (7, "-"),
        (10, "T"),
        (13, ":"),
        (16, ":"),
        (19, "Z"),
    ];
    if text.len() != 20
        || separators
            .iter()
            .any(|&(i, c)| text.get(i..i + 1) != Some(c))
    {
        return None;
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let valid = (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && hour < 24
        && minute < 60
        && second < 61;
    valid.then(|| {
        days_from_civil(year, month as u32, day as u32) * SECONDS_PER_DAY
            + hour * 3600
            + minute * 60
            + second
    })
}

/// `(year, month, day)` of a Unix timestamp, in UTC.
pub fn civil_from_unix(unix: i64) -> (i64, u32, u32) {
    civil_from_days(unix.div_euclid(SECONDS_PER_DAY))
}

/// Days since 1970-01-01 of a civil date.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil date of a count of days since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { y + 1 } else { y }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Timestamps below were computed by hand from day counts and checked with
    // `date -u -d @<n>`.
    const JAN_1_2024: i64 = 1_704_067_200;
    const FEB_1_2024: i64 = 1_706_745_600;
    const FEB_29_2000: i64 = 951_782_400;

    #[test]
    fn a_timestamp_knows_its_civil_date() {
        assert_eq!(civil_from_unix(JAN_1_2024), (2024, 1, 1));
        assert_eq!(civil_from_unix(FEB_1_2024 - 1), (2024, 1, 31));
        assert_eq!(civil_from_unix(FEB_29_2000), (2000, 2, 29));
        assert_eq!(civil_from_unix(0), (1970, 1, 1));
        assert_eq!(civil_from_unix(-1), (1969, 12, 31));
    }

    #[test]
    fn a_timestamp_prints_as_iso_8601_utc() {
        assert_eq!(iso8601(JAN_1_2024), "2024-01-01T00:00:00Z");
        assert_eq!(iso8601(FEB_1_2024 - 1), "2024-01-31T23:59:59Z");
        assert_eq!(iso8601(-1), "1969-12-31T23:59:59Z");
    }

    #[test]
    fn an_iso_8601_time_reads_back_as_the_timestamp_it_was() {
        assert_eq!(parse_iso8601("2024-01-01T00:00:00Z"), Some(JAN_1_2024));
        assert_eq!(parse_iso8601("2024-01-31T23:59:59Z"), Some(FEB_1_2024 - 1));
        assert_eq!(parse_iso8601(&iso8601(FEB_29_2000)), Some(FEB_29_2000));
        assert_eq!(parse_iso8601("2024-01-01"), None);
        assert_eq!(parse_iso8601("2024-13-01T00:00:00Z"), None);
        assert_eq!(parse_iso8601("2024-01-01T00:00:00+01:00"), None);
    }

    #[test]
    fn a_month_starts_at_its_first_second() {
        let jan = Month::of(JAN_1_2024 + 12 * 86_400);
        assert_eq!(jan.start(), JAN_1_2024);
        assert_eq!(jan.next().start(), FEB_1_2024);
        assert_eq!((jan.year(), jan.number()), (2024, 1));
    }

    #[test]
    fn months_either_side_of_a_boundary_differ() {
        assert_eq!(Month::of(FEB_1_2024 - 1).next(), Month::of(FEB_1_2024));
        assert_eq!(Month::of(-1).next(), Month::of(0));
    }
}
