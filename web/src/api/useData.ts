import { useEffect, useState } from "react";
import { get, key, type Params } from "./client";

export type Loaded<T> = {
  data: T | null;
  error: string | null;
  /** Whether what is shown is for an earlier question. */
  stale: boolean;
};

/**
 * Asks the API, again whenever the question or the server's generation
 * changes, keeping the last answer on screen until the next arrives.
 * `path` null asks nothing.
 */
export function useData<T>(path: string | null, params: Params, generation: number): Loaded<T> {
  const asked = path === null ? null : key(path, params);
  const [answer, setAnswer] = useState<{ asked: string; data: T | null; error: string | null }>({
    asked: "",
    data: null,
    error: null,
  });
  useEffect(() => {
    if (path === null || asked === null) return;
    let current = true;
    get<T>(path, params)
      .then((data) => current && setAnswer({ asked, data, error: null }))
      .catch((e: Error) => current && setAnswer({ asked, data: null, error: e.message }));
    return () => {
      current = false;
    };
    // `asked` is the question: `params` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, generation]);
  return {
    data: answer.data,
    error: answer.asked === asked ? answer.error : null,
    stale: answer.asked !== asked,
  };
}
