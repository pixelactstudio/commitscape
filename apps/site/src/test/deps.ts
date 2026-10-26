import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { memoryStorage, schema, type Db, type Queue } from "@commitscape/server";
import { forgetPack } from "#/server/answers";
import { engineOver, type EngineService } from "#/server/engine-service";
import type { Deps, Viewer } from "#/server/repos";

const migrations = fileURLToPath(new URL("../../../../packages/server/drizzle", import.meta.url));

export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

export type Asked = { endpoint: string; body: Record<string, any> };

export type FakeEngine = EngineService & { asked: Asked[] };

/** An engine service answering from `handle`: what it returns is the answer's JSON, undefined is no answer, and what it throws is thrown. */
export function fakeEngine(handle: (asked: Asked) => unknown = () => undefined): FakeEngine {
  const asked: Asked[] = [];
  const engine = engineOver(async (endpoint, body) => {
    asked.push({ endpoint, body });
    const found = await handle({ endpoint, body });
    return found === undefined ? null : JSON.stringify(found);
  });
  return Object.assign(engine, { asked });
}

/** Gives a Stored Index the pack the engine service answers it from. */
export async function packed(db: Db, si: number, pack = `packs/test/${si}/head-b1-lines.pack`): Promise<string> {
  await db.update(schema.storedIndexes).set({ pack }).where(eq(schema.storedIndexes.id, si));
  forgetPack(db, si);
  return pack;
}

export async function testDeps(over: Partial<Deps> = {}): Promise<Deps & { storage: ReturnType<typeof memoryStorage>; sent: string[] }> {
  const sent: string[] = [];
  const queue: Queue = { send: async (job) => void sent.push(job.buildId) };
  return { db: await testDb(), storage: memoryStorage(), github: { api: "http://github.test" }, app: null, queue: async () => queue, engine: fakeEngine(), sent, ...over } as Deps & {
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

export function signedIn(over: Partial<Viewer> = {}): Viewer {
  return viewer({ session: async () => ({ id: "s1", userId: "u1" }), ...over });
}
