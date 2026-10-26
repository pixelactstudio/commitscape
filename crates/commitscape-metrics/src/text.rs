use std::cmp::Ordering;

/// Orders two paths as JavaScript orders the text they read as: by UTF-16 code unit, so a Report, the engine and the browser list files alike.
pub fn compare_text(a: &[u8], b: &[u8]) -> Ordering {
    if a.is_ascii() || b.is_ascii() {
        return a.cmp(b);
    }
    String::from_utf8_lossy(a)
        .encode_utf16()
        .cmp(String::from_utf8_lossy(b).encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_ordered_by_utf16_code_unit() {
        assert_eq!(compare_text(b"a", b"b"), Ordering::Less);
        assert_eq!(compare_text(b"a/", b"a"), Ordering::Greater);
        assert_eq!(compare_text(b"z", "\u{e9}".as_bytes()), Ordering::Less);
        let (halfwidth, script) = ("\u{ff61}".as_bytes(), "\u{1d49c}".as_bytes());
        assert_eq!(halfwidth.cmp(script), Ordering::Less);
        assert_eq!(compare_text(halfwidth, script), Ordering::Greater);
    }
}
