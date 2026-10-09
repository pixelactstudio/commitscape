import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { lookup, reportEntry, reportHead, requestBuild } from "#/server/repos";
import { deps, viewerOf } from "#/server/viewer";

const repo = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100) });

/** What the Site knows of a repository. */
export const getLookup = createServerFn({ method: "GET" })
  .validator(repo)
  .handler(({ data }) => lookup(deps(), viewerOf(getRequest()), data.owner, data.repo));

/** Starts a Build of a repository. */
export const startBuild = createServerFn({ method: "POST" })
  .validator(repo)
  .handler(({ data }) => requestBuild(deps(), viewerOf(getRequest()), data.owner, data.repo));

/** A Report's meta and Windows. */
export const getReportHead = createServerFn({ method: "GET" })
  .validator(repo)
  .handler(async ({ data }) => {
    const head = await reportHead(deps(), viewerOf(getRequest()), data.owner, data.repo);
    return { at: head.at, meta: head.index.meta, logins: head.logins, private: head.private };
  });

/** One answer of a Report. */
export const getReportEntry = createServerFn({ method: "GET" })
  .validator(repo.extend({ key: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => (await reportEntry(deps(), viewerOf(getRequest()), data.owner, data.repo, data.key)) ?? null);

