import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { pullInsight } from "#/server/pull-insight";
import { pullStats } from "#/server/pull-stats";
import { listPulls, pullAuthors, pullConversation, pullHeader, pullLabels } from "#/server/pulls";
import { deps, viewerOf } from "#/server/viewer";

const repo = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100) });

const span = { window: z.enum(["30d", "90d", "1y", "all"]).optional(), from: z.number().int().min(0).max(1_000_000).optional(), to: z.number().int().min(0).max(1_000_000).optional() };

/** A repository's pull requests from Postgres, filtered, sorted and a page at a time. */
export const getPulls = createServerFn({ method: "GET" })
  .validator(
    repo.extend({
      state: z.enum(["open", "merged", "closed", "all"]).optional(),
      author: z.string().max(60).optional(),
      q: z.string().max(200).optional(),
      page: z.number().int().min(1).max(10_000).optional(),
      label: z.string().min(1).max(100).optional(),
      base: z.string().min(1).max(250).optional(),
      draft: z.boolean().optional(),
      sort: z.enum(["created", "updated", "merged", "closed", "size", "oldest", "comments"]).optional(),
      size: z.enum(["xs", "s", "m", "l", "xl"]).optional(),
      review: z.enum(["none", "reviewed", "approved", "changes"]).optional(),
      stale: z.boolean().optional(),
      ...span,
    }),
  )
  .handler(({ data }) => listPulls(deps(), viewerOf(getRequest()), data.owner, data.repo, data));

/** What a repository's pull requests add up to over the Window: opened, merged, how long merging and the first review took, the backlog, throughput, sizes and reviewer load. */
export const getPullStats = createServerFn({ method: "GET" })
  .validator(repo.extend(span))
  .handler(({ data }) => pullStats(deps(), viewerOf(getRequest()), data.owner, data.repo, data));

/** The people who opened pull requests, the most first, or those whose login holds some letters. */
export const getPullAuthors = createServerFn({ method: "GET" })
  .validator(repo.extend({ q: z.string().max(60).optional() }))
  .handler(({ data }) => pullAuthors(deps(), viewerOf(getRequest()), data.owner, data.repo, data.q));

/** The labels pull requests carry most. */
export const getPullLabels = createServerFn({ method: "GET" })
  .validator(repo)
  .handler(({ data }) => pullLabels(deps(), viewerOf(getRequest()), data.owner, data.repo));

/** Who holds the files of a pull request, the files that usually change with them, and the commits that name it. */
export const getPullInsight = createServerFn({ method: "GET" })
  .validator(repo.extend({ number: z.number().int().min(1) }))
  .handler(({ data }) => pullInsight(deps(), viewerOf(getRequest()), data.owner, data.repo, data.number));

/** One pull request's header, with whether its commits, files and diff were kept. */
export const getPull = createServerFn({ method: "GET" })
  .validator(repo.extend({ number: z.number().int().min(1) }))
  .handler(({ data }) => pullHeader(deps(), viewerOf(getRequest()), data.owner, data.repo, data.number));

/** A pull request's description and comments from GitHub, read with the signed-in person's own token. */
export const getPullConversation = createServerFn({ method: "GET" })
  .validator(repo.extend({ number: z.number().int().min(1) }))
  .handler(({ data }) => pullConversation(deps(), viewerOf(getRequest()), data.owner, data.repo, data.number));
