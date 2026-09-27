import { createContext, useContext } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { key, type DataSource, type Params } from "@commitscape/data";

export const SourceContext = createContext<DataSource | null>(null);

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

/** The TanStack Query options for one answer, shared by loaders and screens. */
export function dataQuery<T>(source: DataSource, path: string, params: Params) {
  return {
    queryKey: ["report", source.id, key(path, params)] as const,
    queryFn: () => source.get<T>(path, params),
    staleTime: Infinity,
    retry: false,
  };
}

/** One answer from the Data Source, keeping the last one on screen while the next loads. */
export function useData<T>(path: string | null, params: Params): Loaded<T> {
  const source = useSource();
  const q = useQuery({ ...dataQuery<T>(source, path ?? "", params), enabled: path !== null, placeholderData: keepPreviousData });
  return { data: q.data ?? null, error: q.error ? q.error.message : null, stale: q.isPlaceholderData };
}
