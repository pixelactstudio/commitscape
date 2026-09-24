//! Which interface opens, and the browser one's server (ADR-0010).

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

/// The port the browser interface tries first, so a forwarded port or a
/// bookmark keeps working from one run to the next. Another is picked when
/// it is taken.
pub const DEFAULT_PORT: u16 = 7878;

/// Whether a browser can be opened from here: `$BROWSER` names one (VS Code
/// and Cursor set it over Remote-SSH, and forward the port), or there is a
/// desktop to open one on.
pub fn can_open_browser() -> bool {
    if std::env::var_os("BROWSER").is_some_and(|b| !b.is_empty()) {
        return true;
    }
    if cfg!(any(target_os = "macos", windows)) {
        return std::env::var_os("SSH_CONNECTION").is_none();
    }
    ["DISPLAY", "WAYLAND_DISPLAY"]
        .iter()
        .any(|v| std::env::var_os(v).is_some_and(|d| !d.is_empty()))
}

/// Opens `url` in a browser, without waiting for it. False when there was
/// nothing to open it with.
pub fn open(url: &str) -> bool {
    let browser = std::env::var("BROWSER").ok().filter(|b| !b.is_empty());
    let mut command = match browser {
        // `$BROWSER` may list several, separated by colons.
        Some(b) => {
            let first = b.split(':').next().unwrap_or(&b).to_string();
            let mut c = std::process::Command::new(first);
            c.arg(url);
            c
        }
        None if cfg!(target_os = "macos") => {
            let mut c = std::process::Command::new("open");
            c.arg(url);
            c
        }
        None if cfg!(windows) => {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", "start", "", url]);
            c
        }
        None => {
            let mut c = std::process::Command::new("xdg-open");
            c.arg(url);
            c
        }
    };
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}

/// Where to listen: `--listen`'s address, or this machine only, on `--port`
/// or the default port.
pub fn address(listen: Option<IpAddr>, port: Option<u16>) -> SocketAddr {
    let ip = listen.unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    SocketAddr::new(ip, port.unwrap_or(DEFAULT_PORT))
}

/// This machine's name, for the `Host` header of a server reached over a
/// network, and for the `ssh -L` line.
pub fn machine() -> Option<String> {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
}

/// What to paste on a laptop to reach a server on this machine over plain
/// SSH, when this is an SSH session.
pub fn ssh_hint(port: u16) -> Option<String> {
    std::env::var_os("SSH_CONNECTION")?;
    let user = std::env::var("USER").unwrap_or_else(|_| "you".to_string());
    let host = machine().unwrap_or_else(|| "this-machine".to_string());
    Some(format!("ssh -N -L {port}:127.0.0.1:{port} {user}@{host}"))
}
