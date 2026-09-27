//! `commitscape share` (ADR-0016): builds the Report on this machine, locks
//! it with a key that exists only in the link it prints, uploads what the
//! Site cannot read, and exits. `--delete` takes it down; `--list` shows
//! the ones this machine made, kept in the cache directory.
//!
//! The lock is AES-256-GCM: a fresh random 256-bit key and a random 96-bit
//! nonce, the upload being the nonce then the ciphertext and its tag. The
//! Delete Token is derived from the key (HKDF-SHA256, info "commitscape
//! delete"); the Site keeps only its SHA-256, so the link alone can delete.

use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit};
use clap::Args;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

use crate::{gzip, make_report, Common};

/// The largest upload the Site takes, in bytes (ADR-0016).
pub const MAX_BYTES: usize = 25 * 1024 * 1024;

#[derive(Args)]
pub struct ShareArgs {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// How long the link works, in hours: 1 to 12.
    #[arg(long, value_name = "HOURS", default_value_t = 4, value_parser = clap::value_parser!(u32).range(1..=12))]
    expires: u32,

    /// Upload without asking first.
    #[arg(long)]
    yes: bool,

    /// Take down a Shared Report: give the link `share` printed.
    #[arg(long, value_name = "LINK", conflicts_with_all = ["list", "yes"])]
    delete: Option<String>,

    /// List the Shared Reports this machine made, and when each expires.
    #[arg(long, conflicts_with = "yes")]
    list: bool,

    #[command(flatten)]
    common: Common,
}

/// Where the Site is: `COMMITSCAPE_SITE`, or the origin this binary was
/// built with (`packages/data/src/product.ts`).
pub fn site() -> String {
    std::env::var("COMMITSCAPE_SITE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| env!("COMMITSCAPE_SITE_ORIGIN").to_string())
        .trim_end_matches('/')
        .to_string()
}

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Base64url without padding, as links and the Site write ids and keys.
pub fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk.first().copied().unwrap_or(0),
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let chars = chunk.len() + 1;
        for i in 0..chars {
            let index = ((n >> (18 - 6 * i)) & 63) as usize;
            out.push(char::from(BASE64URL.get(index).copied().unwrap_or(b'A')));
        }
    }
    out
}

/// Reads base64url, with or without padding.
pub fn unbase64url(text: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut count = 0;
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    for c in text.trim_end_matches('=').bytes() {
        let value = BASE64URL.iter().position(|&b| b == c)? as u32;
        bits = (bits << 6) | value;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    Some(out)
}

/// The Delete Token for a key: HKDF-SHA256, no salt, info "commitscape
/// delete", 32 bytes, as base64url.
pub fn delete_token(key: &[u8; 32]) -> String {
    let mut out = [0u8; 32];
    // 32 bytes is far inside HKDF-SHA256's limit of 8,160.
    let _ = Hkdf::<Sha256>::new(None, key).expand(b"commitscape delete", &mut out);
    base64url(&out)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Locks bytes: the nonce, then the ciphertext and its tag.
pub fn lock(key: &[u8; 32], nonce: &[u8; 12], plain: &[u8]) -> anyhow::Result<Vec<u8>> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| anyhow::anyhow!("a key is 32 bytes"))?;
    let sealed = cipher
        .encrypt(nonce.into(), plain)
        .map_err(|_| anyhow::anyhow!("the Report could not be locked"))?;
    let mut out = Vec::with_capacity(12 + sealed.len());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Unlocks what [`lock`] wrote, or fails when a byte was changed. The
/// browser does this (WebCrypto); here for the tests.
#[cfg(test)]
pub fn unlock(key: &[u8; 32], locked: &[u8]) -> Option<Vec<u8>> {
    let (nonce, sealed) = locked.split_at_checked(12)?;
    let nonce: &[u8; 12] = nonce.try_into().ok()?;
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher.decrypt(nonce.into(), sealed).ok()
}

/// The id and key in a Shared Report's link: `<site>/s/<id>#<key>`.
fn parse_link(link: &str) -> Option<(String, String, [u8; 32])> {
    let (before, key) = link.split_once('#')?;
    let (origin, id) = before.rsplit_once("/s/")?;
    let key: [u8; 32] = unbase64url(key)?.try_into().ok()?;
    let id_ok = !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    id_ok.then(|| (origin.to_string(), id.to_string(), key))
}

/// A Shared Report this machine made.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Made {
    link: String,
    name: String,
    expires_at: i64,
}

