//! The data model every other `commitscape` crate is written against.
//!
//! This crate deliberately has no I/O, no git, and no terminal. It exists so
//! that `commitscape-metrics` can be written against the index without
//! acquiring a transitive dependency on `gix` — see ADR-0001. If you are about
//! to add a dependency here, check that it does not pull in git.

mod ids;
mod index;
mod oid;
mod time;

pub use ids::{AuthorId, CommitIx, DirId, FileId, PathId, SignatureId};
pub use index::{
    Author, AuthorRef, AuthorTable, ChangeKind, CommitFlags, CommitMeta, FileChange, FileClass,
    FileHistory, HeadFile, HistorySpan, Index, LineDelta, PathEvent, PathTable, RepoIdentity,
    Signature, SignatureRef, SCHEMA_VERSION,
};
pub use oid::Oid;
pub use time::{civil_from_unix, Month};
