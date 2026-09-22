# Fixture repositories and their worked values

Built by `cargo xtask fixtures --force` into `fixtures/` (gitignored — they are
regenerated, not committed). Every repository is deterministic: fixed authors,
fixed commit timestamps, fixed branch names. Rebuilding produces identical
object ids.

**These values are worked out by hand from the shape of each history.** Tests
assert these literals. A test that derives its expected value the way the
implementation does would pass forever regardless of correctness, so it must not
be written that way.

Commit *n* of a fixture is stamped at `2024-01-01T00:00:00Z + n days`. Day 0 is
the first commit.

---

## `linear` — 5 commits, no branches

| File | Churn | Last touched |
|---|---|---|
| `a.txt` | 5 | day 4 |
| `b.txt` | 2 | day 4 |
| `c.txt` | 1 | day 2 |

## `coupling` — exact Jaccard fractions

12 commits. Per-file commit counts (verified against `git rev-list --count`):

| File | Commits it appears in | Count |
|---|---|---|
| `src/a.txt` | 1,2,3,4,5 | 5 |
| `src/b.txt` | 1,2,3,6 | 4 |
| `pkg/c.txt` | 7,8,9,10,11 | 5 |
| `other/d.txt` | 7,8,9,10,12 | 5 |

| Pair | both | either | Jaccard | P(first\|second) | P(second\|first) | Cross-dir |
|---|---|---|---|---|---|---|
| (`src/a.txt`, `src/b.txt`) | 3 | 5+4−3 = 6 | **3/6 = 1/2** | 3/4 = 0.75 | 3/5 = 0.6 | no |
| (`pkg/c.txt`, `other/d.txt`) | 4 | 5+5−4 = 6 | **4/6 = 2/3** | 4/5 = 0.8 | 4/5 = 0.8 | **yes** |
| (`src/a.txt`, `pkg/c.txt`) | 0 | 10 | 0 | 0 | 0 | yes |

With a support threshold of 5, `src/b.txt` (count 4) is pruned, so the `(a,b)`
pair disappears entirely and `(c,d)` is the only surviving pair. This fixture
therefore tests the prune as well as the arithmetic.

## `ownership` — every identity form ADR-0006 must resolve

16 commits (one adds `.mailmap`). `.mailmap` contains:

```
Alice Example <alice@example.com> <alice@work.example.org>
```

| Directory | Author | Commits | Identity form |
|---|---|---|---|
| `alpha/` | Alice | 3 | `alice@example.com` — canonical |
| `alpha/` | Alice | 3 | `Alice@Example.COM` — rule 2, case-insensitive email |
| `alpha/` | Alice | 3 | `alice@work.example.org` — **mailmap only** |
| `alpha/` | Bob | 1 | — |
| `beta/` | Carol | 3 | `90210+carol@users.noreply.github.com` — rule 3 |
| `beta/` | Carol | 2 | `carol@users.noreply.github.com` — canonical |
| `beta/` | Bob | 5 | — |

Expected after full resolution:

- `alpha/`: Alice 9/10 = **90%**, Bob 1/10. Over the 80% line, so **bus factor 1**.
- `beta/`: Carol 5/10 = 50%, Bob 5/10 = 50%. **Bus factor 2**.

With the mailmap ignored, `alpha/` becomes Alice 6/10 = 60%, which is under the
line and yields bus factor 2. The mailmap is what moves the number, which is why
ADR-0006 puts it first.

## `renames` — exact rename mid-history

`old/path.txt` created (day 0), edited (days 1, 2), moved to `new/path.txt` with
byte-identical content (day 3), edited again (days 4, 5).

Verified: the move commit's raw diff is `R100` with blob `4cb29ea` on both sides.

- **With rename following:** one file identity, churn **6**, current path `new/path.txt`.
- **Without:** two files of churn 3 each, and `new/path.txt` looks newly created.

## `bulk` — one oversized commit

3 small commits touching `a.txt`, then 1 commit touching **60** files (`a.txt`
plus `gen/f000.txt`…`gen/f058.txt`).

At a bulk threshold of 50:

- Churn of `a.txt` = **3** (the bulk commit is excluded).
- Commits excluded as bulk = **1**, and this count must be visible in the UI.
- Staleness of `a.txt` = **day 3**, the bulk commit's day. Staleness counts bulk
  commits: a file that was touched was touched.

## `merges` — the frontier case from ADR-0002

```
day 0  main 0
day 1  main 1        <- side branches from here
day 2  side 2  (on side)
day 3  side 3  (on side)
day 4  main 4
day 5  main 5
day 6  merge side into main   (a merge commit)
```

Verified by `git log --all --date=short`: `side 2` and `side 3` are dated day 2
and day 3, while `main 5` is day 5.

**This is the fixture that proves the bug.** Index `main` when its tip is
`main 5`, then merge. The two `side` commits are now reachable but are *older*
than the recorded tip. A resume keyed on a single sha, or on a timestamp, misses
them and reports success. A frontier-set resume finds them.

Resuming from a frontier of `{main 5}` must yield exactly three commits, dated
day 2, day 3 and day 6.

Expected after indexing the full history: 7 commits, of which **1 is a merge**.

A merge records only what it introduced itself: the paths whose content differs
from every parent, which is what `git diff-tree -c` reports. This merge is
clean, so its changeset is empty.

| File | Commits touching it, merge included | Excluding merges, what churn reports | Last touched |
|---|---|---|---|
| `main.txt` | 4 | **4** | day 5 |
| `side.txt` | **2** | **2** | day 3 |

An earlier version of the walk diffed a merge against its first parent only.
That re-reports everything the merged branch changed, so `side.txt` showed 3.
On `rust-lang/rust` it made merge commits 71% of all stored changes while adding
nothing the branch commits did not already record. Recording only what differs
from every parent keeps the facts that are real (conflict resolutions, see
`conflict` below) and drops the replay.

## `conflict`: a merge that resolves a conflict and adds a file

```
day 0  main: add shared.txt ("base") and other.txt   <- topic branches from here
day 1  topic: shared.txt = "topic"
day 2  main:  shared.txt = "main"
day 3  merge topic into main: shared.txt = "resolved", and evil.txt added
```

The merge commit is built with `git commit-tree` so its tree is exactly the
resolution written above, with no conflict markers and no dependence on the
host's merge configuration.

Expected: 4 commits, 1 merge. The merge's changeset is exactly two entries:

| Path | Kind | Why |
|---|---|---|
| `shared.txt` | Modified | "resolved" matches neither parent ("main", "topic") |
| `evil.txt` | Added | present in neither parent |

`other.txt` is absent because it matches both parents.

| File | Commits touching it, merge included | Excluding merges |
|---|---|---|
| `shared.txt` | 4 | **3** |
| `other.txt` | 1 | 1 |
| `evil.txt` | 1 | 0 |

## Edge-case repositories

| Fixture | Shape | Required behaviour |
|---|---|---|
| `empty` | initialised, 0 commits | Clear message, clean exit |
| `detached` | HEAD detached onto the first of 2 commits | Works; indexes from the detached commit |
| `bare.git` | bare clone of `linear` | Works, or says plainly it needs a worktree for the HEAD pass |
| `shallow` | depth-1 clone of `linear` | Must report history as truncated, never present the truncated count as real |

None of these may panic or print a stack trace.
