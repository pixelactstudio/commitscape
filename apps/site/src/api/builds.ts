/**
 * Builds (ADR-0015). `POST /api/builds` starts one for a public repository
 * whose Report is missing or a day old; the Builder then calls back, each
 * call signed: `progress`, the Report and its card uploaded (streamed into
 * R2, never read here), and `done`.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { FAILURE_WORDS, PRODUCT, SIGNATURE, sign, verify, type BuildOutcome, type BuildRequest, type BuildStep } from "@commitscape/data";
import { builds, repositories } from "../db/schema";
import { sameOrigin } from "./cookies";
import { address, json, now, says, sha256 } from "./http";
import { allow } from "./limits";
import { installationToken } from "./app";
import { BUILD_LOST_AFTER, TooManyLookups, lastBuild, lookupOf, resolve } from "./lookup";
import { randomId, same } from "./random";
import { repoId } from "./reports";

/** Builds an address may start in an hour. */
export const BUILD_LIMIT = { action: "build", max: 20, seconds: 3600 };
/**
 * People's Builds waiting or running at once, over every address: past it,
 * a new one is refused until some finish, so no one can queue hours of
 * work for the Builder. The night's seeds are not counted: they wait
 * behind people's Builds on the Builder.
 */
export const WAITING_MAX = 30;
/** The largest Report the Site stores, gzipped. */
export const REPORT_MAX = 64 * 1024 * 1024;
/** The largest card. */
export const CARD_MAX = 2 * 1024 * 1024;

