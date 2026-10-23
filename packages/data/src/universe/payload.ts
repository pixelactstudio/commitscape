import { ByteReader, ByteWriter } from "./bytes";

export const ATLAS_MAGIC = 0x41534331;
export const ATLAS_VERSION = 1;

export const KIND = { added: 0, modified: 1, deleted: 2, renamed: 3 } as const;

export const COMMIT_FLAG = { bulk: 1, firstParent: 2 } as const;

export const FILE_INFO = { role: 7, alive: 8, generated: 16, lockfile: 32 } as const;

export type Atlas = {
  mainline: boolean;
  origin: number;
  newest: number;
  people: { id: Int32Array; names: string[]; logins: (string | null)[]; bot: Uint8Array };
  folders: { parent: Int32Array; names: string[] };
  files: { folder: Int32Array; info: Uint8Array; language: Uint16Array; lines: Int32Array };
  languages: string[];
  commits: { time: Float64Array; person: Int32Array; flags: Uint8Array; start: Uint32Array };
  changes: { file: Int32Array; kind: Uint8Array };
  releases: { names: string[]; time: Float64Array };
};

export type AtlasNames = { names: string[] };

export type AtlasCommitRow = { time: number; person: number; bulk: boolean; firstParent: boolean; files: readonly number[]; changes: readonly number[] };

export type AtlasFileRow = { file: number; path: string; alive: boolean; role: number; language: string | null; generated: boolean; lockfile: boolean; lines: number | null };

export type AtlasPersonRow = { id: number; name: string; login: string | null; bot: boolean };

export type AtlasRows = {
  mainline: boolean;
  newest: number;
  commits: readonly AtlasCommitRow[];
  files: readonly AtlasFileRow[];
  people: readonly AtlasPersonRow[];
  releases: readonly (readonly [string, number])[];
};

