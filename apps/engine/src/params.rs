use std::collections::BTreeMap;
use std::fmt::Write as _;

use commitscape_metrics::{Span, Window};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Param {
    Flag(bool),
    Number(f64),
    Text(String),
}

pub type Params = BTreeMap<String, Option<Param>>;

pub type Asked = BTreeMap<String, Param>;

const ASKED: [&str; 6] = ["window", "from", "to", "id", "path", "top"];

const LISTS: [&str; 2] = ["/api/people", "/api/overview"];

pub const TOP_MAX: f64 = 1000.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asking {
    pub label: String,
    pub window: Window,
}

/// Whether JavaScript counts a character as white space (`\s`, and what `Number()` trims).
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn radix_number(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    let mut exact: Option<u128> = Some(0);
    let mut rough = 0.0f64;
    for c in digits.chars() {
        let Some(d) = c.to_digit(radix) else {
            return f64::NAN;
        };
        exact = exact
            .and_then(|n| n.checked_mul(u128::from(radix)))
            .and_then(|n| n.checked_add(u128::from(d)));
        rough = rough * f64::from(radix) + f64::from(d);
    }
    exact.map_or(rough, |n| n as f64)
}

/// What JavaScript's `Number(text)` makes of a string.
pub fn js_number(text: &str) -> f64 {
    let t = text.trim_matches(is_js_space);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let lower = t.get(..2).map(str::to_ascii_lowercase);
    let rest = t.get(2..).unwrap_or("");
    match lower.as_deref() {
        Some("0x") => return radix_number(rest, 16),
        Some("0o") => return radix_number(rest, 8),
        Some("0b") => return radix_number(rest, 2),
        _ => {}
    }
    if !t
        .bytes()
        .all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.' | b'e' | b'E'))
    {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// What JavaScript's `String(n)` makes of a number, for whole numbers below 10^21; other numbers as Rust writes them.
pub fn js_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_string()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        (n as i128).to_string()
    } else {
        n.to_string()
    }
}

impl Param {
    /// The parameter as JavaScript's `Number()` reads it.
    pub fn number(&self) -> f64 {
        match self {
            Param::Flag(b) => f64::from(u8::from(*b)),
            Param::Number(n) => *n,
            Param::Text(t) => js_number(t),
        }
    }

    /// The parameter as JavaScript's `String()` writes it.
    pub fn text(&self) -> String {
        match self {
            Param::Flag(b) => b.to_string(),
            Param::Number(n) => js_string(*n),
            Param::Text(t) => t.clone(),
        }
    }

    pub fn is_truthy(&self) -> bool {
        match self {
            Param::Flag(b) => *b,
            Param::Number(n) => *n != 0.0 && !n.is_nan(),
            Param::Text(t) => !t.is_empty(),
        }
    }

    fn is_given(&self) -> bool {
        !matches!(self, Param::Text(t) if t.is_empty())
    }
}

/// A request's params with only those an answer depends on, as `askedOf` keeps them.
pub fn asked(params: &Params) -> Asked {
    ASKED
        .iter()
        .filter_map(|k| {
            let p = params.get(*k)?.as_ref()?;
            p.is_given().then(|| (k.to_string(), p.clone()))
        })
        .collect()
}

/// Reads a question's params from the query of a Data Source key, as `URLSearchParams` does, the last of a repeated name winning.
pub fn from_query(query: &str) -> Params {
    url::form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.into_owned(), Some(Param::Text(v.into_owned()))))
        .collect()
}

fn encode_component(s: &str, out: &mut String) {
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(char::from(b));
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
}

/// One key per question: the path and the asked params sorted by name.
pub fn key(path: &str, asked: &Asked) -> String {
    let mut out = String::with_capacity(path.len() + 32);
    out.push_str(path);
    out.push('?');
    for (i, (k, v)) in asked.iter().enumerate() {
        if i > 0 {
            out.push('&');
        }
        out.push_str(k);
        out.push('=');
        encode_component(&v.text(), &mut out);
    }
    out
}

