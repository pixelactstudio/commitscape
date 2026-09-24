//! `commitscape wrapped [folder]`: your year across every repository under a
//! folder, as a page and a card. Only your own commits, under every address
//! you commit with; private repositories included, and nothing leaves the
//! machine.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use clap::Args;
use commitscape_core::{AuthorId, Index};
use commitscape_index::{line_pass_where, load, GixRepo, LineStore, RepoSource, Since};
use commitscape_metrics::{wrapped, Analysis, Window, YearIn};
use commitscape_web::api::{Language, RepoCommits, WrappedYear};

use crate::{now, Common};

const DAY: i64 = 86_400;
/// How deep under the folder repositories are looked for.
const DEPTH: usize = 4;

#[derive(Args)]
pub struct WrappedArgs {
    /// The folder to look for repositories in. Defaults to the current one.
    #[arg(default_value = ".")]
    folder: PathBuf,

    /// The year. Defaults to this one.
    #[arg(long)]
    year: Option<i32>,

    /// Another address you commit with; git's user.email is used anyway.
    #[arg(long = "email", value_name = "ADDRESS")]
    emails: Vec<String>,

    /// Where to write the page and the card. Defaults to here.
    #[arg(long, value_name = "DIR")]
    out: Option<PathBuf>,

    /// Leave out lines added and removed, so nothing is counted.
    #[arg(long)]
    no_lines: bool,

    #[command(flatten)]
    common: Common,
}

/// Every repository under `folder`, not looking inside one once found, nor
/// in folders that hold dependencies or builds.
fn repositories(folder: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if dir.join(".git").exists() {
            out.push(dir.to_path_buf());
            return;
        }
        if depth == 0 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.path())
            .filter(|p| {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                !name.starts_with('.')
                    && !["node_modules", "target", "dist", "build", "vendor"]
                        .contains(&name.as_str())
            })
            .collect();
        dirs.sort();
        for d in dirs {
            walk(&d, depth - 1, out);
        }
    }
    let mut out = Vec::new();
    walk(folder, DEPTH, &mut out);
    out
}

/// Everyone in a repository who is you: one of their addresses is yours.
/// A name alone is not enough: other people share names.
fn me(index: &Index, emails: &HashSet<String>) -> Vec<AuthorId> {
    let authors = &index.authors;
    authors
        .iter()
        .filter(|(id, _)| {
            authors
                .addresses_of(*id)
                .iter()
                .any(|(e, _)| emails.contains(&e.to_ascii_lowercase()))
        })
        .map(|(id, _)| id)
        .collect()
}

/// Addresses that commit under your name and are not counted as you: ones
/// you may want to add with `--email`.
fn maybe_yours(index: &Index, emails: &HashSet<String>, name: &str, out: &mut HashSet<String>) {
    let authors = &index.authors;
    for (id, a) in authors.iter() {
        if a.name.eq_ignore_ascii_case(name) {
            for (e, _) in authors.addresses_of(id) {
                if !emails.contains(&e.to_ascii_lowercase()) {
                    out.insert(e);
                }
            }
        }
    }
}

