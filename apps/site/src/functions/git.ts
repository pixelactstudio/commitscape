import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { branchInsight, folderLast, gitStatus, pathHistory } from "#/server/git";
import { deps, viewerOf } from "#/server/viewer";

const repo = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100) });

/** What git data a repository has: the version its files are addressed by, and the counts. */
export const getGitStatus = createServerFn({ method: "GET" })
  .validator(repo)
  .handler(({ data }) => gitStatus(deps(), viewerOf(getRequest()), data.owner, data.repo));

/** How a file or folder has changed: how many commits, and the newest with who made them. */
export const getPathHistory = createServerFn({ method: "GET" })
  .validator(repo.extend({ path: z.string().max(1000) }))
  .handler(({ data }) => pathHistory(deps(), viewerOf(getRequest()), data.owner, data.repo, data.path));

/** For each file and folder right inside a folder, the newest commit that touched it. */
export const getFolderLast = createServerFn({ method: "GET" })
  .validator(repo.extend({ path: z.string().max(1000) }))
  .handler(({ data }) => folderLast(deps(), viewerOf(getRequest()), data.owner, data.repo, data.path));

/** Who holds the files a branch changes, and which of them the default branch changed after the branch left it. */
export const getBranchInsight = createServerFn({ method: "GET" })
  .validator(repo.extend({ position: z.number().int().min(0).max(100_000) }))
  .handler(({ data }) => branchInsight(deps(), viewerOf(getRequest()), data.owner, data.repo, data.position));
