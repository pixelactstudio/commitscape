import type { Field } from "./field";
import type { Beacon, Described, FileFacts, FolderFacts, Found, PersonFacts, SlotSpan, Strike } from "@commitscape/data/universe";

export type Region = { folder: number; path: string; name: string; x: number; z: number; radius: number; files: number; depth: number; from: number; to: number; island: boolean };

export type Summary = {
  origin: number;
  newest: number;
  weeks: number;
  mainline: boolean;
  commits: number;
  people: { id: Int32Array; names: string[]; logins: (string | null)[]; bot: Uint8Array };
  count: number;
  x: Float32Array;
  z: Float32Array;
  born: Float32Array;
  died: Float32Array;
  borders: Float32Array;
  role: Float32Array;
  language: Float32Array;
  alive: Uint8Array;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  regions: Region[];
  languages: string[];
  strip: Uint32Array;
  slotsByWeek: Int32Array;
  history: SlotSpan[][];
  releases: { names: string[]; time: Float64Array };
  supers: { x: Float32Array; z: Float32Array; start: Uint32Array } | null;
  field: Field;
};

export type FrameAnswer = {
  at: number;
  from: number | null;
  height: Float32Array;
  colour: Float32Array;
  touched: Float32Array;
  slots: number[];
  beacons: Beacon[];
  tallest: number;
  strikes: Strike[];
};

export type Ask =
  | { type: "open"; url: string }
  | { type: "frame"; id: number; at: number; from: number | null; solo: number | null; after: number | null }
  | { type: "bots"; id: number; hide: boolean }
  | { type: "file"; id: number; rank: number; at: number }
  | { type: "folder"; id: number; folder: number; at: number }
  | { type: "person"; id: number; person: number; at: number }
  | { type: "describe"; id: number; at: number }
  | { type: "search"; id: number; q: string }
  | { type: "path"; id: number; kind: "file" | "folder"; ref: number }
  | { type: "lookup"; id: number; kind: "file" | "folder"; path: string }
  | { type: "home"; id: number; rank: number };

export type FileAnswer = FileFacts & { path: string; name: string };

export type Place = { folder: number; x: number; z: number; radius: number; from: number; to: number };

export type FolderAnswer = FolderFacts & Place;

export type Told =
  | { type: "ready"; summary: Summary; ms: number }
  | { type: "failed"; message: string }
  | { type: "names" }
  | { type: "answer"; id: number; value: unknown };

export type Answers = {
  frame: FrameAnswer;
  bots: Summary["strip"];
  file: FileAnswer;
  folder: FolderAnswer;
  person: PersonFacts;
  describe: Described;
  search: Found[];
  path: string;
  lookup: number;
  home: Place;
};
