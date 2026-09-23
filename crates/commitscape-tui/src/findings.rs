//! What the Panels show for one Window.
//!
//! Computed once when a Window is chosen, never while drawing: on Linux,
//! recomputing Ownership and the Hotspots every frame took 13ms.

use commitscape_metrics::{
    Analysis, CommitCounts, Coupling, Hotspot, Ownership, QuarterAge, Staleness,
    SuspectedDuplicate, Window,
};

pub(crate) struct Findings {
    pub window: Window,
    pub counts: CommitCounts,
    pub hotspots: Vec<Hotspot>,
    pub coupling: Coupling,
    pub ownership: Ownership,
    pub staleness: Staleness,
    pub code_age: Vec<QuarterAge>,
    pub duplicates: Vec<SuspectedDuplicate>,
}

impl Findings {
    pub fn of(analysis: &Analysis<'_>) -> Findings {
        Findings {
            window: analysis.window(),
            counts: analysis.commits(),
            hotspots: analysis.hotspots(),
            coupling: analysis.coupling(),
            ownership: analysis.ownership(),
            staleness: analysis.staleness(),
            code_age: analysis.code_age(),
            duplicates: analysis.suspected_duplicates(),
        }
    }

    /// Files people wrote at HEAD: every file Staleness places.
    pub fn files(&self) -> u32 {
        self.staleness.buckets.iter().map(|b| b.files).sum()
    }
}
