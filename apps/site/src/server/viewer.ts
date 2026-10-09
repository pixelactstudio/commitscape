import "@tanstack/react-start/server-only";
import { auth, githubTokenOf } from "./auth";
import { builds, db, githubApp, reports } from "./context";
import { env } from "./env";
import { clientAddress, sameOrigin } from "./http";
import { loginOf } from "./logins";
import type { ProfileDeps, ProfileViewer } from "./profiles";
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

export function profileDeps(): ProfileDeps {
  return { db: db(), github: { api: env.GITHUB_API, token: env.GITHUB_TOKEN } };
}

/** A signed-in person's GitHub login, never their display name; null when GitHub cannot say. */
export function loginFor(request: Request, userId: string): Promise<string | null> {
  return loginOf(profileDeps(), userId, () => githubTokenOf(userId, request.headers));
}

/** The viewer as a Profile sees them: their GitHub login and token, when signed in. */
export function profileViewer(request: Request): ProfileViewer & Viewer {
  const viewer = viewerOf(request);
  let login: Promise<string | null> | undefined;
  return {
    ...viewer,
    login: () => (login ??= viewer.session().then((s) => (s ? loginFor(request, s.userId) : null))),
  };
}

/** The signed-in person's account id and GitHub login, or null. */
export async function personOf(request: Request): Promise<{ userId: string; login: string } | null> {
  const s = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!s) return null;
  const login = await loginFor(request, s.user.id);
  return login ? { userId: s.user.id, login } : null;
}
