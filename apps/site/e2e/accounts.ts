import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import pg from "pg";

const root = resolve(import.meta.dirname, "../../..");
const SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e";
const site = `http://127.0.0.1:${process.env.SITE_PORT ?? 8790}`;

export async function sql(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  const { databaseUrl } = JSON.parse(readFileSync(join(root, "target", "site-e2e-env.json"), "utf8")) as { databaseUrl: string };
  const client = new pg.Client(databaseUrl);
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Signs a browser in as a GitHub login, as Better Auth would after GitHub's sign-in: a user, a session, and its signed cookie. */
export async function signInAs(context: BrowserContext, login: string): Promise<void> {
  const userId = `u-${login}`;
  await sql(`INSERT INTO "user" (id, name, email, login, image) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [userId, login, `${login}@users.noreply.github.com`, login, `http://127.0.0.1/${login}.png`]);
  const token = randomBytes(24).toString("base64url");
  await sql(`INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, now() + interval '1 day', now())`, [randomBytes(12).toString("hex"), token, userId]);
  const signature = createHmac("sha256", SECRET).update(token).digest("base64");
  await context.addCookies([{ name: "commitscape.session_token", value: encodeURIComponent(`${token}.${signature}`), url: site }]);
}
