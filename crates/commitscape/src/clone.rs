use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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
        if let Some(parent) = dir.parent() {
            cmd.env("GIT_CEILING_DIRECTORIES", parent);
        }
    }
    let status = cmd
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::null())
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

/// Clones a GitHub project into the cache, or brings an earlier clone up to date, and returns its folder.
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
    let name = format!("{}/{}", remote.owner, remote.name);
    clone_into(&url, &dir, how, &name)?;
    Ok(dir)
}

fn clone_into(url: &str, dir: &Path, how: Clone, name: &str) -> anyhow::Result<()> {
    if dir.join(".git").exists() {
        eprintln!("Bringing {name} up to date…");
        match update(dir) {
            Ok(()) => return Ok(()),
            Err(e) => eprintln!("The clone of {name} is broken ({e}); cloning it again…"),
        }
    }
    eprintln!(
        "Cloning {name}{} into the cache…",
        if how == Clone::Partial {
            " (history only)"
        } else {
            ""
        }
    );
    fresh(url, dir, how)
}

fn update(dir: &Path) -> anyhow::Result<()> {
    git(&["rev-parse", "--quiet", "--verify", "HEAD"], Some(dir))?;
    git(
        &["fetch", "--quiet", "--prune", "--tags", "origin"],
        Some(dir),
    )?;
    git(&["reset", "--quiet", "--hard", "origin/HEAD"], Some(dir))
}

fn unfinished(dir: &Path) -> anyhow::Result<PathBuf> {
    let parent = dir
        .parent()
        .ok_or_else(|| anyhow::anyhow!("{} has no parent folder", dir.display()))?;
    let name = dir
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("{} has no name", dir.display()))?;
    Ok(parent.join(format!(".{}.cloning", name.to_string_lossy())))
}

fn remove(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn fresh(url: &str, dir: &Path, how: Clone) -> anyhow::Result<()> {
    let temp = unfinished(dir)?;
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    remove(&temp)?;
    let target = temp.to_string_lossy().into_owned();
    let mut args = vec!["clone", "--quiet"];
    if how == Clone::Partial {
        args.push("--filter=blob:none");
    }
    args.extend([url, target.as_str()]);
    if let Err(e) = git(&args, None) {
        let _ = remove(&temp);
        return Err(e);
    }
    remove(dir)?;
    std::fs::rename(&temp, dir)?;
    Ok(())
}

#[cfg(test)]
#[path = "../tests/unit/clone.rs"]
mod tests;
