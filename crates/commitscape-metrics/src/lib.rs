//! Pure functions over an [`commitscape_core::Index`].
//!
//! No I/O, no git, no terminal. Every metric returns its inputs alongside its
//! output so the presentation layer can explain any number it draws.
//!
//! Everything is computed by an [`Analysis`]: one Index, one Window, one set
//! of [`Options`]. Changing the Window or a threshold means a new Analysis
//! over the same Index, which is milliseconds; the Index itself never changes
//! for a filter (ADR-0002).

mod ages;
mod analysis;
mod code_map;
mod coupling;
mod languages;
mod people;
mod pulse;
mod roles;
mod window;

pub use ages::{Age, AgeCount, QuarterAge, StaleFile, Staleness};
pub use analysis::{
    Analysis, Churn, CommitCounts, Hotspot, LargeFile, NotLoaded, Options, Rank, Totals,
    RANKING_LIMIT,
};
pub use code_map::{CodeMap, MapNode};
pub use coupling::{ChangesetSizes, CoupledPair, Coupling, SizeBucket};
pub use languages::{Language, Languages};
pub use people::{Contributor, DirectoryOwnership, Owner, Ownership, SuspectedDuplicate};
pub use pulse::{KindCount, Pulse, Streak};
pub use roles::{role_of, Role};
pub use window::{Span, Window};
