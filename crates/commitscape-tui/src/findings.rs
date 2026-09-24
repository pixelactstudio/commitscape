//! What the Panels show for one Window.
//!
//! Computed once when a Window is chosen, off the main thread, never while
//! drawing: on Linux, recomputing Ownership and the Hotspots every frame
//! took 13ms.

use commitscape_metrics::{
    Analysis, Churn, CodeMap, CommitCounts, Contributor, Coupling, Hotspot, Languages, LargeFile,
    MapNode, Ownership, Pulse, QuarterAge, Staleness, SuspectedDuplicate, Totals, Window,
};

pub(crate) struct Findings {
    pub window: Window,
    pub counts: CommitCounts,
    pub totals: Totals,
    pub languages: Languages,
    pub pulse: Pulse,
    pub contributors: Vec<Contributor>,
    /// Automation accounts, left out of `contributors`.
    pub bots: Vec<Contributor>,
    pub churn: Vec<Churn>,
    pub hotspots: Vec<Hotspot>,
    pub largest: Vec<LargeFile>,
    pub coupling: Coupling,
    pub ownership: Ownership,
    pub staleness: Staleness,
    pub code_age: Vec<QuarterAge>,
    pub duplicates: Vec<SuspectedDuplicate>,
    /// The Map, once laid out. The first Window's comes after the first
    /// frame: on Linux it takes 70ms, most of the 100ms that frame has.
    pub map: Option<CodeMap>,
}

impl Findings {
    /// Everything for a Window.
    pub fn of(analysis: &Analysis<'_>) -> Findings {
        Findings {
            map: Some(analysis.code_map()),
            ..Findings::without_map(analysis)
        }
    }

    /// Everything but the Map: what the first frame needs.
    ///
    /// The parts are independent, and on Linux Ownership, the languages and
    /// the suspected duplicates take about 10ms each, so those three run
    /// beside the rest: 40ms one after another, about 15 side by side.
    pub fn without_map(analysis: &Analysis<'_>) -> Findings {
        std::thread::scope(|s| {
            let ownership = s.spawn(|| analysis.ownership());
            let languages = s.spawn(|| analysis.languages());
            let duplicates = s.spawn(|| analysis.suspected_duplicates());
            // Fields are computed in the order written, so the threads'
            // answers are waited for last.
            Findings {
                window: analysis.window(),
                counts: analysis.commits(),
                totals: analysis.totals(),
                pulse: analysis.pulse(None),
                contributors: analysis.contributors(),
                bots: analysis.bots(),
                churn: analysis.churn(),
                hotspots: analysis.hotspots(),
                largest: analysis.largest(),
                coupling: analysis.coupling(),
                staleness: analysis.staleness(),
                code_age: analysis.code_age(),
                map: None,
                ownership: joined(ownership),
                languages: joined(languages),
                duplicates: joined(duplicates),
            }
        })
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
