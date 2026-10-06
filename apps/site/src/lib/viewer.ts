import { getViewer } from "#/functions/account";

type Viewer = Awaited<ReturnType<typeof getViewer>>;

let kept: Promise<Viewer> | null = null;

/** Who is signed in, asked of the server once per page load in the browser rather than on every navigation. */
export function viewer(): Promise<Viewer> {
  if (typeof window === "undefined") return getViewer();
  kept ??= getViewer().catch((e: unknown) => {
    kept = null;
    throw e;
  });
  return kept;
}

/** Keeps the viewer the server drew the page for, so the first navigation need not ask again. */
export function rememberViewer(v: Viewer) {
  if (typeof window !== "undefined") kept ??= Promise.resolve(v);
}

/** Forgets who is signed in, so the next navigation asks again. */
export function forgetViewer() {
  kept = null;
}
