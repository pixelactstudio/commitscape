//! The HEAD pass: every file at HEAD read once, measured and classified.
//!
//! This is the only place blob contents are read (ADR-0004). It runs after
//! the history walk, because a file at HEAD is identified by the File
//! Identity the walk resolved for its path.
//!
//! When HEAD moves, the files that changed are found by diffing the old HEAD
//! tree against the new one, so only they are read and nothing else is even
//! listed. If the adapter cannot diff, or a change could alter how other files
//! are classified (a `.gitattributes`, a lockfile or a license file), HEAD is
//! listed in full and files with an unchanged path and blob are carried over.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use commitscape_core::{FileClass, FileId, HeadFile, Oid, PathId, PathTable};
use serde::{Deserialize, Serialize};

use crate::classify::{is_classification_input, nested_projects, Classifier, CLASSIFIER_VERSION};
use crate::hash_index::HashIndex;
use crate::measure::measure;
use crate::source::{HeadEntry, RawChangeKind, RepoSource};

/// What a HEAD table's classes were decided from. Kept with the table so a
/// later pass can classify changed files without listing HEAD again.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ClassifyContext {
    /// The classifier's rules at the time; see [`CLASSIFIER_VERSION`].
    pub version: u32,
    /// Every `.gitattributes` file at HEAD, by path, with its blob.
    pub attribute_files: Vec<(Vec<u8>, Oid)>,
    /// Directories that are other projects' checkouts.
    pub nested_projects: Vec<Vec<u8>>,
}

/// A HEAD table and what its classes were decided from.
pub(crate) struct HeadTable {
    /// Sorted by file.
    pub files: Vec<HeadFile>,
    pub context: ClassifyContext,
}

/// The table a previous pass produced, for HEAD at commit `commit`.
pub(crate) struct Previous<'a> {
    pub files: &'a [HeadFile],
    pub context: &'a ClassifyContext,
    pub commit: Option<Oid>,
}

/// Brings a HEAD table up to date, reading as little as possible.
pub(crate) fn head_pass<S: RepoSource>(
    source: &S,
    paths: &PathTable,
    previous: Option<Previous<'_>>,
) -> Result<HeadTable, S::Error> {
    let current = previous
        .as_ref()
        .filter(|p| p.context.version == CLASSIFIER_VERSION);
    if let Some(prev) = current {
        if let Some(since) = prev.commit {
            if let Some(changes) = source.head_changes(since)? {
                let reclassifies = changes.iter().any(|c| {
                    is_classification_input(&c.entry.path, c.kind != RawChangeKind::Modified)
                });
                if !reclassifies {
                    return apply_changes(source, paths, prev, changes);
                }
            }
        }
    }
    full_pass(source, paths, previous)
}

/// Lists HEAD in full, carrying over files whose path and blob are unchanged
/// when the classification inputs are the same.
fn full_pass<S: RepoSource>(
    source: &S,
    paths: &PathTable,
    previous: Option<Previous<'_>>,
) -> Result<HeadTable, S::Error> {
    let entries = source.head_files()?;
    let live = live_paths(paths);
    let path_of = |entry: &HeadEntry| {
        let hash = xxhash_rust::xxh3::xxh3_64(&entry.path);
        live.get(hash, |id| {
            paths.path_name(PathId(id)) == Some(entry.path.as_slice())
        })
        .map(PathId)
    };

    let context = ClassifyContext {
        version: CLASSIFIER_VERSION,
        attribute_files: attribute_files(entries.iter()),
        nested_projects: nested_projects(entries.iter().map(|e| e.path.as_slice())),
    };
    let (classifier, attribute_bytes) = classifier(source, &context)?;
    let reusable = previous.filter(|p| *p.context == context);

    let mut files: Vec<HeadFile> = Vec::with_capacity(entries.len());
    let mut to_read: Vec<(PathId, &HeadEntry)> = Vec::new();
    for entry in &entries {
        // Every file at HEAD was added by a commit the walk saw. A path it
        // cannot place is skipped rather than invented.
        let Some(path) = path_of(entry) else {
            continue;
        };
        let Some(file) = paths.live_file(path) else {
            continue;
        };
        let carried = reusable.as_ref().and_then(|p| {
            p.files
                .binary_search_by_key(&file, |h| h.file)
                .ok()
                .and_then(|i| p.files.get(i))
                .filter(|h| h.blob == entry.blob && h.path == path)
        });
        // The .gitattributes files were read already, to build the
        // classifier; measure them from those bytes rather than twice.
        match (carried, attribute_bytes.get(&entry.path)) {
            (Some(h), _) => files.push(*h),
            (None, Some(bytes)) => files.push(measure_file(&classifier, file, path, entry, bytes)),
            (None, None) => to_read.push((path, entry)),
        }
    }

    files.extend(read_and_measure(source, paths, &classifier, &to_read)?);
    files.sort_by_key(|h| h.file);
    files.dedup_by_key(|h| h.file);
    Ok(HeadTable { files, context })
}