export async function startBuild(request: Request, env: Env): Promise<Response> {
  const asked = (await request.json().catch(() => null)) as { owner?: unknown; name?: unknown } | null;
  const owner = typeof asked?.owner === "string" ? asked.owner : "";
  const name = typeof asked?.name === "string" ? asked.name : "";
  if (!repoId(owner, name)) return says(400, "That is not a GitHub repository's name.");
  const found = await resolve(request, env, owner, name).catch((e: unknown) => {
    if (e instanceof TooManyLookups) return "limited" as const;
    throw e;
  });
  if (found === "limited") return says(429, "This address has looked up many repositories this hour. Try again later.");
  if (!found) return says(503, "GitHub could not be asked just now. Try again in a moment.");
  const { row, access: seen } = found;
  const last = await lastBuild(env, row.id);
  const state = lookupOf(row, last, seen);
  if (seen === "not_connected") return says(403, FAILURE_WORDS.private);
  if (state.status === "not_found") return says(404, FAILURE_WORDS.not_found);
  if (!state.canBuild) return json(state);
  if (seen === "allowed" && !sameOrigin(request)) return says(403, "Not from this Site.");
  if (!(await allow(env.DB, BUILD_LIMIT, address(request)))) {
    return says(429, "This address has asked for many Builds this hour. Try again later.");
  }
  const waiting = await env.DB.prepare(
    "SELECT count(*) AS n FROM builds JOIN repositories ON repositories.id = builds.repo_id WHERE builds.state IN ('queued', 'running') AND builds.requested_at > ?1 AND repositories.seed = 0",
  )
    .bind(now() - BUILD_LOST_AFTER)
    .first<{ n: number }>();
  if ((waiting?.n ?? 0) >= WAITING_MAX) {
    return says(503, "The Builder has many repositories to read just now. Try again in a few minutes.");
  }
  const id = randomId();
  const uploadToken = randomId(32);
  const db = drizzle(env.DB);
  await db.insert(builds).values({ id, repoId: row.id, state: "queued", requestedAt: now(), uploadHash: await sha256(uploadToken) });
  // A Connected Repository's Build reads it with a one-hour installation
  // token, handed to the Builder and never stored (ADR-0017).
  const token = row.isPrivate && row.installationId ? await installationToken(env, row.installationId, row.name) : null;
  if (row.isPrivate && !token) {
    await db.update(builds).set({ state: "failed", reason: "private", finishedAt: now() }).where(eq(builds.id, id));
    return json(lookupOf(row, await lastBuild(env, row.id), seen), 202);
  }
  const payload: BuildRequest = {
    id,
    owner: row.owner,
    name: row.name,
    sizeKb: row.sizeKb ?? 0,
    private: row.isPrivate,
    token,
    uploadToken,
  };
  const body = JSON.stringify(payload);
  const sent = await fetch(`${env.BUILDER_URL.replace(/\/$/, "")}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json", [SIGNATURE]: await sign(env.BUILDER_SECRET, "POST", "/builds", body) },
    body,
  }).catch(() => null);
  if (!sent?.ok) {
    await db.update(builds).set({ state: "failed", reason: "paused", finishedAt: now() }).where(eq(builds.id, id));
  }
  return json(lookupOf(row, await lastBuild(env, row.id), seen), 202);
}

/** The Build a signed callback is about, or why not. */
async function signed(request: Request, env: Env, id: string, content: string) {
  const path = new URL(request.url).pathname;
  if (!(await verify(env.BUILDER_SECRET, request.headers.get(SIGNATURE), request.method, path, content))) return null;
  return drizzle(env.DB).select().from(builds).where(eq(builds.id, id)).get() ?? null;
}

export async function progress(request: Request, env: Env, id: string): Promise<Response> {
  const text = await request.text();
  const build = await signed(request, env, id, text);
  if (!build) return says(401, "Not signed by the Builder.");
  const step = (JSON.parse(text) as { step?: BuildStep }).step;
  if (step !== "reading" && step !== "uploading") return says(400, "No such step.");
  await drizzle(env.DB)
    .update(builds)
    .set({ state: "running", step, startedAt: build.startedAt ?? now() })
    .where(eq(builds.id, id));
  return json({ ok: true });
}

/** `PUT /api/builds/:id/report` and `…/card`: streamed into R2 as they come. */
export async function upload(request: Request, env: Env, id: string, what: "report" | "card"): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "-1");
  if (!Number.isSafeInteger(length) || length <= 0) return says(411, "Say how long it is.");
  if (length > (what === "report" ? REPORT_MAX : CARD_MAX)) return says(413, "Too large.");
  const build = await signed(request, env, id, `length:${length}`);
  if (!build) return says(401, "Not signed by the Builder.");
  const token = request.headers.get("x-upload-token") ?? "";
  if (!build.uploadHash || !same(await sha256(token), build.uploadHash)) return says(401, "Not this Build's upload.");
  if (build.state === "done" || build.state === "failed") return says(409, "This Build has ended.");
  const type = request.headers.get("content-type") ?? "";
  const extension = what === "report" ? "json.gz" : type === "image/png" ? "png" : "svg";
  if (what === "card" && type !== "image/png" && type !== "image/svg+xml") return says(415, "A card is a PNG or an SVG.");
  const key = `${what}s/gh/${build.repoId}/${id}.${extension}`;
  await env.REPORTS.put(key, request.body, { httpMetadata: { contentType: what === "report" ? "application/gzip" : type } });
  await drizzle(env.DB)
    .update(builds)
    .set(what === "report" ? { reportKey: key, reportBytes: length } : { cardKey: key })
    .where(eq(builds.id, id));
  return json({ ok: true });
}

/** The escapes an attribute's value needs. */
const attr = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/**
 * The repository's page: the app's shell with its social preview's tags
 * written in, stored in R2 and served for `/gh/<owner>/<name>` (ADR-0014:
 * written when the Report is built, never rendered per request).
 */
export async function writePage(env: Env, origin: string, row: typeof repositories.$inferSelect, card: string | null): Promise<string | null> {
  const shell = await env.ASSETS.fetch(new Request(`${origin}/index.html`));
  if (!shell.ok) return null;
  const facts = row.facts ? (JSON.parse(row.facts) as { description?: string | null }) : null;
  const title = `${row.owner}/${row.name} on ${PRODUCT}`;
  const words = facts?.description || "Who built it, who knows which part, what is fragile, and what changes together.";
  const url = `${origin}/gh/${row.owner}/${row.name}`;
  const tags = [
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(words)}">`,
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="${card ? "summary_large_image" : "summary"}">`,
    ...(card ? [`<meta property="og:image" content="${attr(`${origin}/api/cards/${row.owner}/${row.name}`)}">`] : []),
  ].join("");
  // A function, so a `$&` or `$'` in a description is only text.
  const html = (await shell.text()).replace("<head>", () => `<head>${tags}`);
  const key = `pages/gh/${row.id}.html`;
  await env.REPORTS.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  return key;
}

export async function done(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const text = await request.text();
  const build = await signed(request, env, id, text);
  if (!build) return says(401, "Not signed by the Builder.");
  if (build.state === "done" || build.state === "failed") return json({ ok: true });
  const outcome = JSON.parse(text) as BuildOutcome;
  const db = drizzle(env.DB);
  if (!outcome.ok || !build.reportKey) {
    await db
      .update(builds)
      .set({ state: "failed", reason: outcome.ok ? "error" : outcome.reason, finishedAt: now() })
      .where(eq(builds.id, id));
    return json({ ok: true });
  }
  const before = await db.select().from(repositories).where(eq(repositories.id, build.repoId)).get();
  if (!before) return says(404, "No such repository.");
  const stats = outcome.stats;
  const row = await db
    .update(repositories)
    .set({
      reportKey: build.reportKey,
      reportAt: now(),
      reportBytes: build.reportBytes,
      reportLines: outcome.lines,
      cardKey: build.cardKey ?? before.cardKey,
      // The Leaderboards' numbers, from the Builder: the Worker never reads a Report.
      ...(stats
        ? {
            busFactor: stats.bus_factor,
            maintainers: stats.maintainers,
            commits30d: stats.commits_30d,
            people30d: stats.people_30d,
            codeLines: stats.code_lines,
            untouched5y: stats.untouched_5y,
            ...(stats.answered !== undefined ? { answered: stats.answered, answerHours: stats.answer_hours ?? null } : {}),
          }
        : {}),
    })
    .where(eq(repositories.id, build.repoId))
    .returning()
    .get();
  await db
    .update(builds)
    .set({ state: "done", step: null, finishedAt: now(), seconds: Math.round(outcome.seconds), partial: outcome.partial })
    .where(eq(builds.id, id));
  // A Connected Repository gets no public page or card: nothing of it is
  // shown to anyone GitHub does not show it to.
  if (!row.isPrivate) {
    const origin = new URL(request.url).origin;
    const page = await writePage(env, origin, row, row.cardKey);
    if (page) await db.update(repositories).set({ pageKey: page }).where(eq(repositories.id, row.id));
  }
  // What the new Report and card replace.
  const old = [before.reportKey, before.cardKey !== row.cardKey ? before.cardKey : null].filter(
    (k): k is string => !!k && k !== row.reportKey,
  );
  if (old.length > 0) ctx.waitUntil(env.REPORTS.delete(old));
  return json({ ok: true });
}

/** `GET /api/cards/:owner/:name`: the card, for social previews. */
export async function card(env: Env, owner: string, name: string): Promise<Response> {
  const id = repoId(owner, name);
  if (!id) return says(400, "That is not a GitHub repository's name.");
  const row = await drizzle(env.DB)
    .select({ key: repositories.cardKey, status: repositories.status, isPrivate: repositories.isPrivate })
    .from(repositories)
    .where(eq(repositories.id, id))
    .get();
  const object = row?.key && row.status === "ok" && !row.isPrivate ? await env.REPORTS.get(row.key) : null;
  if (!object) return says(404, "No card of this repository yet.");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}

/** A repository's page: its stored one, with its preview's tags, or the app's shell. */
export async function page(request: Request, env: Env): Promise<Response> {
  const [, , owner = "", name = ""] = new URL(request.url).pathname.split("/");
  const decoded = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  };
  const id = repoId(decoded(owner), decoded(name));
  const row = id
    ? await drizzle(env.DB)
        .select({ key: repositories.pageKey, status: repositories.status, isPrivate: repositories.isPrivate })
        .from(repositories)
        .where(eq(repositories.id, id))
        .get()
    : null;
  const object = row?.key && row.status === "ok" && !row.isPrivate ? await env.REPORTS.get(row.key) : null;
  if (!object) return env.ASSETS.fetch(request);
  return new Response(object.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
