import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { db } from "#/server/context";
import { env } from "#/server/env";
import { clientAddress } from "#/server/http";
import { allow } from "#/server/limits";
import { searchGitHub } from "#/server/search";

const LIMIT = { action: "search", max: 90, seconds: 60 };

/** People and repositories on GitHub for the search box. */
export const search = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().max(80) }))
  .handler(async ({ data }) => {
    if (!(await allow(db(), LIMIT, clientAddress(getRequest(), env.CLIENT_IP_HEADER)))) return { people: [], repositories: [] };
    return searchGitHub({ api: env.GITHUB_API, token: env.GITHUB_TOKEN }, data.q);
  });
