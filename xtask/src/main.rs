//! Repository automation. Run with `cargo xtask <command>`.
//!
//! Its jobs: build the synthetic fixture repositories that metric tests
//! assert against, run the benchmark harness that guards the budgets in
//! ADR-0002, assert the crate layering that ADR-0001 depends on, and check the
//! history walk against git on a real repository, and write the npm
//! packages releases publish.

mod bench;
mod changesets;
mod fixtures;
mod layering;
mod line_cost;
mod npm;
mod preview;
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
    /// Write the npm packages (ADR-0003) from built binaries: one per
    /// platform given, and `commitscape`, which depends on all six.
    Npm {
        /// Binaries, as <platform>=<path>: linux-x64-gnu, linux-x64-musl,
        /// linux-arm64, darwin-x64, darwin-arm64, win32-x64.
        #[arg(long = "binary", value_name = "PLATFORM=PATH")]
        binaries: Vec<String>,
        /// Where the packages go.
        #[arg(long, default_value = "target/npm")]
        out: std::path::PathBuf,
        /// The repository's URL, as https://github.com/<owner>/<name>, for
        /// npm's provenance check.
        #[arg(long, value_name = "URL")]
        repository: Option<String>,
        /// Also `npm pack` each into a tarball.
        #[arg(long)]
        pack: bool,
    },
    /// Report changeset sizes and coupling pair-map sizes on real
    /// repositories, the data `--max-changeset-size` is chosen from.
    Changesets {
        /// Repositories to report on.
        repos: Vec<std::path::PathBuf>,
    },
    /// Time the line pass (ADR-0012) over a repository's non-merge commits.
    LineCost {
        repo: std::path::PathBuf,
        /// Only the newest this many commits.
        #[arg(long)]
        newest: Option<usize>,
        /// Compare each count with `git show --numstat` instead of timing.
        #[arg(long)]
        verify: bool,
    },
    /// Render the interface's screens for a repository to SVG and PNG, to
    /// look at while designing it.
    Preview {
        /// The repository to show.
        repo: std::path::PathBuf,
        /// Where the images go.
        #[arg(long, default_value = "target/preview")]
        out: std::path::PathBuf,
        /// Terminal size, as columns x rows.
        #[arg(long, default_value = "130x40")]
        size: String,
        /// The Window: 30d, 90d, 1y or all.
        #[arg(long, default_value = "90d")]
        window: String,
        /// Do not ask GitHub.
        #[arg(long)]
        offline: bool,
        /// Only screens whose name contains this.
        #[arg(long)]
        only: Option<String>,
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
        Command::Npm {
            binaries,
            out,
            repository,
            pack,
        } => {
            let root = workspace_root();
            npm::run(
                &root,
                &root.join(out),
                &binaries,
                repository.as_deref(),
                pack,
            )
        }
        Command::VerifyWalk { repo, every } => verify::run(&repo, every),
        Command::Changesets { repos } => changesets::run(&repos),
        Command::LineCost {
            repo,
            newest,
            verify,
        } => line_cost::run(&repo, newest, verify),
        Command::Preview {
            repo,
            out,
            size,
            window,
            offline,
            only,
        } => {
            let (w, h) = size
                .split_once('x')
                .and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?)))
                .unwrap_or((130, 40));
            preview::run(&repo, &out, (w, h), &window, offline, only.as_deref())
        }
    }
}

/// The workspace root, derived from this crate's manifest location.
pub fn workspace_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf()
}
