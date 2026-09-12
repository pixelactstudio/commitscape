//! Turns a git repository into a [`commitscape_core::Index`], and caches it.
//!
//! This is the only crate in the workspace that knows git exists. Everything
//! above it sees plain data (ADR-0001).
