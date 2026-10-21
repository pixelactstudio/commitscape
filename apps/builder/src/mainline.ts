import { eq } from "drizzle-orm";
import { MAINLINE, schema, writeMainline, type Db, type Mainline } from "@commitscape/server";
import { git, text, type Git } from "./gitdata/exec";

const { storedIndexes } = schema;

const MAX_BYTES = 512 * 1024 * 1024;

/** Works out the Mainline of a history from `git rev-list --timestamp --parents`: what HEAD reaches, its first-parent line, and each commit's Main Arrival. */
export function mainlineOf(revList: string, head: string): Mainline {
  const lines = revList.split("\n").filter(Boolean);
  const n = lines.length;
  const shas = new Array<string>(n);
  const time = new Float64Array(n);
  const at = new Map<string, number>();
  const parentShas: string[][] = new Array(n);
  lines.forEach((line, i) => {
    const [ts = "0", sha = "", ...parents] = line.split(" ");
    shas[i] = sha;
    time[i] = Number(ts) || 0;
    parentShas[i] = parents;
    at.set(sha, i);
  });
  const parents: number[][] = parentShas.map((ps) => ps.flatMap((p) => (at.has(p) ? [at.get(p) as number] : [])));
  const firstParent = (i: number): number | undefined => {
    const p = parentShas[i]?.[0];
    return p === undefined ? undefined : at.get(p);
  };
  const line: number[] = [];
  const onLine = new Uint8Array(n);
  for (let i = at.get(head); i !== undefined && !onLine[i]; i = firstParent(i)) {
    onLine[i] = 1;
    line.push(i);
  }
  const seen = new Uint8Array(n);
  const arrival = new Float64Array(n);
  const stack: number[] = [];
  for (let k = line.length - 1; k >= 0; k--) {
    const f = line[k] as number;
    const when = time[f] as number;
    seen[f] = 1;
    arrival[f] = when;
    for (const p of (parents[f] ?? []).slice(1)) stack.push(p);
    while (stack.length > 0) {
      const c = stack.pop() as number;
      if (seen[c]) continue;
      seen[c] = 1;
      arrival[c] = when;
      for (const p of parents[c] ?? []) if (!seen[p]) stack.push(p);
    }
  }
  const bits = new Array<number>(n);
  const arrivals = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    bits[i] = MAINLINE.reachable | (onLine[i] ? MAINLINE.firstParent : 0);
    arrivals[i] = arrival[i] as number;
  }
  return { shas, bits, arrival: arrivals };
}

/** The commit each tag points at, peeled through annotated tags, by the tag's name. */
export async function tagCommits(g: Git): Promise<Map<string, string>> {
  const out = await text(g, ["for-each-ref", "--format=%(refname:lstrip=2)%09%(objectname)%09%(*objectname)", "refs/tags"], { maxBytes: 64 * 1024 * 1024 }).catch(() => "");
  const tags = new Map<string, string>();
  for (const row of out.split("\n")) {
    const [name = "", sha = "", peeled = ""] = row.split("\t");
    if (name && sha) tags.set(name, peeled || sha);
  }
  return tags;
}

export type Marked = { commits: number; firstParent: number; changed: number; releases: number; seconds: number };

/** Works out the Mainline of a Stored Index from the clone it was read from, at the HEAD it was read at, and writes it; null when it has no HEAD the clone holds. */
export async function markMainline(db: Db, g: Git, si: number): Promise<Marked | null> {
  const started = Date.now();
  const [index] = await db.select({ head: storedIndexes.head }).from(storedIndexes).where(eq(storedIndexes.id, si));
  const head = index?.head;
  if (!head || !/^[0-9a-f]{40,64}$/.test(head)) return null;
  const ran = await git(g, ["rev-list", "--timestamp", "--parents", head], { maxBytes: MAX_BYTES });
  if (ran.timedOut || ran.capped || ran.code !== 0) throw new Error(`git rev-list ${ran.timedOut ? "ran out of time" : ran.capped ? "printed too much" : `failed: ${ran.err.trim().split("\n").at(-1) ?? ran.code}`}`);
  const m = mainlineOf(ran.out.toString("latin1"), head);
  const written = await writeMainline(db, si, m, await tagCommits(g));
  const firstParent = m.bits.filter((b) => (b & MAINLINE.firstParent) !== 0).length;
  return { commits: m.shas.length, firstParent, changed: written.changed, releases: written.releases, seconds: (Date.now() - started) / 1000 };
}
