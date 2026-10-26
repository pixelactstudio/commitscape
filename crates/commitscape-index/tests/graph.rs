#![allow(clippy::expect_used, clippy::indexing_slicing)]

use std::path::PathBuf;

use commitscape_core::{Index, Oid};
use commitscape_index::graph::{CommitGraph, Kept};
use commitscape_index::mainline::REACHABLE;
use commitscape_index::{
    index_from_scratch, load, mainline, CacheOptions, GixRepo, Loaded, RepoSource, ScriptedRepo,
};

const A: (&str, &str) = ("Ada", "ada@example.com");

type Step = fn(ScriptedRepo) -> ScriptedRepo;

const STEPS: &[Step] = &[
    |r| r.commit(10, A, &[]),
    |r| r.commit(20, A, &[]),
    |r| r.at(1).commit(15, A, &[]).at(2),
    |r| r.merge(30, A, 3, &[]),
    |r| r.commit(40, A, &[]),
    |r| r.at(4).commit(35, A, &[]).at(5),
    |r| r.commit(50, A, &[]),
    |r| r.merge(60, A, 6, &[]),
    |r| r.commit(65, A, &[]),
    |r| r.at(6).merge(70, A, 9, &[]),
    |r| r.commit(80, A, &[]),
    |r| {
        r.at(10)
            .commit(85, A, &[])
            .at(11)
            .commit(90, A, &[])
            .merge(95, A, 12, &[])
    },
];

fn grown(steps: usize) -> ScriptedRepo {
    STEPS
        .iter()
        .take(steps)
        .fold(ScriptedRepo::new(), |r, step| step(r))
}

fn loaded(repo: &ScriptedRepo, options: &CacheOptions) -> Loaded {
    match load(repo, options, &mut |_| {}) {
        Ok(l) => l,
        Err(never) => match never {},
    }
}

fn graph(repo: &ScriptedRepo, options: &CacheOptions, l: &Loaded) -> CommitGraph {
    match CommitGraph::of(repo, options, &l.index, l.lineage) {
        Ok(g) => g,
        Err(never) => match never {},
    }
}

fn oracle(repo: &ScriptedRepo, index: &Index) -> commitscape_index::Mainline {
    match mainline(repo, index) {
        Ok(m) => m,
        Err(never) => match never {},
    }
}

fn scratch(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("commitscape-graph-{name}-{nanos}"))
}

#[test]
fn the_kept_graph_gives_the_mainline_git_gives_at_every_head_as_the_history_grows() {
    let root = scratch("grows");
    let options = CacheOptions {
        root: Some(root.clone()),
        key: None,
    };
    let mut before: Option<Oid> = None;
    let mut kinds = Vec::new();
    for steps in 1..=STEPS.len() {
        let repo = grown(steps);
        let l = loaded(&repo, &options);
        let mut g = graph(&repo, &options, &l);
        kinds.push(g.kept);
        let (found, moved) = g.mainline_since(&l.index, before);
        g.keep(&l.index);
        let want = oracle(&repo, &l.index);
        assert_eq!(found, want, "the Mainline after step {steps}");
        if let Some(was) = before {
            let k = (1..=l.index.commits.len() as u32)
                .find(|&k| repo.commit_id(k) == was)
                .expect("the earlier head");
            let then = oracle(&grown(steps).at(k), &l.index);
            let expected: Vec<bool> = (0..l.index.commits.len())
                .map(|i| (want.bits[i], want.arrival[i]) != (then.bits[i], then.arrival[i]))
                .collect();
            assert_eq!(moved, Some(expected), "what moved at step {steps}");
        }
        let tips = repo.tips().expect("tips");
        assert_eq!(
            g.reached_from(&l.index, &tips),
            Some(vec![true; l.index.commits.len()]),
            "every commit is reached from the tips at step {steps}"
        );
        before = l.index.head_commit;
    }
    assert_eq!(kinds.first(), Some(&Kept::Made));
    assert!(
        kinds
            .iter()
            .skip(1)
            .all(|k| matches!(k, Kept::Updated { .. })),
        "{kinds:?}"
    );
    let repo = grown(STEPS.len());
    let l = loaded(&repo, &options);
    assert_eq!(graph(&repo, &options, &l).kept, Kept::Same);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_history_written_again_makes_the_graph_again() {
    let root = scratch("rewritten");
    let options = CacheOptions {
        root: Some(root.clone()),
        key: None,
    };
    let first = grown(5);
    let l = loaded(&first, &options);
    let mut g = graph(&first, &options, &l);
    g.mainline_since(&l.index, None);
    g.keep(&l.index);
    let other = ScriptedRepo::new()
        .commit(11, A, &[])
        .commit(21, A, &[])
        .commit(31, A, &[]);
    let l = loaded(&other, &options);
    let mut g = graph(&other, &options, &l);
    assert_eq!(g.kept, Kept::Made);
    assert_eq!(g.mainline_since(&l.index, None).0, oracle(&other, &l.index));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn commits_the_frontier_reaches_are_the_ones_it_reaches_in_git() {
    let repo = grown(8);
    let index = index_from_scratch(&repo).expect("indexing");
    let options = CacheOptions::default();
    let g = match CommitGraph::of(&repo, &options, &index, 1) {
        Ok(g) => g,
        Err(never) => match never {},
    };
    let from = [repo.commit_id(3), repo.commit_id(5)];
    let reached = g.reached_from(&index, &from).expect("in the Index");
    let names: Vec<u32> = (1..=8)
        .filter(|&k| {
            let at = index
                .commits
                .iter()
                .position(|c| c.id == repo.commit_id(k))
                .expect("indexed");
            reached[at]
        })
        .collect();
    assert_eq!(names, vec![1, 2, 3, 4, 5]);
    assert_eq!(g.reached_from(&index, &[Oid([7; 20])]), None);
}

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

#[test]
fn the_graph_gives_the_mainline_git_gives_on_every_fixture() {
    let mut reachable = 0;
    for name in [
        "linear",
        "coupling",
        "ownership",
        "renames",
        "bulk",
        "merges",
        "conflict",
        "rhythm",
        "lines",
        "survival",
        "detached",
        "tags",
        "bare.git",
    ] {
        let dir = fixture(name);
        let repo = GixRepo::open(&dir).expect("opening fixture");
        let index = index_from_scratch(&repo).expect("indexing fixture");
        let mut g = CommitGraph::of(&repo, &CacheOptions::default(), &index, 1).expect("graph");
        let (found, _) = g.mainline_since(&index, None);
        let want = mainline(&repo, &index).expect("the mainline");
        assert_eq!(found, want, "{name}");
        let tips = repo.tips().expect("tips");
        assert_eq!(
            g.reached_from(&index, &tips),
            Some(vec![true; index.commits.len()]),
            "{name}"
        );
        reachable += found.bits.iter().filter(|b| *b & REACHABLE != 0).count();
    }
    assert!(reachable > 50);
}
