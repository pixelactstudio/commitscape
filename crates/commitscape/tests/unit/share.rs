use super::*;

const KEY: [u8; 32] = [7; 32];
const NONCE: [u8; 12] = [9; 12];

#[test]
fn a_locked_report_opens_with_its_key_and_fails_when_changed() {
    let locked = lock(&KEY, &NONCE, b"the report").expect("locked");
    assert_eq!(
        base64url(&locked),
        "CQkJCQkJCQkJCQkJU-3htMyVsQ7SFiW449uUXvmxSiSw7zwauAA"
    );
    assert_eq!(unlock(&KEY, &locked).as_deref(), Some(&b"the report"[..]));
    let mut tampered = locked.clone();
    if let Some(b) = tampered.last_mut() {
        *b ^= 1;
    }
    assert_eq!(unlock(&KEY, &tampered), None);
    assert_eq!(unlock(&[8; 32], &locked), None);
}

#[test]
fn the_delete_token_comes_from_the_key() {
    assert_eq!(
        delete_token(&KEY),
        "78UF_u01KXZi-HTDpVBCbJQpmn87MYkNQr9hvL4_6-g"
    );
}

#[cfg(unix)]
#[test]
fn the_list_of_links_is_readable_only_by_its_owner() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("commitscape-share-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a folder");
    let path = dir.join("shares.json");
    std::fs::write(&path, b"[]").expect("an old list");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))
        .expect("readable by all");
    write_private(&path, b"[1]").expect("written");
    let mode = std::fs::metadata(&path)
        .expect("there")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    assert_eq!(std::fs::read(&path).expect("read"), b"[1]");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn base64url_both_ways() {
    for bytes in [&b""[..], b"f", b"fo", b"foo", b"foob", &[255, 254, 253, 0]] {
        assert_eq!(unbase64url(&base64url(bytes)).as_deref(), Some(bytes));
    }
    assert_eq!(base64url(&[251, 255]), "-_8");
}

#[test]
fn a_link_gives_its_site_id_and_key() {
    let link = format!("https://example.com/s/abc_DEF-1#{}", base64url(&KEY));
    let (origin, id, key) = parse_link(&link).expect("a link");
    assert_eq!(
        (origin.as_str(), id.as_str(), key),
        ("https://example.com", "abc_DEF-1", KEY)
    );
    assert!(parse_link("https://example.com/s/abc").is_none());
    assert!(parse_link("https://example.com/s/a/b#xyz").is_none());
}