/// The Window a request names, as `windowOf` reads it: one of the Report's spans back from the anchor, or any `from`..`to` in seconds, rounded inward to whole seconds.
pub fn window_of(anchor: i64, asked: &Asked) -> Option<Asking> {
    let from = asked.get("from").map(Param::number);
    let to = asked.get("to").map(Param::number);
    if from.is_some() || to.is_some() {
        if from.is_some_and(|f| !f.is_finite()) || to.is_some_and(|t| !t.is_finite()) {
            return None;
        }
        let end = to.unwrap_or(anchor as f64);
        if from.is_some_and(|f| f > end) {
            return None;
        }
        return Some(Asking {
            label: "range".to_string(),
            window: Window {
                from: from.map(|f| f.ceil() as i64),
                to: end.floor() as i64,
            },
        });
    }
    let label = asked
        .get("window")
        .map_or_else(|| "all".to_string(), Param::text);
    let span = Span::from_label(&label)?;
    Some(Asking {
        window: span.window(anchor),
        label,
    })
}

/// How many of an answer's people a request asks for, as `topOf` reads it.
pub fn top_of(asked: &Asked) -> Option<usize> {
    let n = asked.get("top")?.number();
    (n.is_finite() && n.fract() == 0.0 && (0.0..=TOP_MAX).contains(&n)).then_some(n as usize)
}

/// Whether `top` cuts the answers of a path.
pub fn cuts(path: &str) -> bool {
    LISTS.contains(&path)
}

