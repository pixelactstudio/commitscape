import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { memoryStorage, schema, type Db, type Queue } from "@commitscape/server";
import type { Deps, Viewer } from "#/server/repos";

const migrations = fileURLToPath(new URL("../../../../packages/server/drizzle", import.meta.url));

export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

export async function testDeps(over: Partial<Deps> = {}): Promise<Deps & { storage: ReturnType<typeof memoryStorage>; sent: string[] }> {
  const sent: string[] = [];
  const queue: Queue = { send: async (job) => void sent.push(job.buildId) };
  return { db: await testDb(), storage: memoryStorage(), github: { api: "http://github.test" }, app: null, queue: async () => queue, sent, ...over } as Deps & {
    storage: ReturnType<typeof memoryStorage>;
    sent: string[];
  };
}

export function viewer(over: Partial<Viewer> = {}): Viewer {
  return { address: "203.0.113.9", sameOrigin: true, session: async () => null, token: async () => null, ...over };
}

export function fakeGitHub(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.pathname);
    const found = answers[url.pathname];
    if (found === undefined) return new Response("{}", { status: 404 });
    return Response.json(found);
  };
  return { asked, fetcher: fetcher as typeof fetch };
}

export const repoFacts = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  full_name: "acme/rocket",
  description: "A rocket",
  stargazers_count: 10,
  size: 100,
  default_branch: "main",
  created_at: "2020-01-01T00:00:00Z",
  ...extra,
});
