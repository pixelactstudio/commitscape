//! `commitscape` binary entry point.

use clap::Parser;

#[derive(Parser)]
#[command(
    name = "commitscape",
    version,
    about = "Reads a git repository and reports what changes what you do next."
)]
struct Cli {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: std::path::PathBuf,
}

fn main() -> anyhow::Result<()> {
    let _cli = Cli::parse();
    // The TUI is Phase 7 and the --json path is Phase 6. Until one of them
    // exists this binary does nothing except prove it can start, which is what
    // the `startup` benchmark measures.
    Ok(())
}
