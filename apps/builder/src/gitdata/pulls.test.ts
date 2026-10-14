import { expect, test } from "vitest";
import { gitPullKey, memoryStorage, readGitJson } from "@commitscape/server";
import { baseOf, choose, pullOf, readPulls, remotePulls, splitPatch } from "./pulls";
import { repo } from "./fixture";

const limits = { open: 10, others: 10, patchBytes: 10_000, fileBytes: 5_000, commits: 50, files: 50, totalBytes: 1_000_000 };

function project() {
  const r = repo();
  r.commit({ "app.ts": "const a = 1;\n" }, "m0", "Ada", 0);
  const m1 = r.commit({ "app.ts": "const a = 1;\nconst b = 2;\n" }, "m1", "Ada", 1);
  r.sh(r.origin, "checkout", "-q", "-b", "pr1", m1);
  r.commit({ "f1.txt": "one\ntwo\nthree\n" }, "p1", "Bob", 2);
  const p2 = r.commit({ "f1.txt": "one\ntwo\nthree\nfour\nfive\n" }, "p2", "Bob", 3);
  r.sh(r.origin, "checkout", "-q", "-b", "pr2", m1);
  const q1 = r.commit({ "q.txt": "q\n" }, "q1", "Cy", 3);
  r.sh(r.origin, "checkout", "-q", "-b", "pr3", m1);
  r.commit({ "r.txt": "r1\n" }, "r1", "Dee", 4);
  const r2 = r.commit({ "r.txt": "r1\nr2\n", "app.ts": "const a = 1;\nconst b = 2;\nconst c = 3;\n" }, "r2", "Dee", 5);
  r.sh(r.origin, "checkout", "-q", "main");
  r.sh(r.origin, "merge", "-q", "--no-ff", "-m", "Merge pull request #2 from cy/pr2", "pr2");
  r.sh(r.origin, "checkout", "-q", "pr3", "--", "r.txt", "app.ts");
  r.commit({}, "Squash r (#3)", "Ada", 6);
  r.commit({ "app.ts": "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n" }, "m4", "Ada", 7);
  for (const [n, sha] of [[1, p2], [2, q1], [3, r2]] as const) r.sh(r.origin, "update-ref", `refs/pull/${n}/head`, sha);
  for (const b of ["pr1", "pr2", "pr3"]) r.sh(r.origin, "branch", "-q", "-D", b);
  r.sh(r.origin, "gc", "-q", "--prune=now");
  r.sync();
  return { r, p2, q1, r2 };
}

test("the remote's pull requests come from ls-remote with the commit each head is at", async () => {
  const { r, p2, q1, r2 } = project();
  expect([...(await remotePulls(r.git))]).toEqual([[1, p2], [2, q1], [3, r2]]);
});

test("the open pull requests are kept first and the most recently updated others after, within the caps", () => {
  const heads = new Map([1, 2, 3, 4, 5, 6].map((n) => [n, "x"]));
  expect(choose(heads, { open: [6, 2, 99], recent: [5, 4, 3, 2, 1] }, { open: 5, others: 2 })).toEqual({ open: [6, 2], others: [5, 4] });
  expect(choose(heads, { open: [6, 5, 4], recent: [] }, { open: 2, others: 5 })).toEqual({ open: [6, 5], others: [] });
  expect(choose(heads, { open: [], recent: [] }, { open: 5, others: 3 }).others).toEqual([6, 5, 4]);
});

test("a pull request's base is where it left the default branch, or for one merged by a merge commit where that merge left it", async () => {
  const { r, p2, q1, r2 } = project();
  const tip = r.sh(r.clone, "rev-parse", "HEAD").trim();
  const m1 = r.sh(r.clone, "rev-parse", "HEAD~3").trim();
  r.sh(r.clone, "fetch", "-q", "origin", "+refs/pull/*/head:refs/pr/*");
  expect(await baseOf(r.git, p2, tip)).toEqual({ base: m1, basis: "fork" });
  expect(await baseOf(r.git, r2, tip)).toEqual({ base: m1, basis: "fork" });
  expect(await baseOf(r.git, q1, tip)).toEqual({ base: m1, basis: "merge" });
});

test("a pull request keeps its commits, the files it changed with their lines, and the diff", async () => {
  const { r, p2 } = project();
  r.sh(r.clone, "fetch", "-q", "origin", "+refs/pull/1/head:refs/pr/1");
  const pull = await pullOf(r.git, 1, p2, r.sh(r.clone, "rev-parse", "HEAD").trim(), limits);
  expect(pull.commits.map((c) => [c.subject, c.author])).toEqual([["p2", "Bob"], ["p1", "Bob"]]);
  expect(pull.commitsTotal).toBe(2);
  expect(pull.files).toMatchObject([{ path: "f1.txt", status: "A", added: 5, removed: 0, binary: false, omitted: null }]);
  expect(pull.files[0]?.patch).toContain("+five");
  expect(pull).toMatchObject({ added: 5, removed: 0, basis: "fork", filesTotal: 1 });
});

test("a diff past the byte cap leaves the patch of the files after it out and says so", async () => {
  const { r, r2 } = project();
  r.sh(r.clone, "fetch", "-q", "origin", "+refs/pull/3/head:refs/pr/3");
  const tip = r.sh(r.clone, "rev-parse", "HEAD").trim();
  const small = await pullOf(r.git, 3, r2, tip, { ...limits, patchBytes: 200 });
  expect(small.files.map((f) => [f.path, f.patch === null, f.omitted])).toEqual([["app.ts", false, null], ["r.txt", true, "cap"]]);
  const tight = await pullOf(r.git, 3, r2, tip, { ...limits, fileBytes: 50 });
  expect(tight.files.every((f) => f.patch === null && f.omitted === "large")).toBe(true);
  expect(tight.added).toBe(3);
});

