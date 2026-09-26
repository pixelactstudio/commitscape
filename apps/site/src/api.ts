/**
 * The Site's API, the only code that runs per request (ADR-0014). Each
 * handler reads or writes D1 or R2 and returns: well inside the free plan's
 * 10 ms of CPU. Routes are matched by hand, so no framework's router runs
 * on every request.
 */
import { callback, deleteMyData, me, signIn, signOut } from "./api/auth";
import { getBoards, seeds, writeBoardsNow } from "./api/boards";
import { card, done, progress, startBuild, upload } from "./api/builds";
import { says } from "./api/http";
import { lookup } from "./api/lookup";
import { report } from "./api/reports";
import { createShare, deleteShare, getShare, uploadShare } from "./api/shares";
import { webhook } from "./api/webhooks";

type Handler = (request: Request, env: Env, ctx: ExecutionContext, ...parts: string[]) => Promise<Response>;
type Route = [method: string, pattern: RegExp, handler: Handler];

const ID = "([A-Za-z0-9_-]{8,64})";
const ROUTES: Route[] = [
  ["GET", /^\/api\/repos\/([^/]+)\/([^/]+)$/, (r, env, _c, owner, name) => lookup(r, env, owner ?? "", name ?? "")],
  ["GET", /^\/api\/reports\/([^/]+)\/([^/]+)$/, (r, env, ctx, owner, name) => report(r, env, ctx, owner ?? "", name ?? "")],
  ["GET", /^\/api\/cards\/([^/]+)\/([^/]+)$/, (_r, env, _c, owner, name) => card(env, owner ?? "", name ?? "")],
  ["POST", /^\/api\/builds$/, (r, env) => startBuild(r, env)],
  ["POST", new RegExp(`^/api/builds/${ID}/progress$`), (r, env, _c, id) => progress(r, env, id ?? "")],
  ["PUT", new RegExp(`^/api/builds/${ID}/report$`), (r, env, _c, id) => upload(r, env, id ?? "", "report")],
  ["PUT", new RegExp(`^/api/builds/${ID}/card$`), (r, env, _c, id) => upload(r, env, id ?? "", "card")],
  ["POST", new RegExp(`^/api/builds/${ID}/done$`), (r, env, ctx, id) => done(r, env, ctx, id ?? "")],
  ["POST", /^\/api\/shares$/, (r, env) => createShare(r, env)],
  ["PUT", /^\/api\/shares\/([A-Za-z0-9_-]{16,64})$/, (r, env, _c, id) => uploadShare(r, env, id ?? "")],
  ["GET", /^\/api\/shares\/([A-Za-z0-9_-]{16,64})$/, (_r, env, _c, id) => getShare(env, id ?? "")],
  ["DELETE", /^\/api\/shares\/([A-Za-z0-9_-]{16,64})$/, (r, env, _c, id) => deleteShare(r, env, id ?? "")],
  ["GET", /^\/api\/auth\/github$/, async (r, env) => signIn(r, env)],
  ["GET", /^\/api\/auth\/callback$/, (r, env) => callback(r, env)],
  ["POST", /^\/api\/auth\/signout$/, (r, env) => signOut(r, env)],
  ["GET", /^\/api\/me$/, (r, env) => me(r, env)],
  ["POST", /^\/api\/me\/delete$/, (r, env) => deleteMyData(r, env)],
  ["POST", /^\/api\/github\/webhooks$/, (r, env) => webhook(r, env)],
  ["POST", /^\/api\/seeds$/, (r, env) => seeds(r, env)],
  ["POST", /^\/api\/leaderboards\/write$/, (r, env) => writeBoardsNow(r, env)],
  ["GET", /^\/api\/leaderboards$/, (_r, env) => getBoards(env)],
];

export async function api(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  const matched = ROUTES.filter(([, pattern]) => pattern.test(path));
  if (matched.length === 0) return says(404, "No such API.");
  const route = matched.find(([method]) => method === request.method);
  if (!route) return says(405, "Not with that method.");
  const [, pattern, handler] = route;
  let parts: string[];
  try {
    parts = (pattern.exec(path) ?? []).slice(1).map(decodeURIComponent);
  } catch {
    return says(400, "That address is not well formed.");
  }
  try {
    return await handler(request, env, ctx, ...parts);
  } catch (e) {
    console.error(path, e);
    return says(500, "Something went wrong on the Site. Try again in a moment.");
  }
}
