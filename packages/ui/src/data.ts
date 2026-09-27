/**
 * How the screens reach their Data Source (ADR-0013): through React
 * context, so the same screens read a local server, an inlined Report or a
 * fetched one, and never call `fetch` themselves.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { key, type DataSource, type Params } from "@commitscape/data";

export const SourceContext = createContext<DataSource | null>(null);

/** The Data Source the page was opened with. */
export function useSource(): DataSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error("No Data Source: wrap the app in <SourceContext value={…}>.");
  return source;
}

export type Loaded<T> = {
  data: T | null;
  error: string | null;
  /** Whether what is shown is for an earlier question. */
  stale: boolean;
};

/**
 * Asks the Data Source, again whenever the question or the server's
 * generation changes, keeping the last answer on screen until the next
 * arrives. `path` null asks nothing.
 */
export function useData<T>(path: string | null, params: Params, generation: number): Loaded<T> {
  const source = useSource();
  const asked = path === null ? null : key(path, params);
  const [answer, setAnswer] = useState<{ asked: string; data: T | null; error: string | null }>({
    asked: "",
    data: null,
    error: null,
  });
  useEffect(() => {
    if (path === null || asked === null) return;
    let current = true;
    source
      .get<T>(path, params)
      .then((data) => current && setAnswer({ asked, data, error: null }))
      .catch((e: Error) => current && setAnswer({ asked, data: null, error: e.message }));
    return () => {
      current = false;
    };
    // `asked` is the question: `params` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, generation, source]);
  return {
    data: answer.data,
    error: answer.asked === asked ? answer.error : null,
    stale: answer.asked !== asked,
  };
}
