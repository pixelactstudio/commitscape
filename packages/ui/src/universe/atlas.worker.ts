import { AtlasEngine, decodeAtlas, decodeNames, folderPath, layoutOf, type Atlas, type Layout } from "@commitscape/data/universe";
import type { Ask, FileAnswer, FrameAnswer, Region, Summary, Told } from "./protocol";

const scope = self as unknown as { postMessage(message: Told, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<Ask>) => void) | null };

const SUPER_FROM = 60_000;

let engine: AtlasEngine | null = null;
let queue: Promise<void> = Promise.resolve();
let gotNames: () => void = () => undefined;
const named = new Promise<void>((done) => {
  gotNames = done;
});
let folderIndex: Map<string, number> | null = null;
let fileIndex: Map<string, number> | null = null;

const tell = (m: Told, transfer?: Transferable[]) => scope.postMessage(m, transfer);

function regionsOf(a: Atlas, L: Layout): Region[] {
  const out: Region[] = [];
  const islandRoots = new Set<number>();
  for (const isl of L.islands) {
    if (isl.filesOnly) {
      const size = isl.to - isl.from;
      if (size < 12) continue;
      let sx = 0;
      let sz = 0;
      for (let i = isl.from; i < isl.to; i++) {
        sx += L.x[L.order[i] as number] as number;
        sz += L.z[L.order[i] as number] as number;
      }
      const path = folderPath(a, isl.folder);
      out.push({ folder: isl.folder, path, name: path ? `files in ${path}/` : "top-level files", x: sx / size, z: sz / size, radius: isl.radius, files: size, depth: 1, from: isl.from, to: isl.to, island: true });
      continue;
    }
    islandRoots.add(isl.folder);
  }
  const total = L.count;
  const f = a.folders.parent.length;
  const candidates: number[] = [];
  for (let d = 1; d < f; d++) {
    const lo = L.folderFrom[d] as number;
    const hi = L.folderTo[d] as number;
    if (lo < 0) continue;
    const size = hi - lo;
    if (islandRoots.has(d) || ((L.depth[d] as number) <= 4 && size >= Math.max(4, total * 0.0015))) candidates.push(d);
  }
  candidates.sort((x, y) => (L.folderTo[y] as number) - (L.folderFrom[y] as number) - ((L.folderTo[x] as number) - (L.folderFrom[x] as number)));
  for (const d of candidates.slice(0, 900)) {
    const path = folderPath(a, d);
    out.push({
      folder: d,
      path,
      name: a.folders.names[d] ?? path,
      x: L.folderX[d] as number,
      z: L.folderZ[d] as number,
      radius: L.folderRadius[d] as number,
      files: (L.folderTo[d] as number) - (L.folderFrom[d] as number),
      depth: L.depth[d] as number,
      from: L.folderFrom[d] as number,
      to: L.folderTo[d] as number,
      island: islandRoots.has(d),
    });
  }
  return out;
}

function summaryOf(e: AtlasEngine): { summary: Summary; transfer: Transferable[] } {
  const a = e.atlas;
  const L = e.layout;
  const n = L.count;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const born = new Float32Array(n);
  const died = new Float32Array(n);
  const borders = new Float32Array(n);
  const role = new Float32Array(n);
  const language = new Float32Array(n);
  const alive = new Uint8Array(n);
  const fileFolder = new Int32Array(n);
  const counts = new Map<number, number>();
  for (let f = 0; f < n; f++) if ((a.files.info[f] as number) & 8) counts.set(a.files.language[f] as number, (counts.get(a.files.language[f] as number) ?? 0) + 1);
  const top = [...counts.entries()].filter(([l]) => l > 0).sort((p, q) => q[1] - p[1]).slice(0, 8).map(([l]) => l);
  for (let rank = 0; rank < n; rank++) {
    const f = L.order[rank] as number;
    x[rank] = L.x[f] as number;
    z[rank] = L.z[f] as number;
    born[rank] = e.toWeeks(L.born[f] as number);
    died[rank] = Number.isFinite(L.died[f] as number) ? e.toWeeks(L.died[f] as number) : 1e7;
    borders[rank] = L.borders[f] as number;
    role[rank] = (a.files.info[f] as number) & 7;
    const l = a.files.language[f] as number;
    const k = top.indexOf(l);
    language[rank] = l === 0 ? 9 : k >= 0 ? k : 8;
    alive[rank] = (a.files.info[f] as number) & 8 ? 1 : 0;
    fileFolder[rank] = a.files.folder[f] as number;
  }
  const folders = { parent: a.folders.parent.slice(), from: L.folderFrom.slice(), to: L.folderTo.slice(), radius: L.folderRadius.slice() };
  let supers: Summary["supers"] = null;
  if (n > SUPER_FROM) {
    const starts: number[] = [];
    for (const isl of L.islands) for (let i = isl.from; i < isl.to; i += 7) starts.push(i);
    starts.push(n);
    const s = starts.length - 1;
    const sx = new Float32Array(s);
    const sz = new Float32Array(s);
    for (let k = 0; k < s; k++) {
      const lo = starts[k] as number;
      const hi = starts[k + 1] as number;
      let ax = 0;
      let az = 0;
      for (let r = lo; r < hi; r++) {
        ax += x[r] as number;
        az += z[r] as number;
      }
      sx[k] = ax / (hi - lo);
      sz[k] = az / (hi - lo);
    }
    supers = { x: sx, z: sz, start: Uint32Array.from(starts) };
  }
  const strip = e.strip.slice();
  const slotsByWeek = e.slotsByWeek.slice();
  const b = L.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const pad = Math.max(30, span * 0.1);
  const area: Summary["area"] = [b.minX - pad, b.minZ - pad, b.maxX - b.minX + pad * 2, b.maxZ - b.minZ + pad * 2];
  const summary: Summary = {
    origin: a.origin,
    newest: a.newest,
    weeks: e.weeks,
    mainline: a.mainline,
    commits: a.commits.time.length,
    people: { id: a.people.id.slice(), names: a.people.names, logins: a.people.logins, bot: a.people.bot.slice() },
    count: n,
    x,
    z,
    born,
    died,
    borders,
    role,
    language,
    alive,
    bounds: L.bounds,
    regions: regionsOf(a, L),
    languages: top.map((l) => a.languages[l - 1] ?? ""),
    strip,
    slotsByWeek,
    history: e.slotHistory(),
    releases: { names: a.releases.names, time: a.releases.time.slice() },
    supers,
    area,
    folders,
    fileFolder,
  };
  const transfer: Transferable[] = [x.buffer, z.buffer, born.buffer, died.buffer, borders.buffer, role.buffer, language.buffer, alive.buffer, strip.buffer, slotsByWeek.buffer, fileFolder.buffer, folders.parent.buffer, folders.from.buffer, folders.to.buffer, folders.radius.buffer];
  if (supers) transfer.push(supers.x.buffer, supers.z.buffer, supers.start.buffer);
  return { summary, transfer };
}

