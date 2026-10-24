import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { gitBlobId, gitBlobKey, now, schema, seedIndex } from "@commitscape/server";
import { signedIn, testDeps, viewer } from "#/test/deps";
import { readThroughBlob } from "./blobs";
import { SiteError } from "./http";

const { access, repoGit, repositories, session, user } = schema;

const text = (s: string) => new TextEncoder().encode(s);
const MAIN = text("export const a = 1;\n");
const ODD = text("odd\n");
const BIG = text("x".repeat(300 * 1024));
const id = (b: Uint8Array) => gitBlobId(b);
const head = "a".repeat(40);

async function stored(fetched: string[], answers: Record<string, Uint8Array | number>) {
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(`${url} ${new Headers(init?.headers).get("authorization") ?? ""}`.trim());
    const found = answers[url];
    if (found === undefined) return new Response("missing", { status: 404 });
    if (typeof found === "number") return new Response("no", { status: found });
    return new Response(found as BodyInit);
  }) as typeof fetch;
  const deps = await testDeps({ github: { api: "http://github.test", fetcher } });
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
  ]);
  for (const repo of ["acme/rocket", "acme/secret"]) {
    await deps.db.insert(repoGit).values({ repoId: repo, prefix: `git/gh/${repo}`, buildId: "b1", builtAt: 900, head, branch: "main" });
    await seedIndex(deps.db, repo, {
      anchor: 1000,
      head,
      persons: [{ id: 1, name: "Ada" }],
      files: [
        { file: 0, path: "src/a.ts" },
        { file: 1, path: "pages/[...].tsx" },
        { file: 2, path: "dist/big.js" },
        { file: 3, path: "logo.png" },
      ],
      headFiles: [
        { file: 0, blob: id(MAIN), bytes: MAIN.length, lines: 1, class: "source" },
        { file: 1, blob: id(ODD), bytes: ODD.length, lines: 1, class: "source" },
        { file: 2, blob: id(BIG), bytes: BIG.length, lines: 1, class: "generated" },
        { file: 3, blob: "b".repeat(40), bytes: 10, lines: 0, class: "binary" },
      ],
      commits: [{ sha: head, at: 100, person: 1, subject: "first", files: [0, 1, 2, 3] }],
    });
  }
  return deps;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);
const body = (o: { object: { body: Uint8Array } | null }) => gunzipSync(o.object?.body ?? new Uint8Array()).toString();

describe("a file's text", () => {
  test("of a public repository not yet kept is read from raw.githubusercontent.com at the Stored Index's HEAD, checked, kept and served", async () => {
    const fetched: string[] = [];
    const raw = `https://raw.githubusercontent.com/acme/rocket/${head}/`;
    const deps = await stored(fetched, { [`${raw}src/a.ts`]: MAIN, [`${raw}pages/%5B...%5D.tsx`]: text("not it\n") });
    const first = await readThroughBlob(deps, viewer(), "acme", "rocket", id(MAIN));
    expect(body(first)).toBe("export const a = 1;\n");
    expect(first.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(await deps.storage.get(gitBlobKey("git/gh/acme/rocket", id(MAIN)))).not.toBeNull();
    expect(body(await readThroughBlob(deps, viewer(), "acme", "rocket", id(MAIN)))).toBe("export const a = 1;\n");
    expect(fetched).toEqual([`${raw}src/a.ts`]);
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", id(ODD)))).toEqual([502, "GitHub sent text that is not this file's."]);
    expect(await deps.storage.get(gitBlobKey("git/gh/acme/rocket", id(ODD)))).toBeNull();
  });

  test("is only read for a text file at HEAD small enough to show", async () => {
    const fetched: string[] = [];
    const deps = await stored(fetched, {});
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", "c".repeat(40)))).toEqual([404, "No file at this repository's HEAD has this text."]);
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", id(BIG)))).toEqual([413, "This file is too big to show."]);
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", "b".repeat(40)))).toEqual([415, "This file is not text."]);
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "rocket", "../x"))).toEqual([404, "No such file."]);
    expect(fetched).toEqual([]);
  });

  test("of a private repository is read through GitHub's git blobs API with a token that never leaves the server, and only for someone who may see it", async () => {
    const fetched: string[] = [];
    const deps = await stored(fetched, { [`http://github.test/repos/acme/secret/git/blobs/${id(MAIN)}`]: MAIN });
    expect(await failure(readThroughBlob(deps, viewer(), "acme", "secret", id(MAIN)))).toEqual([404, "No Report of this repository yet."]);
    await deps.db.insert(user).values({ id: "u1", name: "U", email: "u@example.com" });
    await deps.db.insert(session).values({ id: "s1", expiresAt: new Date(Date.now() + 1e6), token: "t", userId: "u1", updatedAt: new Date() });
    await deps.db.insert(access).values({ sessionId: "s1", repoId: "acme/secret", allowed: true, until: now() + 100 });
    const read = await readThroughBlob(deps, signedIn({ token: async () => "their-token" }), "acme", "secret", id(MAIN));
    expect(body(read)).toBe("export const a = 1;\n");
    expect(read.cacheControl).toBe("private, max-age=31536000, immutable");
    expect(fetched).toEqual([`http://github.test/repos/acme/secret/git/blobs/${id(MAIN)} Bearer their-token`]);
  });
});
