//! Turns a git repository into a [`commitscape_core::Index`], and caches it.
//!
//! This is the only crate in the workspace that knows git exists. Everything
//! above it sees plain data (ADR-0001).

pub mod build;
pub mod cache;
mod classify;
pub mod gix_source;
mod hash_index;
mod head_pass;
pub mod identity;
pub mod lines;
pub mod mailmap;
pub mod measure;
mod message;
pub mod scripted;
pub mod source;

pub use build::IndexBuilder;
pub use cache::{
    default_cache_root, load, CacheOptions, Freshness, IdentityStore, LineStore, Loaded,
    OlderHistory, Progress, RebuildReason, Rest, RestUnavailable, Since,
};
pub use commitscape_core::LinePass;
pub use gix_source::{GixError, GixRepo};
pub use identity::{resolve_authors, IdentityRules};
pub use lines::line_pass;
pub use mailmap::Mailmap;
pub use scripted::{ScriptedChangeSpec, ScriptedRepo};
pub use source::{
    BlobSink, CommitSink, Frontier, HeadChange, HeadEntry, Indexed, LineSink, RawChange,
    RawChangeKind, RawCommit, RepoSource, WalkStats,
};

use commitscape_core::Index;

/// Indexes a repository from scratch, history and HEAD, without a cache.
///
/// Generic over [`RepoSource`] so the same path is exercised by the real gix
/// adapter and by the scripted fake.
pub fn index_from_scratch<S: RepoSource>(source: &S) -> Result<Index, S::Error> {
    let mut index = index_incremental(source, &Frontier::default())?;
    index.head = head_pass::head_pass(source, &index.paths, None)?.files;
    index.head_commit = source.head_commit()?;
    Ok(index)
}

/// Indexes everything reachable that is not already `indexed`.
pub fn index_incremental<S: RepoSource>(
    source: &S,
    indexed: &dyn Indexed,
) -> Result<Index, S::Error> {
    let identity = source.identity()?;
    let mut builder = IndexBuilder::new(IdentityRules::from_mailmap(source.mailmap()?));
    let stats = source.walk_history(indexed, &mut builder)?;
    let tips = source.tips()?;
    Ok(builder.finish(identity, tips, stats.history_truncated))
}

/// Re-resolves an existing index's people.
///
/// Commits store the signature they were made under, not a resolved person,
/// so a `.mailmap` edit, a GitHub link or an undo changes a small table and
/// never re-reads history.
pub fn reresolve_authors(index: &mut Index, rules: &IdentityRules) {
    let (signatures, used) = std::mem::take(&mut index.authors).into_signatures();
    index.authors = resolve_authors(signatures, used, rules);
}
