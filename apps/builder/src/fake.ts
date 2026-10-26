import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXPORT_FORMAT, type ExportManifest } from "@commitscape/server";
import type { Summary, SummaryPerson } from "./engine";

export type FakeBuild = { head?: string; frontier?: string[]; left?: number; mainline?: boolean; total?: number; lineage?: string; people?: SummaryPerson[] };

export const flagOf = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

export const fakePerson = (id: number, login: string | null, commits: number): SummaryPerson => ({ person_id: id, name: `P${id}`, login, commits, lines_added: 10 * id, lines_removed: id, first: 1, last: 2 });

/** Writes what `commitscape build` would into its `--out` folder, for tests of the Builder without the engine. */
export async function writeBuilt(args: string[], over: FakeBuild = {}): Promise<void> {
  const out = flagOf(args, "--out") ?? "";
  const noLines = args.includes("--no-lines");
  const after = args.includes("--after");
  const head = over.head ?? "a".repeat(40);
  const total = over.total ?? 3;
  const left = noLines ? null : (over.left ?? 0);
  await mkdir(out, { recursive: true });
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    lineage: over.lineage ?? "7",
    kept: true,
    full: !after,
    lines: !noLines && left === 0,
    lines_counted: noLines ? 0 : total - (left ?? 0),
    lines_mainline: !noLines && (over.mainline ?? true),
    lines_left: left,
    head,
    frontier: over.frontier ?? [head],
    commits: after ? 0 : total,
    total,
    anchor: 1,
    max_changeset_size: 50,
    coupling_support: 5,
    ownership_min_commits: 10,
    mark: `${head}.${noLines ? "-.-" : `${total}.1`}.0`,
    changes_only: after && args.includes("--since"),
  };
  const summary: Summary = {
    meta: { name: "rocket", windows: ["all"], window: "all", anchor: 1, history: "complete", lines: noLines ? "off" : "counted", avatars: false },
    stats: { commits: total, people: 2, bus_factor: 1, maintainers: 1, commits_30d: 3, people_30d: 2, code_lines: 40, untouched_5y: 0 },
    people: (over.people ?? [fakePerson(1, "ada", 5)]).map((p) => (noLines ? { ...p, lines_added: null, lines_removed: null } : p)),
    head,
    lines_counted: !noLines,
  };
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(out, "meta.json"), JSON.stringify(summary));
  await writeFile(join(out, "pack.bin"), `pack ${noLines ? "quick" : "lines"} ${head}`);
  const events = flagOf(args, "--events");
  if (events) {
    const now = Date.now();
    const line = (span: string, start: number, end: number, fields: object) => JSON.stringify({ span, start_ms: start, end_ms: end, fields });
    await writeFile(events, [line("head_pass", now - 80, now - 60, { files: 2 }), line("load", now - 100, now - 50, { commits: total, freshness: "warm" }), line("export", now - 40, now - 30, { commits: total })].join("\n"));
  }
}
