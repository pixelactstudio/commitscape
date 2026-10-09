import { prepare, search, type CommitList, type Finder } from "@commitscape/data";
import SearchWorker from "./search.worker.ts?worker&inline";

export const WORKER_ABOVE = 50_000;

export type Searcher = Finder & {
  close(): void;
  inWorker: boolean;
};

/** Searches a Commit List in a Web Worker when it is long, on this thread when it is short. */
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
    }
  }
  const prepared = prepare(list);
  return { inWorker: false, run: async (q) => search(prepared, q), close() {} };
}
