//! Reads the Site's origin from `packages/data/src/product.ts`, where it is
//! kept once for the whole repository (ADR-0014), so `commitscape share`
//! uploads where the Site is. `COMMITSCAPE_SITE` overrides it when running.

use std::path::PathBuf;

fn main() {
    let file = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("../../packages/data/src/product.ts");
    println!("cargo:rerun-if-changed={}", file.display());
    let origin = std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| {
            let line = text
                .lines()
                .find(|l| l.trim_start().starts_with("export const SITE_ORIGIN"))?
                .to_string();
            let start = line.find('"')? + 1;
            let end = line.rfind('"')?;
            line.get(start..end).map(str::to_string)
        })
        .unwrap_or_else(|| "https://commitscape.invalid".to_string());
    println!("cargo:rustc-env=COMMITSCAPE_SITE_ORIGIN={origin}");
}
