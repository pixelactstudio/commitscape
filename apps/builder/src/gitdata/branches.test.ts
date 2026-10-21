import { expect, test } from "vitest";
import { byLinesChanged, isVersionTag, keptTags, loginOfEmail, readBranchDetails, readBranches } from "./branches";
import { repo } from "./fixture";

const limits = { branches: 300, tags: 50, commits: 100_000 };

test("a noreply address names the account, any other address names no one", () => {
  expect(loginOfEmail("47555435+AdzerKI@users.noreply.github.com")).toBe("adzerki");
  expect(loginOfEmail("octocat@users.noreply.github.com")).toBe("octocat");
  expect(loginOfEmail("ada@example.com")).toBeNull();
});

function history() {
  const r = repo();
  r.commit({ "a.txt": "1" }, "m0", "Ada", 0);
  const m1 = r.commit({ "a.txt": "2" }, "m1", "Ada", 1);
  r.sh(r.origin, "tag", "v1");
  r.sh(r.origin, "checkout", "-q", "-b", "feature-a", m1);
  const a1 = r.commit({ "fa.txt": "1" }, "a1", "Bob", 2);
  r.commit({ "fa.txt": "2" }, "a2", "Bob", 3);
  r.sh(r.origin, "checkout", "-q", "-b", "feature-b", a1);
  r.commit({ "fb.txt": "1" }, "b1", "Cy", 4);
  r.sh(r.origin, "checkout", "-q", "-b", "merged-x", m1);
  r.commit({ "x.txt": "1" }, "x1", "Ada", 2);
  r.sh(r.origin, "checkout", "-q", "-b", "solo", m1);
  r.commit({ "solo.txt": "1" }, "s1", "Dee", 5);
  r.sh(r.origin, "checkout", "-q", "main");
  r.sh(r.origin, "merge", "-q", "--no-ff", "-m", "Merge x", "merged-x");
  r.commit({ "a.txt": "3" }, "m3", "Ada", 6);
  r.sh(r.origin, "tag", "-a", "v2", "-m", "second");
  r.sync();
  return r;
}

test("each branch's tip, its distance from the default branch, and whether the default branch holds it", async () => {
  const r = history();
  const out = await readBranches(r.git, limits, 1);
  expect(out.default).toBe("main");
  expect(out.total).toBe(5);
  const by = Object.fromEntries(out.branches.map((b) => [b.name, b]));
  expect(out.branches.map((b) => b.name)).toContain("main");
  expect(by["feature-a"]).toMatchObject({ ahead: 2, behind: 3, merged: false, author: "Bob", subject: "a2" });
  expect(by["feature-b"]).toMatchObject({ ahead: 2, behind: 3, merged: false, author: "Cy" });
  expect(by["merged-x"]).toMatchObject({ ahead: 0, behind: 2, merged: true });
  expect(by.solo).toMatchObject({ ahead: 1, merged: false, author: "Dee" });
  expect(by["feature-a"]?.baseAt).toBe(r.at(1));
  expect(by["feature-a"]?.base).toBe(r.sh(r.clone, "rev-parse", "origin/feature-a~2").trim());
  expect(out.head).toBe(r.sh(r.clone, "rev-parse", "origin/main").trim());
});

test("a branch started from another's work is inferred to come out of it, any other from the default branch", async () => {
  const r = history();
  const out = await readBranches(r.git, limits, 1);
  const by = Object.fromEntries(out.branches.map((b) => [b.name, b]));
  expect(by["feature-b"]).toMatchObject({ parent: "feature-a", shared: 1 });
  expect(by["feature-a"]).toMatchObject({ parent: "main", shared: 0 });
  expect(by.solo).toMatchObject({ parent: "main" });
  expect(by["merged-x"]).toMatchObject({ parent: "main" });
  expect(by.main?.parent).toBeNull();
  expect(out.inferred).toBe(true);
});

test("the branches are capped at the most recent tips, the default branch always kept", async () => {
  const r = history();
  const out = await readBranches(r.git, { ...limits, branches: 3 }, 1);
  expect(out.total).toBe(5);
  expect(out.branches).toHaveLength(3);
  expect(out.branches[0]?.name).toBe("main");
});

