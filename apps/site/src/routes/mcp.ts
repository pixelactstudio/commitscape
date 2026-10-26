import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { env } from "#/server/env";
import { json } from "#/server/http";
import { mcpAllowed, mcpServer } from "#/server/mcp";
import { deps, viewerOf } from "#/server/viewer";

async function handle(request: Request): Promise<Response> {
  if (!env.MCP_TOKEN) return json({ error: "This Site has no MCP server." }, 404);
  if (!mcpAllowed(request, env.MCP_TOKEN)) return json({ error: "Send the Site's MCP token as a bearer token." }, 401, { "www-authenticate": 'Bearer realm="commitscape"' });
  const anonymous = { ...viewerOf(request), sameOrigin: true, session: async () => null, token: async () => null };
  const server = mcpServer(deps(), anonymous);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
      DELETE: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
