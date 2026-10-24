import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { answer } from "@commitscape/data/answers";
import { createDb, runMigrations } from "./db/client";
import { repositories } from "./db/schema";
import { loadExport, loadView } from "./stored-index";

const url = process.env.TEST_DATABASE_URL;
const root = fileURLToPath(new URL("../../..", import.meta.url));
const bin = join(root, "target/release/commitscape");
const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

const FIXTURES = ["linear", "coupling", "ownership", "renames", "bulk", "merges", "conflict", "rhythm", "lines", "survival"];

const extra = (process.env.PARITY_REPOS ?? "")
  .split(",")
  .filter(Boolean)
  .map((pair) => {
    const [repo, cache] = pair.split("=");
    return { name: repo ?? "", repo: repo ?? "", cache: cache ?? "" };
  });

const repos = [...FIXTURES.map((f) => ({ name: f, repo: join(root, "fixtures", f), cache: "" })), ...extra];

function firstDifference(a: unknown, b: unknown, at = ""): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${at}: ${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array and object`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return `${at}: ${a.length} items ≠ ${b.length}`;
  for (const k of keys) {
    const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

function parse(key: string): { path: string; params: Record<string, string> } {
  const [path = "", query = ""] = key.split("?");
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
}

describe.skipIf(!url || !existsSync(bin))("the Site's answers from a Stored Index equal the Report's", async () => {
  if (!url) return;
  await runMigrations(url, migrations);
  const { db, pool } = createDb(url);
  afterAll(() => pool.end());

  test.each(repos)("$name", async ({ name, repo, cache }) => {
    const work = mkdtempSync(join(tmpdir(), "parity-"));
    const cacheDir = cache || join(work, "cache");
    const report = join(work, "report.json.gz");
    const out = join(work, "export");
    execFileSync(bin, ["report", "--no-emails", "--offline", "--window", "all", "--cache-dir", cacheDir, "--out", report, "--", repo], { stdio: "ignore" });
    execFileSync(bin, ["export", repo, "--offline", "--cache-dir", cacheDir, "--out", out], { stdio: "ignore" });
    const written = JSON.parse((() => { const bytes = readFileSync(report); return (bytes[0] === 0x1f ? gunzipSync(bytes) : bytes).toString("utf8"); })()) as { meta: { anchor: number }; data: Record<string, unknown>; stats: unknown };
    const id = `parity/${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    await db.delete(repositories).where(eq(repositories.id, id));
    await db.insert(repositories).values({ id, owner: "parity", name: id.slice(7) });
    const loaded = await loadExport(pool, id, out);
    const view = await loadView(db, loaded.si);
    if (!view) throw new Error("no view");
    view.anchor = written.meta.anchor;
    const keys = Object.keys(written.data).filter((k) => !k.startsWith("/api/commits"));
    expect(keys.length).toBeGreaterThan(8);
    const differences: string[] = [];
    for (const [key, expected] of Object.entries(written.data)) {
      if (key.startsWith("/api/commits")) continue;
      const { path, params } = parse(key);
      const d = firstDifference(answer(view, path, params), expected, key);
      if (d) differences.push(d);
    }
    const s = firstDifference(answer(view, "/api/stats"), written.stats, "stats");
    if (s) differences.push(s);
    await db.delete(repositories).where(eq(repositories.id, id));
    expect(differences.slice(0, 8)).toEqual([]);
  }, 600_000);
});
