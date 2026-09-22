//! Repository automation. Run with `cargo xtask <command>`.
//!
//! Four jobs: build the synthetic fixture repositories that metric tests
//! assert against, run the benchmark harness that guards the budgets in
//! ADR-0002, assert the crate layering that ADR-0001 depends on, and check the
//! history walk against git on a real repository.

mod bench;
mod changesets;
mod fixtures;
mod layering;
mod verify;

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
    /// Report changeset sizes and coupling pair-map sizes on real
    /// repositories, the data `--max-changeset-size` is chosen from.
    Changesets {
        /// Repositories to report on.
        repos: Vec<std::path::PathBuf>,
    },
    /// Check the history walk against `git diff-tree` on a real repository.
    VerifyWalk {
        /// The repository to check.
        repo: std::path::PathBuf,
        /// Check one commit in this many (merges are sampled separately).
        #[arg(long, default_value_t = 100)]
        every: u64,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Fixtures { force } => fixtures::build(force),
        Command::Bench { filter, iterations } => bench::run(filter.as_deref(), iterations),
        Command::CheckLayering => layering::check(),
        Command::VerifyWalk { repo, every } => verify::run(&repo, every),
        Command::Changesets { repos } => changesets::run(&repos),
    }
}

/// The workspace root, derived from this crate's manifest location.
pub fn workspace_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf()
}
