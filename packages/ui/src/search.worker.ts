/// <reference lib="webworker" />
// The commit search off the page's thread, for long lists (ADR-0019).
import { prepare, search, type Prepared, type Query } from "./search";

let prepared: Prepared | null = null;

self.onmessage = (e: MessageEvent<{ list?: Parameters<typeof prepare>[0]; id?: number; query?: Query }>) => {
  const m = e.data;
  if (m.list) {
    prepared = prepare(m.list);
    return;
  }
  if (!prepared || m.query === undefined) return;
  const rows = search(prepared, m.query);
  (self as unknown as Worker).postMessage({ id: m.id, rows }, [rows.buffer]);
};
