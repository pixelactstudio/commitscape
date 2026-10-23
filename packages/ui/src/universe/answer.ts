import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** The answer to an asynchronous question, kept with the key it was asked under: null until it comes and whenever the key has moved on, so a stale answer is never shown, unless it shares `keep` with the key asked now, in which case the last answer stays up while the new one comes. A null key asks nothing. */
export function useAnswer<T>(key: string | null, ask: () => Promise<T>, delay = 0, keep?: string): T | null {
  const [got, setGot] = useState<{ key: string; keep: string | undefined; value: T } | null>(null);
  const latest = useRef(ask);
  useLayoutEffect(() => {
    latest.current = ask;
  });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const id = setTimeout(() => {
      void latest.current().then((value) => {
        if (live) setGot({ key, keep, value });
      });
    }, delay);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [key, delay, keep]);
  if (key === null || got === null) return null;
  return got.key === key || (keep !== undefined && got.keep === keep) ? got.value : null;
}
