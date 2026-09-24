//! The JSON the web app reads. These types are the API: TypeScript types
//! are generated from them (`web/src/api/types.ts`) and a test fails when
//! the two drift apart.
//!
//! Times are seconds since the Unix epoch; days are whole days since it.
//! Counts that are not known are `null`, never 0.

use commitscape_core::Index;
use commitscape_metrics::{Analysis, Span};
use serde::Serialize;

/// What the server holds and is still working on.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Meta {
    /// The repository's name.
    pub name: String,
    /// Every Window, shortest first: `30d`, `90d`, `1y`, `all`.
    pub windows: Vec<String>,
    /// The Window to open on.
    pub window: String,
    /// Where the Windows end: now, when the server started.
    pub anchor: i64,
    /// Whether all of history is loaded: `loading`, `complete`, or
    /// `unavailable`.
    pub history: String,
    /// The line pass: `counting`, `counted`, or `off`.
    pub lines: String,
    /// GitHub: `asking`, `ready`, or why there is nothing (`unavailable:
    /// <reason>`).
    pub github: String,
    /// Bumped whenever anything above, or the people, changes: data asked
    /// for with an older one is out of date.
    pub generation: u32,
}

/// The repository at a glance, over one Window.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Overview {
    pub window: String,
    pub totals: Totals,
    /// Lines of code by language at HEAD, largest first.
    pub languages: Vec<Language>,
    /// The Window's commits that are not merges.
    pub commits: u32,
    /// Days with at least one of them.
    pub active_days: u32,
    /// Commits per day, from `first_day`.
    pub first_day: i64,
    pub days: Vec<u32>,
    /// Who made them, most first. Bots are left out.
    pub people: Vec<PersonCommits>,
}

/// The repository in numbers, whatever the Window.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Totals {
    pub commits: u64,
    pub merges: u64,
    pub people: u32,
    pub files: u32,
    pub code_files: u32,
    pub code_lines: u64,
    pub prose_lines: u64,
    pub first_commit: Option<i64>,
    pub last_commit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Language {
    pub name: String,
    pub lines: u64,
}

/// One person and their commits in the Window.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PersonCommits {
    /// Stable while the people are: changes when a merge is undone.
    pub id: u32,
    pub name: String,
    pub commits: u32,
}

impl Overview {
    pub fn of(analysis: &Analysis<'_>, span: Span) -> Overview {
        let index: &Index = analysis.index();
        let t = analysis.totals();
        let pulse = analysis.pulse_in_time(None);
        Overview {
            window: span.label().to_string(),
            totals: Totals {
                commits: t.commits,
                merges: t.merges,
                people: t.people as u32,
                files: t.files,
                code_files: t.code_files,
                code_lines: t.code_lines,
                prose_lines: t.prose_lines,
                first_commit: t.first_commit,
                last_commit: t.last_commit,
            },
            languages: analysis
                .languages()
                .languages
                .iter()
                .map(|l| Language {
                    name: l.name.to_string(),
                    lines: l.lines,
                })
                .collect(),
            commits: pulse.commits,
            active_days: pulse.active_days,
            first_day: pulse.first_day,
            days: pulse.days,
            people: analysis
                .contributors()
                .iter()
                .map(|c| PersonCommits {
                    id: c.author.0,
                    name: index
                        .authors
                        .get(c.author)
                        .map(|a| a.name.to_string())
                        .unwrap_or_default(),
                    commits: c.commits,
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod types {
    //! The TypeScript the web app is written against, generated from the
    //! types above. `COMMITSCAPE_UPDATE_TYPES=1 cargo test -p
    //! commitscape-web` rewrites it after a deliberate change.

    use ts_rs::{Config, TS};

    use super::*;

    fn generated() -> String {
        let cfg = Config::new().with_large_int("number");
        let mut out = String::from(
            "// Generated from crates/commitscape-web/src/api.rs by its tests. Do not edit.\n",
        );
        for decl in [
            Meta::decl(&cfg),
            Overview::decl(&cfg),
            Totals::decl(&cfg),
            Language::decl(&cfg),
            PersonCommits::decl(&cfg),
        ] {
            out.push_str("\nexport ");
            out.push_str(&decl);
            out.push('\n');
        }
        out
    }

    #[test]
    fn the_web_apps_types_match_the_api() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/src/api/types.ts");
        let now = generated();
        if std::env::var_os("COMMITSCAPE_UPDATE_TYPES").is_some() {
            let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
            let _ = std::fs::write(&path, &now);
            return;
        }
        let written = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            written == now,
            "web/src/api/types.ts is out of date: run COMMITSCAPE_UPDATE_TYPES=1 cargo test -p commitscape-web"
        );
    }
}