test("a file's part of a diff is found by the path it ends at, spaces and renames included", () => {
  const diff = ["diff --git a/a b.txt b/a b.txt", "index 1..2 100644", "--- a/a b.txt", "+++ b/a b.txt", "@@ -1 +1 @@", "-x", "+y", "diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts", ""].join("\n");
  const parts = splitPatch(diff);
  expect([...parts.keys()]).toEqual(["a b.txt", "new.ts"]);
  expect(parts.get("a b.txt")).toContain("+y");
});

test("pull requests whose head has not moved are not read again, and ones that left the kept set are named for deletion", async () => {
  const { r } = project();
  const storage = memoryStorage();
  const tip = r.sh(r.clone, "rev-parse", "HEAD").trim();
  const deps = { storage, prefix: "git/gh/a/b", previous: null as Awaited<ReturnType<typeof readPulls>>["index"] | null, wanted: { open: [1], recent: [3, 2] }, limits, tip, builtAt: 1 };
  const first = await readPulls(r.git, deps);
  expect(Object.keys(first.index.pulls)).toEqual(["1", "2", "3"]);
  expect(first.fetched).toBe(3);
  expect(storage.objects.has(gitPullKey("git/gh/a/b", 2))).toBe(true);
  const before = storage.objects.size;
  const second = await readPulls(r.git, { ...deps, previous: first.index, wanted: { open: [1], recent: [3] } });
  expect(second.fetched).toBe(0);
  expect(second.deleted).toEqual([2]);
  expect(storage.objects.size).toBe(before);
  expect(second.bytes).toBe(Object.values(second.index.pulls).reduce((n, p) => n + p.bytes, 0));
});

test("with no time left the pull step fails at once", async () => {
  const { r } = project();
  const tip = r.sh(r.clone, "rev-parse", "HEAD").trim();
  r.git.deadline = Date.now() - 1;
  const done = await readPulls(r.git, { storage: memoryStorage(), prefix: "p", previous: null, wanted: { open: [1], recent: [] }, limits, tip, builtAt: 1 }).catch((e: Error) => e);
  expect(done).toBeInstanceOf(Error);
});

function backport() {
  const r = repo();
  r.commit({ "app.ts": "one\n" }, "m0", "Ada", 0);
  r.sh(r.origin, "checkout", "-q", "-b", "stable");
  const s1 = r.commit({ "fix.ts": "fix\n" }, "s1", "Ada", 1);
  r.sh(r.origin, "checkout", "-q", "main");
  for (let i = 1; i <= 5; i++) r.commit({ [`m${i}.ts`]: `m${i}\n` }, `m${i}`, "Ada", 1 + i);
  r.sh(r.origin, "checkout", "-q", "-b", "pr", "stable");
  const head = r.commit({ "fix.ts": "fix\nbetter\n" }, "b1", "Bob", 8);
  r.sh(r.origin, "checkout", "-q", "main");
  r.sh(r.origin, "update-ref", "refs/pull/1/head", head);
  r.sh(r.origin, "branch", "-q", "-D", "pr");
  r.sync();
  return { r, s1, head };
}

test("a pull request into a branch other than the default one is measured against that branch, and read again once it is", async () => {
  const { r, s1 } = backport();
  const storage = memoryStorage();
  const tip = r.sh(r.clone, "rev-parse", "HEAD").trim();
  const deps = { storage, prefix: "p", previous: null as Awaited<ReturnType<typeof readPulls>>["index"] | null, wanted: { open: [1], recent: [], bases: new Map([[1, "stable"]]) }, limits, tip, branch: "main", builtAt: 1 };
  const first = await readPulls(r.git, deps);
  const pull = await readGitJson<Awaited<ReturnType<typeof pullOf>>>(storage, gitPullKey("p", 1));
  expect(pull).toMatchObject({ base: s1, basis: "fork", onto: "stable", commitsTotal: 1, filesTotal: 1, added: 1, removed: 0 });
  expect(first.index.pulls["1"]?.onto).toBe("stable");
  expect((await readPulls(r.git, { ...deps, previous: first.index })).fetched).toBe(0);
  const old = { ...first.index, pulls: { "1": { ...first.index.pulls["1"], onto: undefined } as (typeof first.index.pulls)[string] } };
  expect((await readPulls(r.git, { ...deps, previous: old })).fetched).toBe(1);
  const gone = await readPulls(r.git, { ...deps, wanted: { ...deps.wanted, bases: new Map([[1, "deleted"]]) } });
  expect(gone.index.pulls["1"]?.onto).toBe("main");
});

test("a diff cut at its byte limit keeps no part of the file it was cut in", async () => {
  const r = repo();
  r.commit({ "z.txt": "z\n" }, "m0", "Ada", 0);
  r.sh(r.origin, "checkout", "-q", "-b", "pr");
  const lines = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w} ${i}`).join("\n") + "\n";
  const head = r.commit({ "a/package-lock.json": lines(6_000, "lock entry"), "b.txt": lines(5_000, "line") }, "p1", "Bob", 1);
  r.sh(r.origin, "checkout", "-q", "main");
  r.sh(r.origin, "update-ref", "refs/pull/1/head", head);
  r.sync();
  r.sh(r.clone, "fetch", "-q", "origin", "+refs/pull/1/head:refs/pr/1");
  const tip = r.sh(r.clone, "rev-parse", "HEAD").trim();
  const pull = await pullOf(r.git, 1, head, tip, { ...limits, patchBytes: 45_000, fileBytes: 1_000_000 });
  expect(pull.files.map((f) => [f.path, f.patch === null, f.omitted])).toEqual([["a/package-lock.json", true, "large"], ["b.txt", true, "cap"]]);
});
