import { expect, test } from "vitest";
import { ensureClone } from "./clone";
import { repo } from "./gitdata/fixture";
import { fetchBlobs, historyBlobs, missingBlobs, neededBlobs } from "./lean";
import { run } from "./run";

const env = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "always" };

test("a blobless clone without files fetches only the versions a Build reads: HEAD's files and both sides of the new commits' changes, Bulk ones left out", async () => {
  const r = repo();
  r.sh(r.origin, "config", "uploadpack.allowFilter", "true");
  r.sh(r.origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  r.commit({ "a.rs": "1\n", "old.rs": "gone later\n" }, "first");
  const first = r.commit({ "a.rs": "1\n2\n" }, "second", "Ada", 1);
  const g = { dir: r.clone, env, deadline: Date.now() + 60_000 };
  const url = `file://${r.origin}`;
  const cloned = await ensureClone(run, { url, dir: r.clone, blobless: true, checkout: false, env, timeoutMs: 60_000 });
  expect(cloned.ok).toBe(true);
  expect((await missingBlobs(g, [r.sh(r.origin, "rev-parse", "HEAD:a.rs").trim()])).length).toBe(1);

  r.commit({ "a.rs": "1\n2\n3\n", "old.rs": null, "b.rs": "b\n" }, "third", "Ada", 2);
  const bulk = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`gen/${i}.rs`, `generated ${i}\n`]));
  r.commit(bulk, "a reformat", "Ada", 3);
  expect((await ensureClone(run, { url, dir: r.clone, blobless: true, checkout: false, env, timeoutMs: 60_000 })).ok).toBe(true);
  const at = (rev: string) => r.sh(r.origin, "rev-parse", rev).trim();
  const needed = await neededBlobs(g, [first], 50);
  expect(new Set(needed)).toEqual(new Set([at("HEAD:a.rs"), at("HEAD~1:a.rs"), at("HEAD~2:a.rs"), at("HEAD:b.rs"), at(`${first}:old.rs`), ...Object.keys(bulk).map((p) => at(`HEAD:${p}`))]));
  expect(needed).not.toContain(at(`${first}~1:a.rs`));
  await fetchBlobs(g, needed);
  expect(await missingBlobs(g, needed)).toEqual([]);
  expect(await neededBlobs(g, [at("HEAD")], 50)).toEqual([]);

  const history = await historyBlobs(g, first);
  expect(history).toEqual([at(`${first}~1:a.rs`)]);
  await fetchBlobs(g, history);
  expect(await historyBlobs(g, first)).toEqual([]);
});
