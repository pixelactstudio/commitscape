//! Dense integer identities.
//!
//! Every table in the index is a `Vec` indexed by one of these. They are
//! newtypes rather than bare `u32` because mixing a `FileId` with an `AuthorId`
//! is otherwise a silent, plausible-looking bug.

use serde::{Deserialize, Serialize};

macro_rules! dense_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        pub struct $name(pub u32);

        impl $name {
            /// Position in the table this id indexes.
            #[inline]
            pub fn idx(self) -> usize {
                self.0 as usize
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

dense_id!(
    FileId,
    "Identifies a file across its whole history, including through exact renames.\n\n\
     This is *not* a path. A file that moved from `a/x.rs` to `b/x.rs` without changing\n\
     content keeps one `FileId` across the move, which is what stops a reorganisation\n\
     from severing a file's history (ADR-0004)."
);

dense_id!(
    PathId,
    "Identifies one path string, exactly as git recorded it.\n\n\
     Distinct from [`FileId`]: a path is where a file lives at some moment, and one file\n\
     can live at several paths over its history. Changes record the file, not the path;\n\
     the path table records which paths each file has lived at."
);

dense_id!(
    AuthorId,
    "Identifies one person, after the several git identities they commit under have\n\
     been resolved together (ADR-0006)."
);

dense_id!(
    SignatureId,
    "Identifies one name-and-email pair exactly as it appears in commits.\n\n\
     Commits store this, not an [`AuthorId`]. Which person a signature belongs to is a\n\
     resolution applied on top (mailmap plus two rules), so a `.mailmap` edit re-resolves\n\
     a table of signatures instead of re-walking history."
);

dense_id!(
    CommitIx,
    "Position of a commit within the index's time-ordered commit array.\n\n\
     The ordering invariant — ascending commit time — is what makes a time window a\n\
     contiguous range, and therefore what makes the cache body range-readable (ADR-0002)."
);

dense_id!(
    DirId,
    "Identifies a directory within the index's directory table."
);
