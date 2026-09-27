/**
 * The Worker (ADR-0014). Static assets never reach it; of what does, only
 * `/api/*` is ours, answered by `api.ts` without the page framework. The
 * rest is TanStack Start's handler, which builds the pages ahead of time.
 */
import handler from "@tanstack/react-start/server-entry";
import { api } from "./api";
import { page } from "./api/builds";
import { sweep } from "./api/limits";
import { expire } from "./api/shares";
import { sweepSessions } from "./api/auth";
import { retain } from "./api/webhooks";
import { boardsIfOld } from "./api/boards";
import { forgetMissing } from "./api/lookup";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, ctx);
    if (url.pathname.startsWith("/gh/")) return page(request, env);
    return handler.fetch(request);
  },
  /**
   * The Cron Trigger (wrangler.jsonc): expired Shared Reports, old
   * rate-limit counts, ended sessions, Connected Repositories' Reports
   * unseen for thirty days, names GitHub had no repository for a week
   * ago, and the Leaderboards once a day.
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([expire(env), sweep(env.DB), sweepSessions(env), retain(env), boardsIfOld(env), forgetMissing(env)]));
  },
} satisfies ExportedHandler<Env>;
