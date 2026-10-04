import { useCallback } from "react";
import { useToast as useAstryxToast } from "@astryxdesign/core/Toast";

/** Shows a short confirmation at the edge of the screen. */
export function useToast() {
  const show = useAstryxToast();
  return useCallback((body: string, type: "info" | "error" = "info") => void show({ body, type, uniqueID: body }), [show]);
}
