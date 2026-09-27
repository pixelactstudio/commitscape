import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpServer } from "#/server/mcp";
import { deps, viewerOf } from "#/server/viewer";

async function handle(request: Request): Promise<Response> {
  const viewer = viewerOf(request);
  const anonymous = { ...viewer, sameOrigin: true, session: async () => null, token: async () => null };
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
