import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { authorOf, commitSearch, graphqlAnswer } from "./graphql.ts";

const recorded = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "github", `${name}.json`), "utf8"));

function repo(owner: string, name: string, size: number, extra: Record<string, unknown> = {}) {
  return { full_name: `${owner}/${name}`, private: false, visibility: "public", description: null, stargazers_count: 0, forks_count: 0, open_issues_count: 0, size, default_branch: "main", topics: [], archived: false, created_at: "2024-01-01T00:00:00Z", pushed_at: null, ...extra };
}

const TOKENS: Record<string, string> = { "ghu_alice": "alice", "ghu_bob": "bob" };

function who(req: IncomingMessage, appKey: KeyObject): string | null {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (TOKENS[token]) return TOKENS[token] ?? null;
  const [head, claims, signature] = token.split(".");
  if (head && claims && signature && verify("sha256", Buffer.from(`${head}.${claims}`), appKey, Buffer.from(signature, "base64url"))) {
    const c = JSON.parse(Buffer.from(claims, "base64url").toString()) as { iss?: string; exp?: number };
    if (c.iss === "777" && (c.exp ?? 0) > Date.now() / 1000) return "app";
  }
  return null;
}

export const fake = { next: "alice", aliceSees: true };

export function fakeGitHub(port: number, appPublicKey: string): Promise<Server> {
  const appKey = createPublicKey(appPublicKey);
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/__as/")) {
      fake.next = url.pathname.slice("/__as/".length);
      return send(200, fake);
    }
    if (url.pathname === "/__alice_sees") {
      fake.aliceSees = url.searchParams.get("v") === "1";
      return send(200, fake);
    }
    if (url.pathname === "/login/oauth/authorize") {
      if (url.searchParams.get("client_id") !== "Iv1.test") return send(400, { error: "bad client" });
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", `code-${fake.next}`);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/login/oauth/access_token") {
      let text = "";
      req.on("data", (d) => (text += d));
      req.on("end", () => {
        const b = JSON.parse(text) as { client_id?: string; client_secret?: string; code?: string; refresh_token?: string };
        if (b.client_id !== "Iv1.test" || b.client_secret !== "test-client-secret") return send(200, { error: "incorrect_client_credentials" });
        const person = b.code?.replace("code-", "") ?? b.refresh_token?.replace("ghr_", "");
        if (person !== "alice" && person !== "bob") return send(200, { error: "bad_verification_code" });
        send(200, { access_token: `ghu_${person}`, expires_in: 28800, refresh_token: `ghr_${person}`, refresh_token_expires_in: 15897600, token_type: "bearer" });
      });
      return;
    }
    if (url.pathname === "/graphql" && req.method === "POST") {
      let text = "";
      req.on("data", (d) => (text += d));
      req.on("end", () => {
        const b = JSON.parse(text) as { query: string; variables?: Record<string, unknown> };
        send(200, graphqlAnswer(b.query, b.variables ?? {}));
      });
      return;
    }
    if (url.pathname === "/search/commits") return send(200, commitSearch(url.searchParams.get("q") ?? ""));
    const as = who(req, appKey);
    if (url.pathname === "/user") return as && as !== "app" ? send(200, recorded(`user-${as}`)) : send(401, { message: "Bad credentials" });
    if (url.pathname === "/user/installations") return send(200, as === "alice" ? recorded("installations-alice") : { total_count: 0, installations: [] });
    if (url.pathname === "/user/installations/42/repositories") return as === "alice" ? send(200, recorded("installation-42-repositories")) : send(404, { message: "Not Found" });
    if (url.pathname === "/repos/acme/private-thing/installation") return as === "app" ? send(200, { id: 42 }) : send(401, { message: "A JSON web token could not be decoded" });
    if (url.pathname === "/repos/bob/diary/installation") return send(404, { message: "Not Found" });
    if (url.pathname === "/repos/bob/diary") return as === "bob" ? send(200, repo("bob", "diary", 3, { private: true, visibility: "private" })) : send(404, { message: "Not Found" });
    if (url.pathname === "/app/installations/42/access_tokens") {
      return as === "app" ? send(201, { token: "ghs_install_42", expires_at: new Date(Date.now() + 3600_000).toISOString() }) : send(401, {});
    }
    if (url.pathname === "/search/repositories") {
      const shell = url.searchParams.get("q")?.includes('language:"Shell"');
      return send(200, { total_count: shell ? 1 : 0, incomplete_results: false, items: shell ? [{ ...recorded("acme-ownership"), language: "Shell", stargazers_count: 42 }] : [] });
    }
    const m = /^\/repos\/([^/]+)\/([^/?]+)(\/[a-z]+)?/.exec(url.pathname);
    if (!m) return send(404, { message: "Not Found" });
    const [, owner = "", name = "", part] = m;
    const id = `${owner}/${name}`.toLowerCase();
    let body: Record<string, unknown> | null;
    if (id === "acme/ownership") body = recorded("acme-ownership");
    else if (id === "acme/private-thing") body = as === "alice" && fake.aliceSees ? recorded("acme-private-thing") : null;
    else if (id === "acme/secret") body = repo(owner, name, 10, { private: true, visibility: "private" });
    else if (id === "acme/huge") body = repo(owner, name, 5_000_000);
    else if (id === "acme/slow" || /^acme\/r\d+$/.test(id)) body = repo(owner, name, 10);
    else body = null;
    if (!body) return send(404, { message: "Not Found" });
    if (part === "/languages") return send(200, id === "acme/ownership" ? { Text: 2400, Shell: 600 } : {});
    if (part === "/contributors") return send(200, id === "acme/ownership" ? [{ login: "alice", avatar_url: "http://127.0.0.1/a.png", contributions: 10 }] : []);
    if (part === "/releases") return send(200, []);
    if (part === "/issues") {
      const asked = id === "acme/ownership" ? 20 : 0;
      const comments = /\/issues\/(\d+)\/comments$/.exec(url.pathname);
      if (comments) return send(200, [{ created_at: "2026-01-01T03:30:00Z", user: { login: "bob", type: "User" } }]);
      return send(200, Array.from({ length: asked }, (_, i) => ({ number: i + 1, created_at: "2026-01-01T00:00:00Z", comments: i < 12 ? 1 : 0, user: { login: "alice", type: "User" } })));
    }
    if (part === "/commits") {
      const sha = url.searchParams.get("sha") ?? "";
      const login = /^[0-9a-f]{40}$/.test(sha) ? authorOf(name, sha) : null;
      return send(200, login ? [{ sha, author: { login } }] : []);
    }
    return send(200, body);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
