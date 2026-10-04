import { createContext, useContext } from "react";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { key, type DataSource, type Params } from "@commitscape/data";

export const SourceContext = createContext<DataSource | null>(null);

export const StaleContext = createContext(false);

export function useSource(): DataSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error("No Data Source: wrap the app in <SourceContext value={…}>.");
  return source;
}

export type Loaded<T> = {
  data: T | null;
  error: string | null;
  stale: boolean;
};

type Answer<T> = { data: T; error: null } | { data: null; error: string };

/** The TanStack Query options for one answer, shared by loaders and screens; a missing answer is a value, not a throw. */
export function dataQuery<T>(source: DataSource, path: string, params: Params) {
  return {
    queryKey: ["report", source.id, key(path, params)] as const,
    queryFn: (): Promise<Answer<T>> =>
      source.get<T>(path, params).then(
        (data) => ({ data, error: null }),
        (e: unknown) => ({ data: null, error: e instanceof Error ? e.message : String(e) }),
      ),
    staleTime: Infinity,
    retry: false,
  };
}

/** One answer from the Data Source; suspends until it is there, so the server draws it and streams it in. */
export function useData<T>(path: string, params: Params): Loaded<T> & { data: T | null } {
  const source = useSource();
  const stale = useContext(StaleContext);
  const q = useSuspenseQuery(dataQuery<T>(source, path, params));
  return { data: q.data.data, error: q.data.error, stale };
}

/** An answer only some views need, asked in the browser without holding up the page. */
export function useLazyData<T>(path: string | null, params: Params): Loaded<T> {
  const source = useSource();
  const q = useQuery({ ...dataQuery<T>(source, path ?? "", params), enabled: path !== null, placeholderData: keepPreviousData });
  return { data: q.data?.data ?? null, error: q.data?.error ?? null, stale: q.isPlaceholderData };
}
