//! `cargo xtask npm`: the npm packages of ADR-0003, from built binaries. One
//! package per platform carrying only its binary, and `commitscape`, which
//! depends on all six at exactly its own version and starts the one npm
//! installed. Publish the platform packages first and `commitscape` last.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

/// Every platform: its npm name, Rust target, and npm's `os`, `cpu` and
/// `libc` for it.
pub const PLATFORMS: &[(&str, &str, &str, &str, Option<&str>)] = &[
    (
        "linux-x64-gnu",
        "x86_64-unknown-linux-gnu",
        "linux",
        "x64",
        Some("glibc"),
    ),
    (
        "linux-x64-musl",
        "x86_64-unknown-linux-musl",
        "linux",
        "x64",
        Some("musl"),
    ),
    (
        "linux-arm64",
        "aarch64-unknown-linux-musl",
        "linux",
        "arm64",
        None,
    ),
    ("darwin-x64", "x86_64-apple-darwin", "darwin", "x64", None),
    (
        "darwin-arm64",
        "aarch64-apple-darwin",
        "darwin",
        "arm64",
        None,
    ),
    ("win32-x64", "x86_64-pc-windows-msvc", "win32", "x64", None),
];

/// Both licenses the workspace is offered under, into a package.
fn licenses(root: &Path, dir: &Path) -> Result<()> {
    for file in LICENSES {
        std::fs::copy(root.join(file), dir.join(file))
            .with_context(|| format!("copying {file}"))?;
    }
    Ok(())
}

const LICENSES: [&str; 2] = ["LICENSE-MIT", "LICENSE-APACHE"];

fn json(value: &serde_json::Value) -> Result<String> {
    Ok(format!("{}\n", serde_json::to_string_pretty(value)?))
}

/// Writes the packages under `out` and, with `pack`, packs each with `npm
/// pack`. `binaries` are `name=path` pairs, as `linux-x64-gnu=target/…`;
/// platforms without one get no package.
pub fn run(
    root: &Path,
    out: &Path,
    binaries: &[String],
    repository: Option<&str>,
    pack: bool,
) -> Result<()> {
    // xtask's version is the workspace's: every package carries exactly it.
    let version = env!("CARGO_PKG_VERSION").to_string();
    // npm checks a published package's provenance against its repository.
    let repo =
        repository.map(|url| serde_json::json!({ "type": "git", "url": format!("git+{url}.git") }));
    std::fs::create_dir_all(out)?;
    let mut dirs: Vec<PathBuf> = Vec::new();
    for spec in binaries {
        let (name, path) = spec
            .split_once('=')
            .with_context(|| format!("{spec}: expected <platform>=<binary>"))?;
        let Some(&(_, target, os, cpu, libc)) = PLATFORMS.iter().find(|p| p.0 == name) else {
            bail!(
                "{name} is not one of the platforms: {:?}",
                PLATFORMS.iter().map(|p| p.0).collect::<Vec<_>>()
            );
        };
        let dir = out.join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin"))?;
        let exe = if os == "win32" {
            "commitscape.exe"
        } else {
            "commitscape"
        };
        std::fs::copy(path, dir.join("bin").join(exe))
            .with_context(|| format!("copying {path}"))?;
        let mut manifest = serde_json::json!({
            "name": format!("@commitscape/{name}"),
            "version": version,
            "description": format!("The commitscape binary for {target}. Install `commitscape`, which picks it."),
            "license": "MIT OR Apache-2.0",
            "os": [os],
            "cpu": [cpu],
            "files": [format!("bin/{exe}"), LICENSES[0], LICENSES[1]],
            "preferUnplugged": true,
        });
        if let Some(m) = manifest.as_object_mut() {
            if let Some(libc) = libc {
                m.insert("libc".into(), serde_json::json!([libc]));
            }
            if let Some(repo) = &repo {
                m.insert("repository".into(), repo.clone());
            }
        }
        std::fs::write(dir.join("package.json"), json(&manifest)?)?;
        licenses(root, &dir)?;
        dirs.push(dir);
    }

    // The package people install.
    let main = out.join("commitscape");
    let _ = std::fs::remove_dir_all(&main);
    std::fs::create_dir_all(main.join("bin"))?;
    let source = root.join("npm/commitscape");
    std::fs::copy(
        source.join("bin/commitscape.js"),
        main.join("bin/commitscape.js"),
    )?;
    std::fs::copy(root.join("README.md"), main.join("README.md"))?;
    let mut manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(source.join("package.json"))?)?;
    if let Some(m) = manifest.as_object_mut() {
        m.insert("version".into(), version.clone().into());
        let deps: serde_json::Map<String, serde_json::Value> = PLATFORMS
            .iter()
            .map(|p| (format!("@commitscape/{}", p.0), version.clone().into()))
            .collect();
        m.insert("optionalDependencies".into(), deps.into());
        if let Some(repo) = &repo {
            m.insert("repository".into(), repo.clone());
        }
    }
    std::fs::write(main.join("package.json"), json(&manifest)?)?;
    licenses(root, &main)?;
    dirs.push(main);

    for dir in &dirs {
        println!("{}", dir.display());
        if pack {
            let status = Command::new("npm")
                .args(["pack", "--silent", "--pack-destination"])
                .arg(out)
                .current_dir(dir)
                .status()?;
            if !status.success() {
                bail!("npm pack failed in {}", dir.display());
            }
        }
    }
    Ok(())
}
