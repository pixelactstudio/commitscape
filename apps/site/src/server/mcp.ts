import "@tanstack/react-start/server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { key, PRODUCT } from "@commitscape/data";
import { z } from "zod";
import { leaderboards } from "./boards";
import { SiteError } from "./http";
import { lookup, reportEntry, reportHead, requestBuild, type Deps, type Viewer } from "./repos";

const SCREENS = { overview: "/api/overview", activity: "/api/activity", people: "/api/people", risk: "/api/risk", map: "/api/map" } as const;
const WINDOW = z.enum(["30d", "90d", "1y", "all"]).default("all").describe("The time range every number is computed over.");
const REPO = { owner: z.string().describe("The GitHub owner, like facebook."), repo: z.string().describe("The repository's name, like react.") };

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failed = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof SiteError ? e.message : "The Site could not answer." }] });

async function answer(run: () => Promise<unknown>) {
  try {
    return text(await run());
  } catch (e) {
    return failed(e);
  }
}

/** The MCP server AI agents use to look up and read public repositories' Reports. */
export function mcpServer(deps: Deps, viewer: Viewer): McpServer {
  const server = new McpServer({ name: PRODUCT, version: "1.0.0" });

  server.registerTool(
    "lookup_repository",
    {
      title: "Look up a repository",
      description: "GitHub's facts about a public repository, whether commitscape has read its history (its Report), and the state of its last Build.",
      inputSchema: REPO,
    },
    ({ owner, repo }) => answer(() => lookup(deps, viewer, owner, repo)),
  );

  server.registerTool(
    "read_report",
    {
      title: "Read a repository's Report",
      description:
        "One screen of a repository's Report: overview (story, hotspots, who holds what), activity (commits over time, rhythm), people (who worked on it), risk (hotspots, Bus Factor, coupling) or map (the code by folder). Build the Report first with request_build if lookup_repository says it has none.",
      inputSchema: {
        ...REPO,
        screen: z.enum(["overview", "activity", "people", "risk", "map"]),
        window: WINDOW,
        path: z.string().optional().describe("For map: a folder to open, like src/."),
      },
    },
    ({ owner, repo, screen, window, path }) =>
      answer(async () => {
        const params = screen === "map" && path ? { window, path } : { window };
        const found = await reportEntry(deps, viewer, owner, repo, key(SCREENS[screen], params));
        if (found === null) throw new SiteError(404, "The Report was written without that; try the top level or another window.");
        return found;
      }),
  );

  server.registerTool(
    "read_person",
    {
      title: "Read a person's profile",
      description: "One of the people who made most commits: when and what they work on. Their id comes from read_report's people screen.",
      inputSchema: { ...REPO, id: z.number().int().nonnegative(), window: WINDOW },
    },
    ({ owner, repo, id, window }) =>
      answer(async () => {
        const found = await reportEntry(deps, viewer, owner, repo, key("/api/person", { window, id }));
        if (found === null) throw new SiteError(404, "The Report holds profiles for the people who made most commits only.");
        return found;
      }),
  );

  server.registerTool(
    "report_summary",
    {
      title: "A Report's headline numbers",
      description: "When a repository's Report was built, its Windows, and its numbers for the Leaderboards: commits, people, Bus Factor, maintainers, lines of code.",
      inputSchema: REPO,
    },
    ({ owner, repo }) =>
      answer(async () => {
        const head = await reportHead(deps, viewer, owner, repo);
        return { builtAt: head.at, meta: head.index.meta, stats: head.index.stats };
      }),
  );

  server.registerTool(
    "request_build",
    {
      title: "Build a repository's Report",
      description: "Asks commitscape to read a public repository's history. Most take seconds, large ones a few minutes; poll lookup_repository until its build is done.",
      inputSchema: REPO,
    },
    ({ owner, repo }) => answer(() => requestBuild(deps, viewer, owner, repo)),
  );

  server.registerTool(
    "leaderboards",
    {
      title: "Leaderboards",
      description: "Popular repositories ranked by what commitscape measures: resting on one person, most maintainers, most active, fastest to answer issues, oldest code.",
      inputSchema: {},
    },
    () => answer(() => leaderboards(deps.db, 600)),
  );

  return server;
}
