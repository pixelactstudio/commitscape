//! Repository automation. Run with `cargo xtask <command>`.
//!
//! Three jobs: build the synthetic fixture repositories that metric tests
//! assert against, run the benchmark harness that guards the budgets in
//! ADR-0002, and assert the crate layering that ADR-0001 depends on.

mod bench;
mod fixtures;
mod layering;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "xtask", about = "commitscape repository automation")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build the synthetic fixture repositories under `fixtures/`.
    ///
    /// Every fixture has hand-worked expected values recorded in
    /// `fixtures/SPEC.md`. Tests assert those literals; they must never
    /// recompute them.
    Fixtures {
        /// Rebuild even if the fixture directory already exists.
        #[arg(long)]
        force: bool,
    },
    /// Run the benchmark harness and record the numbers.
    Bench {
        /// Run only benchmarks whose name contains this substring.
        #[arg(long)]
        filter: Option<String>,
        /// Override the iteration count. Slow benchmarks default to 1.
        #[arg(long)]
        iterations: Option<u32>,
    },
    /// Assert that the metrics crate cannot see git.
    CheckLayering,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Fixtures { force } => fixtures::build(force),
        Command::Bench { filter, iterations } => bench::run(filter.as_deref(), iterations),
        Command::CheckLayering => layering::check(),
    }
}

/// The workspace root, derived from this crate's manifest location.
pub fn workspace_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf()
}