/// Applies a diff of HEAD to the previous table: removes what was deleted or
/// replaced, and reads only what was added or modified.
fn apply_changes<S: RepoSource>(
    source: &S,
    paths: &PathTable,
    previous: &Previous<'_>,
    changes: Vec<crate::source::HeadChange>,
) -> Result<HeadTable, S::Error> {
    let wanted: HashMap<&[u8], usize> = changes
        .iter()
        .enumerate()
        .map(|(i, c)| (c.entry.path.as_slice(), i))
        .collect();
    let mut path_ids: Vec<Option<PathId>> = vec![None; changes.len()];
    for (id, name) in paths.path_names() {
        if let Some(&i) = wanted.get(name) {
            if let Some(slot) = path_ids.get_mut(i) {
                *slot = Some(id);
            }
        }
    }

    let touched: HashSet<PathId> = path_ids.iter().flatten().copied().collect();
    let mut files: Vec<HeadFile> = previous
        .files
        .iter()
        .filter(|h| !touched.contains(&h.path))
        .copied()
        .collect();

    let (classifier, _) = classifier(source, previous.context)?;
    let to_read: Vec<(PathId, &HeadEntry)> = changes
        .iter()
        .zip(&path_ids)
        .filter(|(c, _)| c.kind != RawChangeKind::Deleted)
        .filter_map(|(c, path)| path.map(|p| (p, &c.entry)))
        .collect();
    let fresh = read_and_measure(source, paths, &classifier, &to_read)?;

    // A file that moved keeps its identity, so its old entry, under the old
    // path, is replaced rather than kept beside the new one.
    let refreshed: HashSet<FileId> = fresh.iter().map(|h| h.file).collect();
    files.retain(|h| !refreshed.contains(&h.file));
    files.extend(fresh);
    files.sort_by_key(|h| h.file);
    Ok(HeadTable {
        files,
        context: previous.context.clone(),
    })
}

/// Reads blobs in parallel and measures each file.
fn read_and_measure<S: RepoSource>(
    source: &S,
    paths: &PathTable,
    classifier: &Classifier,
    to_read: &[(PathId, &HeadEntry)],
) -> Result<Vec<HeadFile>, S::Error> {
    let blobs: Vec<Oid> = to_read.iter().map(|(_, e)| e.blob).collect();
    let measured: Mutex<Vec<Option<HeadFile>>> = Mutex::new(vec![None; to_read.len()]);
    source.read_blobs(&blobs, &|i, contents| {
        let Some((path, entry)) = to_read.get(i) else {
            return;
        };
        let Some(file) = paths.live_file(*path) else {
            return;
        };
        let head = measure_file(classifier, file, *path, entry, contents);
        if let Ok(mut slots) = measured.lock() {
            if let Some(slot) = slots.get_mut(i) {
                *slot = Some(head);
            }
        }
    })?;
    Ok(measured
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .collect())
}

fn measure_file(
    classifier: &Classifier,
    file: FileId,
    path: PathId,
    entry: &HeadEntry,
    contents: &[u8],
) -> HeadFile {
    let class = classifier.classify(&entry.path, contents, entry.symlink);
    let text = !matches!(class, FileClass::Binary | FileClass::Symlink);
    let m = if text {
        measure(contents)
    } else {
        measure(b"")
    };
    HeadFile {
        file,
        path,
        blob: entry.blob,
        bytes: contents.len() as u64,
        loc: m.loc,
        indent_levels: m.indent_levels,
        indent_mean: m.indent_mean,
        indent_stddev: m.indent_stddev,
        class,
    }
}

/// Paths that currently hold a file, by hash.
fn live_paths(paths: &PathTable) -> HashIndex {
    let mut index = HashIndex::default();
    for (id, name) in paths.path_names() {
        if paths.live_file(id).is_some() {
            index.insert(xxhash_rust::xxh3::xxh3_64(name), id.0);
        }
    }
    index
}

fn is_gitattributes(path: &[u8]) -> bool {
    path.rsplit(|&b| b == b'/').next() == Some(b".gitattributes")
}

/// The `.gitattributes` files among some entries, shallowest first so deeper
/// ones override them.
fn attribute_files<'e>(entries: impl Iterator<Item = &'e HeadEntry>) -> Vec<(Vec<u8>, Oid)> {
    let mut found: Vec<(Vec<u8>, Oid)> = entries
        .filter(|e| !e.symlink && is_gitattributes(&e.path))
        .map(|e| (e.path.clone(), e.blob))
        .collect();
    found.sort_by_key(|(p, _)| (p.iter().filter(|&&b| b == b'/').count(), p.clone()));
    found
}

/// The contents of `.gitattributes` files, by path.
type AttributeBytes = HashMap<Vec<u8>, Vec<u8>>;

/// Reads the `.gitattributes` files a context names and builds a classifier.
/// Also returns their contents, by path, so they need not be read twice.
fn classifier<S: RepoSource>(
    source: &S,
    context: &ClassifyContext,
) -> Result<(Classifier, AttributeBytes), S::Error> {
    let blobs: Vec<Oid> = context.attribute_files.iter().map(|(_, b)| *b).collect();
    let contents: Mutex<Vec<Vec<u8>>> = Mutex::new(vec![Vec::new(); blobs.len()]);
    source.read_blobs(&blobs, &|i, bytes| {
        if let Ok(mut c) = contents.lock() {
            if let Some(slot) = c.get_mut(i) {
                *slot = bytes.to_vec();
            }
        }
    })?;
    let contents = contents.into_inner().unwrap_or_default();
    let by_dir: Vec<(Vec<u8>, Vec<u8>)> = context
        .attribute_files
        .iter()
        .zip(&contents)
        .map(|((path, _), bytes)| {
            let dir = path
                .strip_suffix(b".gitattributes")
                .unwrap_or_default()
                .to_vec();
            (dir, bytes.clone())
        })
        .collect();
    let by_path = context
        .attribute_files
        .iter()
        .map(|(p, _)| p.clone())
        .zip(contents)
        .collect();
    Ok((
        Classifier::new(&by_dir, context.nested_projects.clone()),
        by_path,
    ))
}
