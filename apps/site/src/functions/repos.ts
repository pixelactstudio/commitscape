import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { siteAnalytics } from "#/server/context";
import { lookup, reportEntry, reportHead, requestBuild } from "#/server/repos";
import { deps, viewerOf } from "#/server/viewer";

const repo = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100) });

/** What the Site knows of a repository; each repository page served is counted once in ten minutes per person, with or without a Report. */
export const getLookup = createServerFn({ method: "GET" })
  .validator(repo)
  .handler(async ({ data }) => {
    const request = getRequest();
    const viewer = viewerOf(request);
    const found = await lookup(deps(), viewer, data.owner, data.repo);
    if (found.status !== "not_found") {
      const s = await viewer.session();
      siteAnalytics().capture("repository page served", { userId: s?.userId ?? null, headers: request.headers }, { report: !!found.report, lines: found.report?.lines ?? false, private: found.access !== "public" }, found.id);
    }
    return found;
  });

/** Starts a Build of a repository, and counts it when one is queued. */
export const startBuild = createServerFn({ method: "POST" })
  .validator(repo)
  .handler(async ({ data }) => {
    const request = getRequest();
    const viewer = viewerOf(request);
    const asked = Math.floor(Date.now() / 1000);
    const after = await requestBuild(deps(), viewer, data.owner, data.repo);
    if (after.build?.state === "queued" && after.build.requestedAt >= asked) {
      const s = await viewer.session();
      siteAnalytics().capture("build requested", { userId: s?.userId ?? null, headers: request.headers }, { first: !after.report, private: after.access !== "public" });
    }
    return after;
  });

/** A Report's meta and Windows. */
export const getReportHead = createServerFn({ method: "GET" })
  .validator(repo)
  .handler(async ({ data }) => {
    const head = await reportHead(deps(), viewerOf(getRequest()), data.owner, data.repo);
    return { at: head.at, meta: head.index.meta, logins: head.logins, private: head.private, ranges: head.ranges };
  });

/** One answer of a Report. */
export const getReportEntry = createServerFn({ method: "GET" })
  .validator(repo.extend({ key: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => (await reportEntry(deps(), viewerOf(getRequest()), data.owner, data.repo, data.key)) ?? null);