/// The list of Shared Reports made here, in the cache directory; none with
/// `--no-cache`.
fn list_file(common: &Common) -> Option<PathBuf> {
    common.cache().root.map(|root| root.join("shares.json"))
}

fn read_list(common: &Common) -> Vec<Made> {
    list_file(common)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_list(common: &Common, list: &[Made]) {
    if let Some(path) = list_file(common) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = write_private(&path, &serde_json::to_vec_pretty(list).unwrap_or_default());
    }
}

/// Writes a file only its owner can read, where the system allows it: the
/// list's links each hold their key. One written before is made so too.
fn write_private(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut open = std::fs::OpenOptions::new();
    open.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut open, 0o600);
    let mut file = open.open(path)?;
    #[cfg(unix)]
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    file.write_all(bytes)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .user_agent(concat!("commitscape/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// What the Site said, in its words when it gave them.
fn said(status: u16, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("the Site answered {status}"))
}

/// A Shared Report uploaded: its link and when it stops working.
pub struct Shared {
    pub link: String,
    pub expires_at: i64,
}

/// Locks a Report's data and uploads it (ADR-0016). Used by the command
/// and by the local page's Share button.
pub fn upload(name: &str, json: &str, hours: u32, common: &Common) -> anyhow::Result<Shared> {
    let plain = gzip(json.as_bytes())?;
    let mut key = [0u8; 32];
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut key).map_err(|e| anyhow::anyhow!("no randomness here: {e}"))?;
    getrandom::fill(&mut nonce).map_err(|e| anyhow::anyhow!("no randomness here: {e}"))?;
    let locked = lock(&key, &nonce, &plain)?;
    anyhow::ensure!(
        locked.len() <= MAX_BYTES,
        "this Report is {} MB locked, over the Site's 25 MB: run commitscape report for a file to send instead",
        locked.len() / (1024 * 1024)
    );
    let site = site();
    let agent = agent();
    let delete_hash = hex(&Sha256::digest(delete_token(&key).as_bytes()));
    let create =
        serde_json::json!({ "bytes": locked.len(), "hours": hours, "deleteHash": delete_hash });
    let mut response = agent
        .post(format!("{site}/api/shares"))
        .header("content-type", "application/json")
        .send(create.to_string())
        .map_err(|e| anyhow::anyhow!("the Site at {site} could not be reached: {e}"))?;
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    anyhow::ensure!(status == 201, "{}", said(status, &body));
    let made: serde_json::Value = serde_json::from_str(&body)?;
    let field = |name: &str| made.get(name).cloned().unwrap_or_default();
    let id = field("id").as_str().unwrap_or_default().to_string();
    let token = field("uploadToken")
        .as_str()
        .unwrap_or_default()
        .to_string();
    let expires_at = field("expiresAt").as_i64().unwrap_or_default();
    let mut response = agent
        .put(format!("{site}/api/shares/{id}"))
        .header("content-type", "application/octet-stream")
        .header("x-upload-token", &token)
        .send(&locked[..])
        .map_err(|e| anyhow::anyhow!("the upload to {site} failed: {e}"))?;
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    anyhow::ensure!(status == 200, "{}", said(status, &body));
    let link = format!("{site}/s/{id}#{}", base64url(&key));
    let mut list = read_list(common);
    list.retain(|m| m.expires_at > crate::now());
    list.push(Made {
        link: link.clone(),
        name: name.to_string(),
        expires_at,
    });
    write_list(common, &list);
    Ok(Shared { link, expires_at })
}

