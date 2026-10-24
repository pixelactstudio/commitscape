import { createContext, useContext } from "react";
import type { GitTree } from "@commitscape/data";
import type { GitSource } from "../git/source";
import type { Go, Route } from "../route";

export type CodeCtx = {
  git: GitSource;
  route: Route;
  go: Go;
  repo: string;
  path: string;
  tree: GitTree | undefined;
  raw: string | null;
  head: string;
  open: (path: string, line?: number) => void;
  href: (path: string, line?: number) => string;
  link: (route: Route) => string;
};

export const CodeContext = createContext<CodeCtx | null>(null);

/** What everything inside the Code window shares: the repository's git data, the address, and how to open a path. */
export function useCode(): CodeCtx {
  const ctx = useContext(CodeContext);
  if (!ctx) throw new Error("useCode outside the Code window.");
  return ctx;
}
