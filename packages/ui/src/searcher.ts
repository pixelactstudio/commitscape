/**
 * Runs the commit search where it is quickest: on the page for a short
 * list, in a Web Worker above 20,000 rows (ADR-0019), so typing never waits
 * for it. The worker is written into the page's own script, so a one-file
 * Report can start it too; where a worker cannot start, the page searches.
 */
import type { CommitList } from "@commitscape/data";
import { prepare, search, type Query } from "./search";
import SearchWorker from "./search.worker.ts?worker&inline";

export const WORKER_ABOVE = 50_000;

export type Searcher = {
  /** The matching rows; an older question still running is answered too. */
  run(q: Query): Promise<Int32Array>;
  close(): void;
  inWorker: boolean;
};

export function searcher(list: CommitList): Searcher {
  if (list.subjects.length > WORKER_ABOVE && typeof Worker !== "undefined") {
    try {
      const worker = new SearchWorker();
      worker.postMessage({
        list: { subjects: list.subjects, people: list.people, person: list.person, times: list.times, kind: list.kind },
      });
      let next = 0;
      const waiting = new Map<number, (rows: Int32Array) => void>();
      worker.onmessage = (e: MessageEvent<{ id: number; rows: Int32Array }>) => {
        waiting.get(e.data.id)?.(e.data.rows);
        waiting.delete(e.data.id);
      };
      return {
        inWorker: true,
        run(query) {
          const id = next++;
          return new Promise((resolve) => {
            waiting.set(id, resolve);
            worker.postMessage({ id, query });
          });
        },
        close: () => worker.terminate(),
      };
    } catch {
      // No worker here: search on the page.
    }
  }
  const prepared = prepare(list);
  return { inWorker: false, run: async (q) => search(prepared, q), close() {} };
}
