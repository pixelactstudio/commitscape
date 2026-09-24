//! What the Panels show for one Window.
//!
//! Computed once when a Window is chosen, off the main thread, never while
//! drawing: on Linux, recomputing Ownership and the Hotspots every frame
//! took 13ms.

use commitscape_metrics::{
    Analysis, ChangeGroup, Churn, CodeMap, CommitCounts, CommitsByPerson, Contribution,
    Contributor, Coupling, Hotspot, Languages, LargeFile, MapNode, Ownership, Pulse, QuarterAge,
    Silo, Staleness, SuspectedDuplicate, Totals, Window,
};

/// The people a chart of commits over time tells apart; everyone else is
/// one grey series.
pub(crate) const PEOPLE_SHOWN: usize = 5;

pub(crate) struct Findings {
    pub window: Window,
    pub counts: CommitCounts,
    pub totals: Totals,
    pub languages: Languages,
    pub pulse: Pulse,
    pub contributors: Vec<Contributor>,
    /// Automation accounts, left out of `contributors`.
    pub bots: Vec<Contributor>,
    /// Each contributor's commits, lines and areas, in the same order.
    pub contributions: Vec<Contribution>,
    pub lines_by_person: Vec<(
        commitscape_core::AuthorId,
        commitscape_metrics::LinesChanged,
    )>,
    pub churn: Vec<Churn>,
    pub hotspots: Vec<Hotspot>,
    pub largest: Vec<LargeFile>,
    pub coupling: Coupling,
    pub ownership: Ownership,
    pub staleness: Staleness,
    pub code_age: Vec<QuarterAge>,
    pub duplicates: Vec<SuspectedDuplicate>,
    /// Sets of files that change together.
    pub groups: Vec<ChangeGroup>,
    /// Folders only one person touched.
    pub silos: Vec<Silo>,
    /// Commits per day among the five who made the most, and everyone else.
    pub by_person: CommitsByPerson,
    /// The Map, once laid out. The first Window's comes after the first
    /// frame: on Linux it takes 70ms, most of the 100ms that frame has.
    pub map: Option<CodeMap>,
}

impl Findings {
    /// Everything for a Window.
    pub fn of(analysis: &Analysis<'_>) -> Findings {
        let mut f = Findings {
            map: Some(analysis.code_map()),
            ..Findings::without_map(analysis)
        };
        f.pulse.work = analysis.work(None);
        f
    }

    /// Everything but the Map and the kinds of work: what the first frame
    /// needs. On Linux the kinds of work take 6 ms, judging every changed
    /// file's role, and come with the Map instead.
    ///
    /// The parts are independent, and on Linux Ownership, the languages and
    /// the suspected duplicates take about 10ms each, so those three run
    /// beside the rest: 40ms one after another, about 15 side by side.
    pub fn without_map(analysis: &Analysis<'_>) -> Findings {
        let mut f = std::thread::scope(|s| {
            // The folders one person knows follow from Ownership, and the
            // groups of files from Coupling, on the same threads.
            let ownership = s.spawn(|| {
                let o = analysis.ownership();
                let silos = analysis.silos_in(&o);
                (o, silos)
            });
            let coupling = s.spawn(|| {
                let c = analysis.coupling();
                let groups = analysis.change_groups_in(&c);
                (c, groups)
            });
            let languages = s.spawn(|| analysis.languages());
            let duplicates = s.spawn(|| analysis.suspected_duplicates());
            let lines = s.spawn(|| analysis.lines_by_person());
            let pulse = analysis.pulse_in_time(None);
            let contributors = analysis.contributors();
            let by_person = analysis.commits_by_person_in(&pulse, &contributors, PEOPLE_SHOWN);
            let (window, counts, totals, bots) = (
                analysis.window(),
                analysis.commits(),
                analysis.totals(),
                analysis.bots(),
            );
            let (churn, hotspots, largest) =
                (analysis.churn(), analysis.hotspots(), analysis.largest());
            let (staleness, code_age) = (analysis.staleness(), analysis.code_age());
            // The threads' answers are waited for last, once everything this
            // thread computes is done.
            let (ownership, silos) = joined(ownership);
            let (coupling, groups) = joined(coupling);
            Findings {
                window,
                counts,
                totals,
                pulse,
                contributors,
                bots,
                contributions: Vec::new(),
                groups,
                silos,
                by_person,
                churn,
                hotspots,
                largest,
                coupling,
                staleness,
                code_age,
                map: None,
                ownership,
                languages: joined(languages),
                duplicates: joined(duplicates),
                lines_by_person: joined(lines),
            }
        });
        f.contributions =
            commitscape_metrics::combine(&f.contributors, &f.ownership, &f.lines_by_person);
        f
    }

    /// The Map's folders and files, none until it is laid out.
    pub fn nodes(&self) -> &[MapNode] {
        self.map.as_ref().map_or(&[], |m| &m.nodes)
    }

    /// Files people wrote at HEAD: every file Staleness places.
    pub fn files(&self) -> u32 {
        self.staleness.buckets.iter().map(|b| b.files).sum()
    }
}

/// A scoped thread's answer, or its panic carried on.
fn joined<T>(handle: std::thread::ScopedJoinHandle<'_, T>) -> T {
    handle
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
}
