use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result};
use commitscape_report::pack::read_pack;

pub fn run(path: &Path, times: u32) -> Result<()> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let mut best = f64::MAX;
    let mut commits = 0;
    for _ in 0..times.max(1) {
        let started = Instant::now();
        let pack = read_pack(&bytes)?;
        best = best.min(started.elapsed().as_secs_f64());
        commits = pack.index.commits.len();
    }
    println!(
        "{}: {:.1} MB, {commits} commits, read in {best:.3} s (best of {})",
        path.display(),
        bytes.len() as f64 / 1e6,
        times.max(1)
    );
    Ok(())
}
