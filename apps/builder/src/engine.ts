import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Meta, Stats } from "@commitscape/data";
import { readManifest, type ExportManifest } from "@commitscape/server";

export type SummaryPerson = {
  person_id: number;
  name: string;
  login: string | null;
  commits: number;
  lines_added: number | null;
  lines_removed: number | null;
  first: number;
  last: number;
};

export type Summary = { meta: Meta; stats: Stats; people: SummaryPerson[]; head: string | null; lines_counted: boolean };

export type Built = { manifest: ExportManifest; summary: Summary; pack: string };

export type EngineEvent = { span: string; start_ms: number; end_ms: number; fields: Record<string, unknown> };

/** What one run of `commitscape build` wrote into its folder: the export's manifest, `meta.json` and where `pack.bin` is. */
export async function readBuilt(dir: string): Promise<Built> {
  const manifest = await readManifest(dir);
  const summary = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as Summary;
  return { manifest, summary, pack: join(dir, "pack.bin") };
}

/** The spans the engine wrote with `--events`, one JSON line each; none when it wrote nothing readable. */
export async function readEvents(file: string): Promise<EngineEvent[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  const events: EngineEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<EngineEvent>;
      if (typeof e.span === "string" && typeof e.start_ms === "number" && typeof e.end_ms === "number") events.push({ span: e.span, start_ms: e.start_ms, end_ms: e.end_ms, fields: e.fields ?? {} });
    } catch {
      continue;
    }
  }
  return events;
}
