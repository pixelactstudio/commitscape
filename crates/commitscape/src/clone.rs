use std::path::{Path, PathBuf};
use std::process::Command;

use commitscape_forge::Remote;

pub fn remote(url: &str) -> Option<Remote> {
    let remote = Remote::parse(url).or_else(|| {
        let (owner, name) = url.trim_matches('/').split_once('/')?;
        (!name.contains('/'))
            .then(|| Remote::parse(&format!("https://github.com/{owner}/{name}")))?
    })?;
    let allowed = |s: &str| {
        !s.is_empty()
            && !s.starts_with('.')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    (allowed(&remote.owner) && allowed(&remote.name)).then_some(remote)
}

fn git(args: &[&str], dir: Option<&Path>) -> anyhow::Result<()> {
    let mut cmd = Command::new("git");
    if let Some(dir) = dir {
        cmd.arg("-C").arg(dir);
    }
    let status = cmd
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                anyhow::anyhow!("git must be installed to clone the project")
            }
            _ => e.into(),
        })?;
    anyhow::ensure!(
        status.success(),
        "git {} failed",
        args.first().unwrap_or(&"")
    );
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clone {
    Partial,
    Full,
}

pub fn clone(remote: &Remote, root: &Path, how: Clone) -> anyhow::Result<PathBuf> {
    let kind = match how {
        Clone::Partial => "health",
        Clone::Full => "clones",
    };
    let dir = root.join(kind).join(&remote.owner).join(&remote.name);
    let base =
        std::env::var("COMMITSCAPE_GIT_BASE").unwrap_or_else(|_| "https://github.com".to_string());
    let url = format!(
        "{}/{}/{}.git",
        base.trim_end_matches('/'),
        remote.owner,
        remote.name
    );
    if dir.join(".git").exists() {
        eprintln!("Bringing {}/{} up to date…", remote.owner, remote.name);
        git(
            &["fetch", "--quiet", "--prune", "--tags", "origin"],
            Some(&dir),
        )?;
        git(&["reset", "--quiet", "--hard", "origin/HEAD"], Some(&dir))?;
    } else {
        eprintln!(
            "Cloning {}/{}{} into the cache…",
            remote.owner,
            remote.name,
            if how == Clone::Partial {
                " (history only)"
            } else {
                ""
            }
        );
        if let Some(parent) = dir.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let target = dir.to_string_lossy().into_owned();
        let mut args = vec!["clone", "--quiet"];
        if how == Clone::Partial {
            args.push("--filter=blob:none");
        }
        args.extend([url.as_str(), target.as_str()]);
        git(&args, None)?;
    }
    Ok(dir)
}