/// An answer cut to its first `top` people with `count` saying how many it listed, as `limited` cuts it.
pub fn limited(path: &str, top: Option<usize>, mut value: Value) -> Value {
    let Some(top) = top else {
        return value;
    };
    if !cuts(path) {
        return value;
    }
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    let Some(Value::Array(people)) = object.get_mut("people") else {
        return value;
    };
    let count = people.len();
    people.truncate(top);
    object.insert("count".to_string(), Value::from(count));
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text(s: &str) -> Option<Param> {
        Some(Param::Text(s.to_string()))
    }

    #[test]
    fn numbers_read_as_javascript_reads_them() {
        let cases: [(&str, f64); 16] = [
            ("12", 12.0),
            ("  12\n", 12.0),
            ("", 0.0),
            ("   ", 0.0),
            ("1e3", 1000.0),
            ("-1.5", -1.5),
            (".5", 0.5),
            ("5.", 5.0),
            ("+7", 7.0),
            ("0x1F", 31.0),
            ("0b101", 5.0),
            ("0o17", 15.0),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
            ("1e1000", f64::INFINITY),
            ("\u{feff}3\u{a0}", 3.0),
        ];
        for (s, n) in cases {
            assert_eq!(js_number(s), n, "{s:?}");
        }
        for s in [
            "abc", "1_000", "inf", "nan", "NaN", "0x", "-0x5", "5e", ".", "1 2", "\u{85}1",
        ] {
            assert!(js_number(s).is_nan(), "{s:?}");
        }
        assert!(js_number("-0").is_sign_negative());
    }

    #[test]
    fn numbers_write_as_javascript_writes_whole_ones() {
        assert_eq!(js_string(3.0), "3");
        assert_eq!(js_string(-0.0), "0");
        assert_eq!(js_string(1.5), "1.5");
        assert_eq!(js_string(f64::NAN), "NaN");
        assert_eq!(js_string(f64::NEG_INFINITY), "-Infinity");
    }

    #[test]
    fn only_the_params_an_answer_depends_on_are_kept() {
        let params: Params = [
            ("window".to_string(), text("30d")),
            ("from".to_string(), text("")),
            ("to".to_string(), None),
            ("id".to_string(), Some(Param::Number(3.0))),
            ("other".to_string(), text("x")),
            ("top".to_string(), Some(Param::Number(0.0))),
        ]
        .into_iter()
        .collect();
        let asked = asked(&params);
        assert_eq!(
            asked.keys().map(String::as_str).collect::<Vec<_>>(),
            ["id", "top", "window"]
        );
        assert_eq!(
            key("/api/person", &asked),
            "/api/person?id=3&top=0&window=30d"
        );
    }

    #[test]
    fn keys_encode_their_values() {
        let asked: Asked = [("path".to_string(), Param::Text("src/a b&c".to_string()))]
            .into_iter()
            .collect();
        assert_eq!(key("/api/map", &asked), "/api/map?path=src%2Fa%20b%26c");
    }

    #[test]
    fn a_query_reads_as_url_search_params_reads_it() {
        let params = from_query("window=30d&path=a+b%2Fc&window=90d&x");
        assert_eq!(params.get("window"), Some(&text("90d")));
        assert_eq!(params.get("path"), Some(&text("a b/c")));
        assert_eq!(params.get("x"), Some(&text("")));
    }

    fn asking(pairs: &[(&str, Param)]) -> Asked {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn windows_are_the_reports_spans_or_any_range() {
        let anchor = 1_000_000;
        let w = |pairs: &[(&str, Param)]| window_of(anchor, &asking(pairs));
        assert_eq!(
            w(&[]),
            Some(Asking {
                label: "all".into(),
                window: Window::all(anchor)
            })
        );
        assert_eq!(
            w(&[("window", Param::Text("30d".into()))]).map(|a| a.window),
            Some(Window::last(30, anchor))
        );
        assert_eq!(w(&[("window", Param::Text("7d".into()))]), None);
        assert_eq!(w(&[("window", Param::Number(30.0))]), None);
        assert_eq!(
            w(&[("from", Param::Text("100".into()))]),
            Some(Asking {
                label: "range".into(),
                window: Window {
                    from: Some(100),
                    to: anchor
                }
            })
        );
        assert_eq!(
            w(&[
                ("from", Param::Number(10.5)),
                ("to", Param::Text("20.5".into())),
                ("window", Param::Text("30d".into()))
            ])
            .map(|a| a.window),
            Some(Window {
                from: Some(11),
                to: 20
            })
        );
        assert_eq!(
            w(&[("to", Param::Text("50".into()))]).map(|a| a.window),
            Some(Window { from: None, to: 50 })
        );
        assert_eq!(w(&[("from", Param::Text("2000000".into()))]), None);
        assert_eq!(w(&[("from", Param::Text("x".into()))]), None);
        assert_eq!(w(&[("to", Param::Text("Infinity".into()))]), None);
    }

    #[test]
    fn top_is_a_whole_number_up_to_a_thousand() {
        let top = |p: Param| top_of(&asking(&[("top", p)]));
        assert_eq!(top(Param::Text("5".into())), Some(5));
        assert_eq!(top(Param::Number(0.0)), Some(0));
        assert_eq!(top(Param::Text("1000".into())), Some(1000));
        assert_eq!(top(Param::Text("1001".into())), None);
        assert_eq!(top(Param::Text("-1".into())), None);
        assert_eq!(top(Param::Text("2.5".into())), None);
        assert_eq!(top_of(&Asked::new()), None);
    }

    #[test]
    fn lists_are_cut_to_their_first_people_and_say_how_many() {
        let value = json!({ "window": "all", "people": [1, 2, 3], "bots": [4, 5] });
        assert_eq!(
            limited("/api/people", Some(2), value.clone()),
            json!({ "window": "all", "people": [1, 2], "bots": [4, 5], "count": 3 })
        );
        assert_eq!(limited("/api/people", None, value.clone()), value);
        assert_eq!(limited("/api/activity", Some(1), value.clone()), value);
        assert_eq!(limited("/api/overview", Some(1), json!([1])), json!([1]));
    }
}
