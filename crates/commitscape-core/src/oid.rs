//! A plain git object id.
//!
//! Deliberately ours rather than `gix_hash::ObjectId`: ADR-0001 keeps gix types
//! inside the index crate, and an object id appears in the cache format and in
//! `--json` output, both of which outlive any particular git library.

use serde::{Deserialize, Serialize};

/// A SHA-1 git object id.
///
/// v0.1 assumes SHA-1 repositories. A SHA-256 repository will fail to open with
/// a clear message rather than being silently truncated into this type.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Oid(pub [u8; 20]);

impl Oid {
    pub const ZERO: Oid = Oid([0; 20]);

    /// Parses 40 hex characters. Returns `None` on any other length or on a
    /// non-hex byte.
    pub fn from_hex(s: &str) -> Option<Self> {
        let bytes = s.as_bytes();
        if bytes.len() != 40 {
            return None;
        }
        let mut out = [0u8; 20];
        for (i, slot) in out.iter_mut().enumerate() {
            let hi = hex_val(*bytes.get(i * 2)?)?;
            let lo = hex_val(*bytes.get(i * 2 + 1)?)?;
            *slot = (hi << 4) | lo;
        }
        Some(Oid(out))
    }

    /// Builds from raw bytes. Returns `None` unless exactly 20 bytes, which is
    /// how a SHA-256 repository is rejected rather than truncated.
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        let arr: [u8; 20] = b.try_into().ok()?;
        Some(Oid(arr))
    }

    pub fn to_hex(self) -> String {
        let mut s = String::with_capacity(40);
        for b in self.0 {
            s.push(nibble(b >> 4));
            s.push(nibble(b & 0xf));
        }
        s
    }

    /// The abbreviated form used in human-facing output.
    pub fn short(self) -> String {
        self.to_hex().chars().take(9).collect()
    }
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn nibble(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        _ => (b'a' + n - 10) as char,
    }
}

impl std::fmt::Debug for Oid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Oid({})", self.to_hex())
    }
}

impl std::fmt::Display for Oid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_hex())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values here are a known-good git object id typed out by hand,
    // not a value computed by this module.
    const KNOWN: &str = "adcc5f3bdc1a3c205141996ba01404b6e4b27310";

    #[test]
    fn hex_round_trips() {
        let oid = Oid::from_hex(KNOWN).expect("valid hex");
        assert_eq!(oid.to_hex(), KNOWN);
    }

    #[test]
    fn first_byte_is_parsed_big_endian() {
        // 0xad = 173. If the nibbles were swapped this would be 0xda = 218.
        let oid = Oid::from_hex(KNOWN).expect("valid hex");
        assert_eq!(oid.0[0], 0xad);
        assert_eq!(oid.0[19], 0x10);
    }

    #[test]
    fn short_form_is_nine_characters() {
        let oid = Oid::from_hex(KNOWN).expect("valid hex");
        assert_eq!(oid.short(), "adcc5f3bd");
    }

    #[test]
    fn rejects_wrong_length_and_non_hex() {
        assert!(Oid::from_hex("abc").is_none());
        assert!(Oid::from_hex(&"z".repeat(40)).is_none());
        // A SHA-256 id must be rejected, not truncated to its first 20 bytes.
        assert!(Oid::from_bytes(&[0u8; 32]).is_none());
    }
}
