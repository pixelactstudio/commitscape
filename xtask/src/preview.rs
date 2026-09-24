//! Renders the interface's screens for a real repository to images, to look
//! at while designing it.
//!
//! Each screen is drawn into ratatui's test backend, written as SVG by
//! `commitscape_tui::svg` (the same renderer `commitscape card` will use),
//! and screenshotted to PNG by headless Chromium when it is installed.

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use commitscape_forge::{GitHub, Remote};
use commitscape_index::{load, CacheOptions, GixRepo, RepoSource, Since};
use commitscape_metrics::{Options, Span};
use commitscape_tui::{App, Command as Work, Event, Session};
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::Terminal;

/// Every screen worth looking at, and the keys that reach it from the
/// Overview.
const SCREENS: &[(&str, &str)] = &[
    ("1-overview", ""),
    ("1b-folder", "enter"),
    ("2-activity", "2"),
    ("3-people", "3"),
    ("3b-person", "3 enter"),
    ("4-map", "4"),
    ("4b-map-age", "4 c"),
    ("4c-map-owners", "4 c c"),
    ("5-risk", "5"),
    ("5b-hotspot-file", "5 enter"),
    ("help", "5 ?"),
];

pub fn run(
    repo: &Path,
    out: &Path,
    (width, height): (u16, u16),
    window: &str,
    offline: bool,
    only: Option<&str>,
) -> Result<()> {
    let span = Span::from_label(window).context("--window takes 30d, 90d, 1y or all")?;
    let git = GixRepo::open(repo).context("opening the repository")?;
    let cache = CacheOptions {
        // The binary's cache when COMMITSCAPE_CACHE_DIR names one, so the
        // preview shows people as the binary resolved them.
        root: Some(
            std::env::var_os("COMMITSCAPE_CACHE_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| crate::workspace_root().join("target").join("preview-cache")),
        ),
    };
    let loaded = load(&git, &cache, Since::All, &mut |_| {}).context("loading the index")?;
    let github = if offline {
        None
    } else {
        git.remote_url()
            .and_then(|url| Remote::parse(&url))
            .and_then(|remote| GitHub::fetch(&remote).ok())
    };
    let name = repo
        .canonicalize()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "repository".to_string());
    let anchor = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let line_store = commitscape_index::LineStore::for_repo(&cache, &loaded.index.repo);
    let session = Session {
        name,
        index: loaded.index,
        anchor,
        span,
        options: Options::default(),
        older: None,
        github: match github {
            Some(g) => Ok(Box::new(move || Ok(g))),
            None => Err("not asked (--offline, or no GitHub remote)".to_string()),
        },
        // People as the cache has them, GitHub's links included.
        people: None,
        link_accounts: None,
        lines: {
            let store = line_store;
            let path = repo.to_path_buf();
            Some(Box::new(move |index: &commitscape_core::Index| {
                let source = GixRepo::open(&path).ok()?;
                commitscape_index::line_pass(&source, index, store.as_ref(), &mut |_, _| {}).ok()
            }))
        },
        theme: commitscape_tui::Theme::Dark,
        releases: {
            let path = repo.to_path_buf();
            Some(Box::new(move || {
                GixRepo::open(&path)
                    .map(|r| r.version_tags())
                    .unwrap_or_default()
            }))
        },
    };
    let (mut app, commands) = App::new(session);
    settle(&mut app, commands);
    std::fs::create_dir_all(out).with_context(|| format!("creating {}", out.display()))?;

    for (screen, keys) in SCREENS {
        if only.is_some_and(|o| !screen.contains(o)) {
            continue;
        }
        // Back to the Overview, whatever was open.
        for key in ["esc", "esc", "esc", "esc", "1"] {
            press(&mut app, key)?;
        }
        for key in keys.split_whitespace() {
            press(&mut app, key)?;
        }
        let mut terminal = Terminal::new(TestBackend::new(width, height))?;
        terminal.draw(|frame| app.draw(frame))?;
        let svg = commitscape_tui::svg(terminal.backend().buffer());
        let svg_path = out.join(format!("{screen}.svg"));
        std::fs::write(&svg_path, svg)?;
        let png = screenshot(&svg_path, u32::from(width) * 9, u32::from(height) * 19)?;
        println!("{}", png.unwrap_or(svg_path).display());
        if let Some(scroll) = keys.split_whitespace().find(|k| *k == "?") {
            let _ = scroll;
            press(&mut app, "esc")?;
        }
    }
    Ok(())
}

fn press(app: &mut App, key: &str) -> Result<()> {
    let code = match key {
        "enter" => KeyCode::Enter,
        "esc" => KeyCode::Esc,
        "up" => KeyCode::Up,
        "down" => KeyCode::Down,
        "left" => KeyCode::Left,
        "right" => KeyCode::Right,
        "tab" => KeyCode::Tab,
        k if k.chars().count() == 1 => KeyCode::Char(k.chars().next().unwrap_or(' ')),
        k => bail!("unknown key {k:?}"),
    };
    let commands = app.update(Event::key(KeyEvent::from(code)));
    settle(app, commands);
    Ok(())
}

fn settle(app: &mut App, mut commands: Vec<Work>) {
    while let Some(command) = commands.pop() {
        let more = app.update(command.run());
        commands.extend(more);
    }
}

/// A PNG of the SVG by headless Chromium, or `None` when it is not
/// installed.
fn screenshot(svg: &Path, width: u32, height: u32) -> Result<Option<std::path::PathBuf>> {
    let png = svg.with_extension("png");
    let url = format!("file://{}", svg.canonicalize()?.display());
    let result = Command::new("chromium")
        .args([
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--hide-scrollbars",
            &format!("--screenshot={}", png.display()),
            &format!("--window-size={width},{height}"),
            &url,
        ])
        .output();
    match result {
        Ok(out) if out.status.success() => Ok(Some(png)),
        _ => Ok(None),
    }
}