/** Builds the Atlas and its names from Stored Index rows: files numbered in the order they first changed, folders from their paths, people by how many commits they made. */
export function atlasOf(rows: AtlasRows): { atlas: Atlas; names: AtlasNames } {
  const fileRow = new Map<number, AtlasFileRow>();
  for (const f of rows.files) fileRow.set(f.file, f);
  const order = new Map<number, number>();
  const commitsBy = new Map<number, number>();
  let changes = 0;
  for (const c of rows.commits) {
    for (const f of c.files) {
      if (!fileRow.has(f)) continue;
      if (!order.has(f)) order.set(f, order.size);
      changes++;
    }
    if (c.person >= 0) commitsBy.set(c.person, (commitsBy.get(c.person) ?? 0) + 1);
  }
  for (const f of rows.files) if (f.alive && !order.has(f.file)) order.set(f.file, order.size);

  const known = new Map(rows.people.map((p) => [p.id, p]));
  const ranked = [...commitsBy.entries()].filter(([id]) => known.has(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const personIndex = new Map<number, number>();
  ranked.forEach(([id], i) => personIndex.set(id, i));
  const people: Atlas["people"] = { id: new Int32Array(ranked.length), names: [], logins: [], bot: new Uint8Array(ranked.length) };
  ranked.forEach(([id], i) => {
    const p = known.get(id) as AtlasPersonRow;
    people.id[i] = id;
    people.names.push(p.name);
    people.logins.push(p.login);
    people.bot[i] = p.bot ? 1 : 0;
  });

  const n = order.size;
  const folderIndex = new Map<string, number>([["", 0]]);
  const folders: { parent: number[]; names: string[] } = { parent: [-1], names: [""] };
  const folderOf = (path: string): number => {
    const cut = path.lastIndexOf("/");
    if (cut < 0) return 0;
    const dir = path.slice(0, cut);
    const found = folderIndex.get(dir);
    if (found !== undefined) return found;
    const parent = folderOf(dir);
    const id = folders.names.length;
    folders.parent.push(parent);
    folders.names.push(dir.slice(dir.lastIndexOf("/") + 1));
    folderIndex.set(dir, id);
    return id;
  };
  const languageIndex = new Map<string, number>();
  const languages: string[] = [];
  const files: Atlas["files"] = { folder: new Int32Array(n), info: new Uint8Array(n), language: new Uint16Array(n), lines: new Int32Array(n).fill(-1) };
  const names: string[] = new Array<string>(n).fill("");
  for (const [file, i] of order) {
    const f = fileRow.get(file) as AtlasFileRow;
    files.folder[i] = folderOf(f.path);
    names[i] = f.path.slice(f.path.lastIndexOf("/") + 1);
    files.info[i] = (f.role & FILE_INFO.role) | (f.alive ? FILE_INFO.alive : 0) | (f.generated ? FILE_INFO.generated : 0) | (f.lockfile ? FILE_INFO.lockfile : 0);
    if (f.language) {
      let l = languageIndex.get(f.language);
      if (l === undefined) {
        l = languages.length + 1;
        languages.push(f.language);
        languageIndex.set(f.language, l);
      }
      files.language[i] = l;
    }
    if (f.alive && f.lines !== null) files.lines[i] = f.lines;
  }

  const count = rows.commits.length;
  const commits: Atlas["commits"] = { time: new Float64Array(count), person: new Int32Array(count), flags: new Uint8Array(count), start: new Uint32Array(count + 1) };
  const flat: Atlas["changes"] = { file: new Int32Array(changes), kind: new Uint8Array(changes) };
  let at = 0;
  rows.commits.forEach((c, i) => {
    commits.time[i] = c.time;
    commits.person[i] = c.person >= 0 ? (personIndex.get(c.person) ?? -1) : -1;
    commits.flags[i] = (c.bulk ? COMMIT_FLAG.bulk : 0) | (c.firstParent ? COMMIT_FLAG.firstParent : 0);
    commits.start[i] = at;
    c.files.forEach((f, j) => {
      const id = order.get(f);
      if (id === undefined) return;
      flat.file[at] = id;
      flat.kind[at] = Math.max(0, Math.min(3, c.changes[j] ?? KIND.modified));
      at++;
    });
  });
  commits.start[count] = at;
  const origin = count > 0 ? (commits.time[0] as number) : rows.newest;
  const releases = [...rows.releases].filter(([, t]) => Number.isFinite(t)).sort((a, b) => a[1] - b[1]);
  return {
    atlas: {
      mainline: rows.mainline,
      origin,
      newest: Math.max(origin, rows.newest),
      people,
      folders: { parent: Int32Array.from(folders.parent), names: folders.names },
      files,
      languages,
      commits,
      changes: flat,
      releases: { names: releases.map(([name]) => name), time: Float64Array.from(releases.map(([, t]) => t)) },
    },
    names: { names },
  };
}

/** The Atlas as compact bytes: varints and delta-coded columns, each column apart so it compresses well. */
export function encodeAtlas(a: Atlas): Uint8Array {
  const w = new ByteWriter();
  w.uint(ATLAS_MAGIC);
  w.uint(ATLAS_VERSION);
  w.uint(a.mainline ? 1 : 0);
  w.uint(a.origin);
  w.uint(Math.max(0, a.newest - a.origin));

  const p = a.people.id.length;
  w.uint(p);
  for (let i = 0; i < p; i++) w.uint(a.people.id[i] as number);
  for (let i = 0; i < p; i++) w.byte(a.people.bot[i] as number);
  for (const s of a.people.names) w.text(s);
  for (const s of a.people.logins) w.text(s ?? "");

  const f = a.folders.parent.length;
  w.uint(f);
  for (let i = 1; i < f; i++) w.uint(i - (a.folders.parent[i] as number));
  for (let i = 1; i < f; i++) w.text(a.folders.names[i] ?? "");

  w.uint(a.languages.length);
  for (const s of a.languages) w.text(s);

  const n = a.files.folder.length;
  w.uint(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = a.files.folder[i] as number;
    w.int(v - prev);
    prev = v;
  }
  for (let i = 0; i < n; i++) w.byte(a.files.info[i] as number);
  for (let i = 0; i < n; i++) w.uint(a.files.language[i] as number);
  for (let i = 0; i < n; i++) w.uint((a.files.lines[i] as number) + 1);

  const c = a.commits.time.length;
  w.uint(c);
  let last = a.origin;
  for (let i = 0; i < c; i++) {
    const t = a.commits.time[i] as number;
    w.uint(Math.max(0, t - last));
    last = Math.max(last, t);
  }
  for (let i = 0; i < c; i++) w.uint((a.commits.person[i] as number) + 1);
  for (let i = 0; i < c; i++) w.byte(a.commits.flags[i] as number);
  for (let i = 0; i < c; i++) w.uint((a.commits.start[i + 1] as number) - (a.commits.start[i] as number));
  for (let i = 0; i < c; i++) {
    let before = 0;
    for (let j = a.commits.start[i] as number; j < (a.commits.start[i + 1] as number); j++) {
      const id = a.changes.file[j] as number;
      w.int(id - before);
      before = id;
    }
  }
  const kinds = a.changes.kind.length;
  for (let j = 0; j < kinds; j += 4) {
    let b = 0;
    for (let k = 0; k < 4 && j + k < kinds; k++) b |= ((a.changes.kind[j + k] as number) & 3) << (k * 2);
    w.byte(b);
  }

  w.uint(a.releases.names.length);
  for (const s of a.releases.names) w.text(s);
  for (let i = 0; i < a.releases.time.length; i++) w.uint(Math.max(0, (a.releases.time[i] as number) - a.origin));
  return w.bytes();
}

/** Reads bytes encodeAtlas wrote. */
export function decodeAtlas(bytes: Uint8Array): Atlas {
  const r = new ByteReader(bytes);
  if (r.uint() !== ATLAS_MAGIC) throw new Error("This is not an Atlas.");
  const version = r.uint();
  if (version !== ATLAS_VERSION) throw new Error(`Atlas version ${version} is not one this page reads.`);
  const mainline = r.uint() === 1;
  const origin = r.uint();
  const newest = origin + r.uint();

  const p = r.uint();
  const people: Atlas["people"] = { id: new Int32Array(p), names: [], logins: [], bot: new Uint8Array(p) };
  for (let i = 0; i < p; i++) people.id[i] = r.uint();
  for (let i = 0; i < p; i++) people.bot[i] = r.byte();
  for (let i = 0; i < p; i++) people.names.push(r.text());
  for (let i = 0; i < p; i++) people.logins.push(r.text() || null);

  const f = r.uint();
  const parent = new Int32Array(f);
  parent[0] = -1;
  for (let i = 1; i < f; i++) parent[i] = i - r.uint();
  const folderNames = [""];
  for (let i = 1; i < f; i++) folderNames.push(r.text());

  const languages: string[] = [];
  const l = r.uint();
  for (let i = 0; i < l; i++) languages.push(r.text());

  const n = r.uint();
  const files: Atlas["files"] = { folder: new Int32Array(n), info: new Uint8Array(n), language: new Uint16Array(n), lines: new Int32Array(n) };
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev += r.int();
    files.folder[i] = prev;
  }
  for (let i = 0; i < n; i++) files.info[i] = r.byte();
  for (let i = 0; i < n; i++) files.language[i] = r.uint();
  for (let i = 0; i < n; i++) files.lines[i] = r.uint() - 1;

  const c = r.uint();
  const commits: Atlas["commits"] = { time: new Float64Array(c), person: new Int32Array(c), flags: new Uint8Array(c), start: new Uint32Array(c + 1) };
  let t = origin;
  for (let i = 0; i < c; i++) {
    t += r.uint();
    commits.time[i] = t;
  }
  for (let i = 0; i < c; i++) commits.person[i] = r.uint() - 1;
  for (let i = 0; i < c; i++) commits.flags[i] = r.byte();
  let total = 0;
  for (let i = 0; i < c; i++) {
    commits.start[i] = total;
    total += r.uint();
  }
  commits.start[c] = total;
  const changes: Atlas["changes"] = { file: new Int32Array(total), kind: new Uint8Array(total) };
  for (let i = 0; i < c; i++) {
    let before = 0;
    for (let j = commits.start[i] as number; j < (commits.start[i + 1] as number); j++) {
      before += r.int();
      changes.file[j] = before;
    }
  }
  for (let j = 0; j < total; j += 4) {
    const b = r.byte();
    for (let k = 0; k < 4 && j + k < total; k++) changes.kind[j + k] = (b >> (k * 2)) & 3;
  }

  const rn = r.uint();
  const releaseNames: string[] = [];
  for (let i = 0; i < rn; i++) releaseNames.push(r.text());
  const releaseTime = new Float64Array(rn);
  for (let i = 0; i < rn; i++) releaseTime[i] = origin + r.uint();
  return { mainline, origin, newest, people, folders: { parent, names: folderNames }, files, languages, commits, changes, releases: { names: releaseNames, time: releaseTime } };
}

/** File names as bytes, one after another in file order. */
export function encodeNames(names: AtlasNames): Uint8Array {
  const w = new ByteWriter();
  w.uint(names.names.length);
  for (const s of names.names) w.text(s);
  return w.bytes();
}

/** Reads bytes encodeNames wrote. */
export function decodeNames(bytes: Uint8Array): AtlasNames {
  const r = new ByteReader(bytes);
  const n = r.uint();
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(r.text());
  return { names };
}

/** The whole path of a folder, without a trailing slash; "" for the top. */
export function folderPath(a: Pick<Atlas, "folders">, folder: number): string {
  const parts: string[] = [];
  for (let f = folder; f > 0; f = a.folders.parent[f] as number) parts.push(a.folders.names[f] ?? "");
  return parts.reverse().join("/");
}