test("tags come with the date of the commit or tag they name, newest first", async () => {
  const r = history();
  const out = await readBranches(r.git, limits, 1);
  expect(out.tags.map((t) => t.name)).toEqual(["v2", "v1"]);
  expect(out.tags[1]?.at).toBe(r.at(1));
  expect(out.tagsTotal).toBe(2);
});

test("a graph too big to read leaves every branch coming from the default branch", async () => {
  const r = history();
  const out = await readBranches(r.git, { ...limits, commits: 2 }, 1);
  const by = Object.fromEntries(out.branches.map((b) => [b.name, b]));
  expect(by["feature-b"]?.parent).toBe("main");
  expect(out.inferred).toBe(false);
});

test("an unmerged branch keeps its commits and the files it changes against the branch it came out of", async () => {
  const r = history();
  const found = await readBranches(r.git, limits, 1);
  const details = await readBranchDetails(r.git, found, 10);
  const at = (name: string) => found.branches.findIndex((b) => b.name === name);
  const b = details.get(at("feature-b"));
  expect(b).toMatchObject({ name: "feature-b", against: "feature-a", commitsTotal: 2, filesTotal: 1, added: 1, removed: 0 });
  expect(b?.commits.map((c) => [c.subject, c.author])).toEqual([["b1", "Cy"], ["a1", "Bob"]]);
  expect(b?.files).toEqual([{ path: "fb.txt", added: 1, removed: 0 }]);
  const a = details.get(at("feature-a"));
  expect(a).toMatchObject({ against: "main", filesTotal: 1 });
  expect(details.has(at("merged-x"))).toBe(false);
  expect(details.has(at("main"))).toBe(false);
  expect((await readBranchDetails(r.git, found, 1)).size).toBe(1);
});

test("a branch merged by squash counts as merged though the default branch lacks its commits, and one still apart does not", async () => {
  const r = repo();
  const m0 = r.commit({ "a.txt": "1" }, "m0", "Ada", 0);
  r.sh(r.origin, "checkout", "-q", "-b", "squashed", m0);
  r.commit({ "s.txt": "1" }, "s1", "Bob", 1);
  r.commit({ "s.txt": "2", "t.txt": "1" }, "s2", "Bob", 2);
  r.sh(r.origin, "checkout", "-q", "-b", "apart", m0);
  r.commit({ "p.txt": "1" }, "p1", "Cy", 3);
  r.sh(r.origin, "checkout", "-q", "main");
  r.commit({ "s.txt": "2", "t.txt": "1" }, "Squash s (#4)", "Ada", 4);
  r.commit({ "a.txt": "2" }, "m2", "Ada", 5);
  r.sync();
  const out = await readBranches(r.git, limits, 1);
  const by = Object.fromEntries(out.branches.map((b) => [b.name, b]));
  expect(by.squashed).toMatchObject({ ahead: 2, merged: true, squashed: true });
  expect(by.apart).toMatchObject({ ahead: 1, merged: false, squashed: false });
  const details = await readBranchDetails(r.git, out, 10);
  expect([...details.values()].map((d) => d.name)).toEqual(["apart"]);
});

test("every tag named like a version is kept, and only the newest of the others", () => {
  const tag = (name: string, at: number) => ({ name, sha: "s", at });
  const all = [tag("nightly", 9), tag("grep-0.2.3", 8), tag("15.0.0", 7), tag("deploy-3", 6), tag("v1.2-rc1", 5), tag("ignore-0.4.1", 4), tag("old", 3)];
  expect(keptTags(all, 1).map((t) => t.name)).toEqual(["nightly", "grep-0.2.3", "15.0.0", "v1.2-rc1", "ignore-0.4.1"]);
  expect(["v1.2", "15.0.0", "grep-0.2.3", "release/2.0", "pkg@1.0.0"].every(isVersionTag)).toBe(true);
  expect(["nightly", "v1", "build-123", "2024"].some(isVersionTag)).toBe(false);
});

test("a branch's files are ranked by the lines they change, binary ones last", () => {
  const f = (path: string, added: number | null, removed: number | null) => ({ path, added, removed });
  expect(byLinesChanged([f(".circleci/config.yml", 1, 1), f("logo.png", null, null), f("src/big.ts", 300, 20), f("src/a.ts", 1, 1)]).map((x) => x.path)).toEqual([
    "src/big.ts",
    ".circleci/config.yml",
    "src/a.ts",
    "logo.png",
  ]);
});
