import "@tanstack/react-start/server-only";
import { auth, githubTokenOf } from "./auth";
import { builds, db, githubApp, reports } from "./context";
import { env } from "./env";
import { clientAddress, sameOrigin } from "./http";
import type { Deps, Viewer } from "./repos";

export function deps(): Deps {
  return { db: db(), storage: reports(), github: { api: env.GITHUB_API, token: env.GITHUB_TOKEN }, app: githubApp(), queue: builds };
}

/** Who a request is from; their session and GitHub token are read only when needed. */
export function viewerOf(request: Request): Viewer {
  let session: Promise<{ id: string; userId: string } | null> | undefined;
  let token: Promise<string | null> | undefined;
  const who = () =>
    (session ??= auth.api
      .getSession({ headers: request.headers })
      .then((s) => (s ? { id: s.session.id, userId: s.user.id } : null))
      .catch(() => null));
  return {
    address: clientAddress(request, env.CLIENT_IP_HEADER),
    sameOrigin: sameOrigin(request, env.BETTER_AUTH_URL),
    session: who,
    token: () => (token ??= who().then((s) => (s ? githubTokenOf(s.userId, request.headers) : null))),
  };
}