pub fn run(args: WrappedArgs) -> anyhow::Result<()> {
    let options = args.common.cache();
    let today = now();
    let (this_year, _, _) = commitscape_core::civil_from_unix(today);
    let year = args.year.unwrap_or(this_year as i32);
    let start = commitscape_core::parse_iso8601(&format!("{year:04}-01-01T00:00:00Z"))
        .ok_or_else(|| anyhow::anyhow!("{year} is not a year this can read"))?;
    let next = commitscape_core::parse_iso8601(&format!("{:04}-01-01T00:00:00Z", year + 1))
        .ok_or_else(|| anyhow::anyhow!("{year} is not a year this can read"))?;
    let end = (next - 1).min(today);
    // Wide enough for the year on every clock, which can be 14 hours
    // either side of UTC; each commit is then placed by its own.
    let window = Window {
        from: Some(start - 14 * 3600),
        to: end + 14 * 3600,
    };
    let (first_day, last_day) = (start.div_euclid(DAY), end.div_euclid(DAY));

    let found = repositories(&args.folder);
    anyhow::ensure!(
        !found.is_empty(),
        "no git repositories under {}",
        args.folder.display()
    );
    // Who you are, from every repository's configuration first: one can
    // set another address than the rest.
    let repos: Vec<(PathBuf, GixRepo)> = found
        .iter()
        .filter_map(|p| GixRepo::open(p).ok().map(|r| (p.clone(), r)))
        .collect();
    let mut emails: HashSet<String> = args.emails.iter().map(|e| e.to_ascii_lowercase()).collect();
    let mut name: Option<String> = None;
    for (_, repo) in &repos {
        let (email, user) = repo.user();
        emails.extend(email.map(|e| e.to_ascii_lowercase()));
        name = name.or(user);
    }
    anyhow::ensure!(
        !emails.is_empty(),
        "git has no user.email for these repositories: say who you are with --email ADDRESS"
    );
    let mut skipped: Vec<String> = found
        .iter()
        .filter(|p| !repos.iter().any(|(r, _)| r == *p))
        .map(|p| p.display().to_string())
        .collect();

    // Read each repository's year, leaving out those with no commits.
    let since = Since::Time(window.from.unwrap_or(start));
    let mut loaded = Vec::new();
    for (n, (path, repo)) in repos.iter().enumerate() {
        let label = std::fs::canonicalize(path)
            .unwrap_or_else(|_| path.clone())
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        eprint!("\r\x1b[2K[{}/{}] {label}", n + 1, repos.len());
        if repo.head_commit().ok().flatten().is_none() {
            continue;
        }
        match load(repo, &options, since, &mut |_| {}) {
            Ok(l) => loaded.push((label, repo, l)),
            Err(_) => skipped.push(label),
        }
    }
    eprint!("\r\x1b[2K");

    // An address that is you in one repository is you in all of them: a
    // GitHub account or a .mailmap joins it to yours there.
    loop {
        let before = emails.len();
        for (_, _, l) in &loaded {
            for id in me(&l.index, &emails) {
                emails.extend(
                    l.index
                        .authors
                        .addresses_of(id)
                        .into_iter()
                        .map(|(e, _)| e.to_ascii_lowercase()),
                );
            }
        }
        if emails.len() == before {
            break;
        }
    }

    let mut parts: Vec<(String, YearIn)> = Vec::new();
    let mut maybe: HashSet<String> = HashSet::new();
    // A commit counted once: a clone or a worktree of a repository holds
    // the same commits again.
    let mut counted: HashSet<commitscape_core::Oid> = HashSet::new();
    for (label, repo, mut loaded) in loaded {
        if let Some(name) = &name {
            maybe_yours(&loaded.index, &emails, name, &mut maybe);
        }
        let mine = me(&loaded.index, &emails);
        if mine.is_empty() {
            parts.push((label, YearIn::default()));
            continue;
        }
        if !args.no_lines {
            // Only this year's commits of yours are counted, and kept.
            let index = &loaded.index;
            let wanted = |c: &commitscape_core::CommitMeta| {
                window.contains(c.time) && index.author_of(c).is_some_and(|a| mine.contains(&a))
            };
            let store = LineStore::for_repo(&options, &index.repo);
            if let Ok(pass) = line_pass_where(repo, index, store.as_ref(), &wanted, &mut |_, _| {})
            {
                pass.apply(&mut loaded.index);
            }
        }
        let Ok(analysis) = Analysis::new(&loaded.index, window, args.common.metrics()) else {
            skipped.push(label);
            continue;
        };
        let year = analysis.year_in(&mine, first_day..=last_day, &|c| !counted.contains(&c.id));
        counted.extend(
            loaded
                .index
                .commits
                .iter()
                .filter(|c| loaded.index.author_of(c).is_some_and(|a| mine.contains(&a)))
                .map(|c| c.id),
        );
        parts.push((label, year));
    }

    let w = wrapped(&parts);
    let mut page = WrappedYear {
        title: match &name {
            Some(n) => format!("{n}'s {year} in code"),
            None => format!("Your {year} in code"),
        },
        name: name.clone().unwrap_or_default(),
        year,
        looked_in: parts.len() as u32,
        commits: w.commits,
        active_days: w.active_days,
        repositories: w
            .repositories
            .iter()
            .map(|r| RepoCommits {
                name: r.name.clone(),
                commits: r.commits,
            })
            .collect(),
        lines_added: w.lines_added,
        lines_removed: w.lines_removed,
        languages: w
            .languages
            .iter()
            .map(|l| Language {
                name: l.name.clone(),
                lines: l.lines,
            })
            .collect(),
        busiest_day: w.busiest_day.map(|d| d.day),
        busiest_commits: w.busiest_day.map_or(0, |d| d.commits),
        streak_days: w.streak.map_or(0, |s| s.days),
        streak_from: w.streak.map(|s| s.first_day),
        night: w.night,
        hours: w.hours.to_vec(),
        first_day,
        days: (first_day..=last_day)
            .map(|d| w.days.get(&d).copied().unwrap_or(0))
            .collect(),
        card: String::new(),
    };
    page.card = commitscape_web::wrapped_card::card(&page);

    let dir = args.out.unwrap_or_else(|| PathBuf::from("."));
    std::fs::create_dir_all(&dir)?;
    let html = dir.join(format!("wrapped-{year}.html"));
    let svg = dir.join(format!("wrapped-{year}-card.svg"));
    std::fs::write(&html, commitscape_web::report::wrapped_page(&page))?;
    std::fs::write(&svg, &page.card)?;
    println!(
        "{year}: {} commits in {} of {} repositories, on {} days.",
        page.commits,
        page.repositories.len(),
        page.looked_in,
        page.active_days
    );
    println!("wrote {}\nwrote {}", html.display(), svg.display());
    if !skipped.is_empty() {
        println!("Could not read, so left out: {}.", skipped.join(", "));
    }
    if !maybe.is_empty() {
        let mut maybe: Vec<String> = maybe.into_iter().collect();
        maybe.sort();
        println!(
            "Commits under your name from other addresses were not counted. If they are yours, add: {}",
            maybe.iter().map(|e| format!("--email {e}")).collect::<Vec<_>>().join(" ")
        );
    }
    if !commitscape_web::built() {
        eprintln!("This build has no web app, so the page only says how to build one; the card is complete.");
    }
    Ok(())
}