function open(map: ArrayBuffer): void {
  const started = performance.now();
  try {
    const atlas = decodeAtlas(new Uint8Array(map));
    engine = new AtlasEngine(atlas, layoutOf(atlas));
    const { summary, transfer } = summaryOf(engine);
    tell({ type: "ready", summary, ms: Math.round(performance.now() - started) }, transfer);
  } catch (e) {
    tell({ type: "failed", message: e instanceof Error ? e.message : "The Atlas could not be read." });
  }
}

function takeNames(bytes: ArrayBuffer | null): void {
  try {
    if (bytes && engine) {
      engine.names = decodeNames(new Uint8Array(bytes)).names;
      tell({ type: "names" });
    }
  } catch {
    return;
  } finally {
    gotNames();
  }
}

function placeOf(e: AtlasEngine, folder: number) {
  const L = e.layout;
  return { folder, x: L.folderX[folder] as number, z: L.folderZ[folder] as number, radius: L.folderRadius[folder] as number, from: L.folderFrom[folder] as number, to: L.folderTo[folder] as number };
}

async function lookup(e: AtlasEngine, kind: "file" | "folder", path: string): Promise<number> {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (kind === "folder") {
    if (!folderIndex) {
      folderIndex = new Map();
      for (let d = 0; d < e.atlas.folders.parent.length; d++) folderIndex.set(e.pathOf("folder", d), d);
    }
    return folderIndex.get(clean) ?? -1;
  }
  await named;
  if (!fileIndex) {
    fileIndex = new Map();
    for (let f = 0; f < e.layout.count; f++) fileIndex.set(e.pathOf("file", f), e.layout.rank[f] as number);
  }
  return fileIndex.get(clean) ?? -1;
}

function answer(ask: Exclude<Ask, { type: "open" } | { type: "names" }>): void | Promise<void> {
  const e = engine;
  if (!e) return tell({ type: "answer", id: ask.id, value: null });
  switch (ask.type) {
    case "frame": {
      const f = e.frame({ at: ask.at, from: ask.from, solo: ask.solo });
      const value: FrameAnswer = { at: f.at, from: f.from, height: f.height, colour: f.colour, touched: f.touched, slots: f.slots, beacons: f.beacons, tallest: f.tallest };
      return tell({ type: "answer", id: ask.id, value }, [f.height.buffer, f.colour.buffer, f.touched.buffer]);
    }
    case "bots": {
      e.setBots(ask.hide);
      const strip = e.strip.slice();
      return tell({ type: "answer", id: ask.id, value: strip }, [strip.buffer]);
    }
    case "file": {
      const file = e.layout.order[ask.rank] as number;
      const facts = e.file(file, ask.at);
      const value: FileAnswer = { ...facts, path: e.pathOf("file", file), name: e.names?.[file] ?? "" };
      return tell({ type: "answer", id: ask.id, value });
    }
    case "folder":
      return tell({ type: "answer", id: ask.id, value: { ...e.folder(ask.folder, ask.at), ...placeOf(e, ask.folder) } });
    case "lookup":
      return lookup(e, ask.kind, ask.path).then((value) => tell({ type: "answer", id: ask.id, value }));
    case "home":
      return tell({ type: "answer", id: ask.id, value: placeOf(e, e.atlas.files.folder[e.layout.order[ask.rank] as number] as number) });
    case "person":
      return tell({ type: "answer", id: ask.id, value: e.person(ask.person, ask.at) });
    case "describe":
      return tell({ type: "answer", id: ask.id, value: e.describe(ask.at) });
    case "search":
      return tell({ type: "answer", id: ask.id, value: e.search(ask.q, 10) });
    case "path":
      return tell({ type: "answer", id: ask.id, value: ask.kind === "file" ? e.pathOf("file", e.layout.order[ask.ref] as number) : e.pathOf("folder", ask.ref) });
  }
}

scope.onmessage = (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const ask = event.data;
  if (ask.type === "open") {
    queue = queue.then(() => open(ask.map));
    return;
  }
  if (ask.type === "names") {
    queue = queue.then(() => takeNames(ask.names));
    return;
  }
  if (ask.type === "lookup") {
    void queue.then(() => answer(ask));
    return;
  }
  queue = queue.then(() => answer(ask));
};
