import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSource } from "../data";

/** Asks again for every answer of this Report that failed. */
export function useReload(): () => void {
  const source = useSource();
  const client = useQueryClient();
  return useCallback(() => void client.invalidateQueries({ queryKey: ["report", source.id] }), [client, source.id]);
}
