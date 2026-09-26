//! Embeds the built web app, `apps/local/dist`, in the binary: one download,
//! and no Node at run time (ADR-0010, ADR-0013). Without a build, a page saying how to make
//! one is served instead, so `cargo build` alone still works.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

fn main() {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("../../apps/local/dist");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    files.sort();
    let mut out = String::from("/// The web app's files, by the path they are served at.\npub(crate) static FILES: &[(&str, &[u8])] = &[\n");
    for (url, path) in &files {
        let _ = writeln!(
            out,
            "    ({url:?}, include_bytes!({:?})),",
            path.display().to_string()
        );
    }
    out.push_str("];\n");
    let dest = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default()).join("assets.rs");
    let _ = std::fs::write(dest, out);
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            let url = format!("/{}", rel.to_string_lossy().replace('\\', "/"));
            let abs = path.canonicalize().unwrap_or(path);
            out.push((url, abs));
        }
    }
}
