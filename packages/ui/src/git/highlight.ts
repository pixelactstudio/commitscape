export const SLOTS = ["", "keyword", "string", "comment", "number", "function", "type", "variable", "operator", "constant", "tag", "attribute", "property", "punctuation", "added-marker", "removed-marker", "heading", "link"] as const;

export type Slot = (typeof SLOTS)[number];

export type Asked = { id: number; code: string; lang: string };

export type Marked = { lines: [string, number][][] };

export type Answered = { id: number; marked: Marked | null };

const NONE = new Set(["text", "csv", ""]);
export const HIGHLIGHT_MAX = 400_000;

/** The class a token of a slot is drawn with: its colour is the theme's syntax token of that name, in light and dark. */
export const slotClass = (slot: number): string => (slot === 0 ? "" : `syn-${SLOTS[slot]}`);

const colourOf = (slot: Slot) => (slot === "heading" ? "var(--color-syntax-function)" : slot === "link" ? "var(--color-syntax-property)" : `var(--color-syntax-${slot})`);

/** The style sheet for the syntax classes, scoped under a selector: one colour per slot, from the Astryx syntax tokens. */
export function syntaxSheet(scope: string): string {
  return SLOTS.map((slot, i) => (i === 0 ? "" : `${scope} .syn-${slot}{color:${colourOf(slot)}${slot === "heading" ? ";font-weight:600" : ""}${slot === "comment" ? ";font-style:italic" : ""}}`)).join("");
}

let worker: Worker | null | undefined;
let next = 0;
const waiting = new Map<number, (marked: Marked | null) => void>();

function start(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Answered>) => {
      waiting.get(e.data.id)?.(e.data.marked);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** The syntax of some code as lines of [text, slot], worked out off the main thread by Shiki in the language named; null when it is not a language Shiki knows, the text is too long, or there is no worker. */
export function highlight(code: string, lang: string): Promise<Marked | null> {
  if (NONE.has(lang) || code.length > HIGHLIGHT_MAX) return Promise.resolve(null);
  const w = start();
  if (!w) return Promise.resolve(null);
  const id = next++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, code, lang } satisfies Asked);
  });
}
