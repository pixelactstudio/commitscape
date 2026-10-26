import { describe, expect, test } from "vitest";
import { testDeps, viewer } from "#/test/deps";
import { mcpAllowed, mcpServer } from "./mcp";

const TOKEN = "a".repeat(40);
const asked = (authorization?: string) => new Request("https://commitscape.example/mcp", { method: "POST", headers: authorization ? { authorization } : {} });

describe("the MCP server", () => {
  test("answers only a client sending the Site's token, and nobody when the Site has none", () => {
    expect(mcpAllowed(asked(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
    expect(mcpAllowed(asked(`Bearer ${TOKEN}x`), TOKEN)).toBe(false);
    expect(mcpAllowed(asked(TOKEN), TOKEN)).toBe(false);
    expect(mcpAllowed(asked(), TOKEN)).toBe(false);
    expect(mcpAllowed(asked(`Bearer ${TOKEN}`), undefined)).toBe(false);
  });

  test("only reads: no tool starts a Build", async () => {
    const tools = Object.keys((mcpServer(await testDeps(), viewer()) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(tools.sort()).toEqual(["lookup_repository", "read_person", "read_profile", "read_report", "read_standings", "report_summary"]);
  });
});
