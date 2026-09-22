//! Turns a git repository into a [`commitscape_core::Index`], and caches it.
//!
//! This is the only crate in the workspace that knows git exists. Everything
//! above it sees plain data (ADR-0001).

pub mod build;
pub mod gix_source;
pub mod identity;
pub mod mailmap;
pub mod scripted;
pub mod source;

pub use build::IndexBuilder;
pub use gix_source::{GixError, GixRepo};
pub use identity::resolve_authors;
pub use mailmap::Mailmap;
pub use scripted::{ScriptedChangeSpec, ScriptedRepo};
pub use source::{
    CommitSink, Frontier, RawChange, RawChangeKind, RawCommit, RepoSource, TreeSink, WalkStats,
};

use commitscape_core::Index;

/// Indexes a repository from scratch.
///
/// Generic over [`RepoSource`] so the same path is exercised by the real gix
/// adapter and by the scripted fake.
pub fn index_from_scratch<S: RepoSource>(source: &S) -> Result<Index, S::Error> {
    index_incremental(source, &Frontier::default())
}

/// Indexes everything reachable that is not already in `frontier`.
pub fn index_incremental<S: RepoSource>(
    source: &S,
    frontier: &Frontier,
) -> Result<Index, S::Error> {
    let identity = source.identity()?;
    let mailmap = source.mailmap()?;
    let mut builder = IndexBuilder::new(mailmap);
    let stats = source.walk_history(frontier, &mut builder)?;
    let tips = source.tips()?;
    Ok(builder.finish(identity, tips, stats.history_truncated))
}

/// Re-applies a mailmap to an existing index.
///
/// Commits store the signature they were made under, not a resolved person,
/// so a `.mailmap` edit changes a small table and never re-reads history.
pub fn reresolve_authors(index: &mut Index, mailmap: &Mailmap) {
    let signatures = std::mem::take(&mut index.authors).into_signatures();
    let mut used = vec![0u32; signatures.len()];
    for c in &index.commits {
        if let Some(n) = used.get_mut(c.signature.idx()) {
            *n += 1;
        }
    }
    index.authors = resolve_authors(signatures, &used, mailmap);
}
