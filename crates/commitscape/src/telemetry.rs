use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_millis(1500);

/// One counted run of a command: what it was, when it started and the anonymous id of this install.
pub struct Run {
    command: &'static str,
    started: Instant,
    id: String,
    first: bool,
}

/// Whether usage counts are sent: on unless `COMMITSCAPE_TELEMETRY` turns them off or `DO_NOT_TRACK` asks not to be tracked.
pub fn enabled(get: impl Fn(&str) -> Option<String>) -> bool {
    let off = |v: Option<String>, words: &[&str]| {
        v.is_some_and(|v| words.contains(&v.trim().to_ascii_lowercase().as_str()))
    };
    !off(get("COMMITSCAPE_TELEMETRY"), &["0", "false", "off", "no"])
        && !off(get("DO_NOT_TRACK"), &["1", "true", "yes"])
}

fn read_id(path: &Path) -> Option<String> {
    let id = std::fs::read_to_string(path).ok()?.trim().to_string();
    (id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())).then_some(id)
}

fn new_id(path: &Path) -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(path, &id).ok()?;
    Some(id)
}

fn id_file() -> Option<PathBuf> {
    commitscape_index::default_cache_root().map(|root| root.join("telemetry-id"))
}

fn notice(site: &str) -> String {
    format!(
        "commitscape counts how it is used, to get better: which command ran, how long it took, \
         how it ended, the version and your platform, under a random id. Nothing about your \
         repositories is sent. Turn it off with COMMITSCAPE_TELEMETRY=0. More: {site}/privacy#command"
    )
}

/// Starts counting a run of a command people use, when counts are on; the first run of an install says what is counted.
pub fn start(command: Option<&'static str>) -> Option<Run> {
    let command = command?;
    if !enabled(|k| std::env::var(k).ok()) {
        return None;
    }
    let path = id_file()?;
    let (id, first) = match read_id(&path) {
        Some(id) => (id, false),
        None => (new_id(&path)?, true),
    };
    if first {
        eprintln!("{}", notice(&crate::share::site()));
    }
    Some(Run {
        command,
        started: Instant::now(),
        id,
        first,
    })
}

/// What one run sends: never a path, a repository or anything from one.
pub fn payload(run: &Run, ok: bool, seconds: f64, ci: bool, terminal: bool) -> serde_json::Value {
    serde_json::json!({
        "id": run.id,
        "command": run.command,
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "outcome": if ok { "ok" } else { "error" },
        "seconds": (seconds * 10.0).round() / 10.0,
        "ci": ci,
        "terminal": terminal,
        "first": run.first,
    })
}

impl Run {
    /// Sends how the run ended to the Site, waiting at most a moment and never failing the command.
    pub fn finish(self, ok: bool) {
        let ci = std::env::var("CI").is_ok_and(|v| !v.is_empty() && v != "false");
        let body = payload(
            &self,
            ok,
            self.started.elapsed().as_secs_f64(),
            ci,
            std::io::stderr().is_terminal(),
        );
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(TIMEOUT))
            .user_agent(concat!("commitscape/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let _ = agent
            .post(format!("{}/api/telemetry", crate::share::site()))
            .header("content-type", "application/json")
            .send(body.to_string());
    }
}

#[cfg(test)]
#[path = "../tests/unit/telemetry.rs"]
mod tests;