/// Takes a Shared Report down, with the Delete Token its link's key gives.
pub fn delete(link: &str, common: &Common) -> anyhow::Result<()> {
    let (origin, id, key) = parse_link(link).ok_or_else(|| {
        anyhow::anyhow!("that is not a Shared Report's link: it is <site>/s/<id>#<key>")
    })?;
    let mut response = agent()
        .delete(format!("{origin}/api/shares/{id}"))
        .header("x-delete-token", &delete_token(&key))
        .call()
        .map_err(|e| anyhow::anyhow!("the Site at {origin} could not be reached: {e}"))?;
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    let mut list = read_list(common);
    list.retain(|m| !m.link.contains(&format!("/s/{id}#")));
    write_list(common, &list);
    match status {
        200 => Ok(()),
        404 | 410 => {
            println!("It was already gone.");
            Ok(())
        }
        _ => Err(anyhow::anyhow!("{}", said(status, &body))),
    }
}

/// When a time is, in words: `in 3 h 20 min`.
fn from_now(at: i64) -> String {
    let left = (at - crate::now()).max(0);
    let (h, m) = (left / 3600, (left % 3600) / 60);
    if h > 0 {
        format!("in {h} h {m} min")
    } else {
        format!("in {m} min")
    }
}

/// The local page's Share button (ADR-0016): the same as the command, with
/// its confirmation given by the button.
pub fn hook(
    repo: PathBuf,
    common: Common,
    window: commitscape_metrics::Span,
) -> commitscape_web::ShareReport {
    std::sync::Arc::new(move |hours| {
        let (name, report) =
            make_report(&repo, &common, window, true, false).map_err(|e| format!("{e:#}"))?;
        let json = commitscape_web::report::data(report);
        upload(&name, &json, hours, &common)
            .map(|s| (s.link, s.expires_at))
            .map_err(|e| format!("{e:#}"))
    })
}

pub fn run(args: ShareArgs) -> anyhow::Result<()> {
    if args.list {
        let list: Vec<Made> = read_list(&args.common)
            .into_iter()
            .filter(|m| m.expires_at > crate::now())
            .collect();
        if list.is_empty() {
            println!("No Shared Report from this machine is still up.");
        }
        for m in list {
            println!(
                "{}  expires {}\n  {}",
                m.name,
                from_now(m.expires_at),
                m.link
            );
        }
        return Ok(());
    }
    if let Some(link) = &args.delete {
        delete(link, &args.common)?;
        println!("Deleted: the link no longer opens anything.");
        return Ok(());
    }
    anyhow::ensure!(
        !args.common.offline,
        "share uploads to the Site, which --offline forbids"
    );
    let site = site();
    let (name, report) = make_report(
        &args.repo,
        &args.common,
        commitscape_metrics::Span::Quarter,
        true,
        false,
    )?;
    let json = commitscape_web::report::data(report);
    if !args.yes {
        eprintln!(
            "This uploads {name}'s Report to {site}, locked with a key only the link will hold: \
             its file paths, people's names and GitHub logins, and commit subject lines. No email \
             addresses. The Site cannot read it. The link works for {} hours.",
            args.expires
        );
        anyhow::ensure!(
            std::io::stdin().is_terminal(),
            "nothing uploaded: to upload without being asked, pass --yes"
        );
        eprint!("Upload it? [y/N] ");
        let _ = std::io::stderr().flush();
        let mut answer = String::new();
        std::io::stdin().lock().read_line(&mut answer)?;
        if !matches!(answer.trim(), "y" | "Y" | "yes") {
            eprintln!("Nothing was uploaded.");
            return Ok(());
        }
    }
    let shared = upload(&name, &json, args.expires, &args.common)?;
    println!("{}", shared.link);
    eprintln!(
        "It works in any browser and expires {}. Its page has a Delete button, or: commitscape share --delete <link>",
        from_now(shared.expires_at)
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // One vector shared with packages/data's tests, so the browser unlocks
    // and deletes exactly as this does.
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
}
