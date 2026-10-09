use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use clap::Args;
use commitscape_core::Index;
use commitscape_index::{default_cache_root, load, CacheOptions, GixRepo, Mailmap, RepoSource};
use serde::Serialize;

use crate::ProgressLine;

#[derive(Args)]
pub struct SignaturesArgs {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// Where to write the JSON.
    #[arg(long, value_name = "FILE")]
    out: PathBuf,

    /// Where to keep the index cache. Defaults to COMMITSCAPE_CACHE_DIR, then
    /// the platform's cache directory.
    #[arg(long, value_name = "DIR")]
    cache_dir: Option<PathBuf>,

    /// Index from scratch and neither read nor write a cache.
    #[arg(long)]
    no_cache: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Address {
    pub email: String,
    pub name: String,
    pub commits: u32,
    pub sha: String,
}

/// Every author address in an Index after the mailmap, most commits first, with its usual name and its newest commit.
pub fn addresses(index: &Index, mailmap: &Mailmap) -> Vec<Address> {
    struct Seen {
        commits: u32,
        sha: String,
        names: HashMap<String, (u32, usize)>,
    }
    let mut by_email: BTreeMap<String, Seen> = BTreeMap::new();
    for (age, c) in index.commits.iter().rev().enumerate() {
        let Some(sig) = index.authors.signature(c.signature) else {
            continue;
        };
        let (name, email) = mailmap.resolve(sig.name.as_bytes(), sig.email.as_bytes());
        let email = String::from_utf8_lossy(email).to_ascii_lowercase();
        let name = String::from_utf8_lossy(name).into_owned();
        let seen = by_email.entry(email).or_insert_with(|| Seen {
            commits: 0,
            sha: c.id.to_string(),
            names: HashMap::new(),
        });
        seen.commits += 1;
        let n = seen.names.entry(name).or_insert((0, age));
        n.0 += 1;
    }
    let mut out: Vec<Address> = by_email
        .into_iter()
        .map(|(email, seen)| {
            let name = seen
                .names
                .into_iter()
                .max_by(|a, b| a.1 .0.cmp(&b.1 .0).then(b.1 .1.cmp(&a.1 .1)))
                .map(|(name, _)| name)
                .unwrap_or_default();
            Address {
                email,
                name,
                commits: seen.commits,
                sha: seen.sha,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.commits
            .cmp(&a.commits)
            .then_with(|| a.email.cmp(&b.email))
    });
    out
}

/// `commitscape signatures`: writes every author address in the history as JSON.
pub fn run(args: SignaturesArgs) -> anyhow::Result<()> {
    let options = CacheOptions {
        root: if args.no_cache {
            None
        } else {
            args.cache_dir.clone().or_else(default_cache_root)
        },
    };
    let repo = GixRepo::open(&args.repo)?;
    let mut meter = ProgressLine::new();
    let loaded = load(&repo, &options, &mut |p| meter.show(p))?;
    meter.clear();
    let list = addresses(&loaded.index, &repo.mailmap()?);
    std::fs::write(&args.out, serde_json::to_vec(&list)?)?;
    println!("wrote {}", args.out.display());
    Ok(())
}
