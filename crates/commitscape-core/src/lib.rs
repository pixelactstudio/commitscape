//! The data model every other `commitscape` crate is written against.
//!
//! This crate deliberately has no I/O, no git, and no terminal. It exists so
//! that [`commitscape_metrics`] can be written against the index without
//! acquiring a transitive dependency on `gix` — see ADR-0001. If you are about
//! to add a dependency here, check that it does not pull in git.

/// Identifies a file across its whole history, including through exact renames.
///
/// This is *not* a path. A file that moved from `a/x.rs` to `b/x.rs` without
/// changing content keeps one `FileId` across the move, which is what stops a
/// reorganisation from severing a file's history (ADR-0004).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileId(pub u32);

/// Identifies one person, after the several git identities they commit under
/// have been resolved together (ADR-0006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AuthorId(pub u32);

/// Position of a commit within the index's time-ordered commit array.
///
/// The ordering invariant — ascending commit time — is what makes a time
/// window a contiguous range, and therefore what makes the cache body
/// range-readable (ADR-0002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CommitIx(pub u32);

/// Identifies a directory within the index's directory table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DirId(pub u32);
