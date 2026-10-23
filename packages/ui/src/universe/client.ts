import { useEffect, useState } from "react";
import type { Answers, Ask, Summary, Told } from "./protocol";

type Payload<K extends keyof Answers> = Omit<Extract<Ask, { type: K }>, "type" | "id">;

export class AtlasClient {
  private readonly worker: Worker;
  private next = 1;
  private readonly waiting = new Map<number, (value: unknown) => void>();
  private listeners = new Set<(m: Told) => void>();

  constructor(url: string) {
    this.worker = new Worker(new URL("./atlas.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<Told>) => {
      const m = e.data;
      if (m.type === "answer") {
        this.waiting.get(m.id)?.(m.value);
        this.waiting.delete(m.id);
        return;
      }
      for (const l of this.listeners) l(m);
    };
    this.worker.onerror = (e) => {
      for (const l of this.listeners) l({ type: "failed", message: e.message || "The Atlas could not be worked out in this browser." });
    };
    this.worker.postMessage({ type: "open", url } satisfies Ask);
  }

  listen(l: (m: Told) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  ask<K extends keyof Answers>(type: K, payload: Payload<K>): Promise<Answers[K]> {
    const id = this.next++;
    return new Promise((done) => {
      this.waiting.set(id, done as (value: unknown) => void);
      this.worker.postMessage({ type, id, ...payload } as unknown as Ask);
    });
  }

  close(): void {
    this.worker.terminate();
    this.waiting.clear();
    this.listeners.clear();
  }
}

export type AtlasState = { phase: "loading" } | { phase: "failed"; message: string } | { phase: "ready"; summary: Summary; client: AtlasClient; names: boolean; ms: number };

/** Opens the Atlas at an address in a worker and follows it from loading to ready, or to what went wrong. */
export function useAtlas(url: string | undefined): AtlasState {
  const [state, setState] = useState<{ url: string; state: AtlasState } | null>(null);
  useEffect(() => {
    if (!url) return;
    let client: AtlasClient;
    try {
      client = new AtlasClient(url);
    } catch {
      queueMicrotask(() => setState({ url, state: { phase: "failed", message: "This browser cannot run the worker the Universe is worked out in." } }));
      return;
    }
    const stop = client.listen((m) => {
      if (m.type === "ready") setState({ url, state: { phase: "ready", summary: m.summary, client, names: false, ms: m.ms } });
      else if (m.type === "failed") setState({ url, state: { phase: "failed", message: m.message } });
      else if (m.type === "names") setState((s) => (s && s.url === url && s.state.phase === "ready" ? { url, state: { ...s.state, names: true } } : s));
    });
    return () => {
      stop();
      client.close();
    };
  }, [url]);
  return state && state.url === url ? state.state : { phase: "loading" };
}
