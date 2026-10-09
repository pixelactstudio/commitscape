pub mod blame;
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
pub mod similarity;
pub mod source;
pub mod surviving;

pub use build::IndexBuilder;
pub use cache::{
    default_cache_root, load, repo_dir, BlameStore, CacheOptions, Freshness, IdentityStore,
    LineStore, Loaded, Progress, RebuildReason,
};
pub use commitscape_core::LinePass;
pub use gix_source::{GixError, GixRepo, GixThreads};
pub use identity::{resolve_authors, IdentityRules};
pub use lines::line_pass;
pub use mailmap::Mailmap;
pub use scripted::{ScriptedChangeSpec, ScriptedRepo};
pub use source::{
    BlameCommit, BlameSource, BlameThreads, BlobSink, CommitSink, Frontier, HeadChange, HeadEntry,
    InParent, Indexed, LineSink, Moves, RawChange, RawChangeKind, RawCommit, RepoSource, WalkStats,
};
pub use surviving::{Survival, Survived};

use commitscape_core::Index;

/// Builds an Index by walking a repository's whole history.
pub fn index_from_scratch<S: RepoSource>(source: &S) -> Result<Index, S::Error> {
    let mut index = index_incremental(source, &Frontier::default())?;
    index.head = head_pass::head_pass(source, &index.paths, None)?.files;
    index.head_commit = source.head_commit()?;
    Ok(index)
}

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

pub fn reresolve_authors(index: &mut Index, rules: &IdentityRules) {
    let (signatures, used) = std::mem::take(&mut index.authors).into_signatures();
    index.authors = resolve_authors(signatures, used, rules);
}
