import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { codeLog, codeStory } from "#/server/code";
import { deps, viewerOf } from "#/server/viewer";

const asked = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100), path: z.string().max(1000) });

/** A file's or folder's story at HEAD, for the Code window's header. */
export const getCodeStory = createServerFn({ method: "GET" })
  .validator(asked)
  .handler(({ data }) => codeStory(deps(), viewerOf(getRequest()), data.owner, data.repo, data.path));

/** One page of the commits that touched a file or folder, for the Code window's History. */
export const getCodeLog = createServerFn({ method: "GET" })
  .validator(asked.extend({ page: z.number().int().min(1).max(100_000) }))
  .handler(({ data }) => codeLog(deps(), viewerOf(getRequest()), data.owner, data.repo, data.path, data.page));
