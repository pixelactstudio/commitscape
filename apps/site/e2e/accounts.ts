import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { symmetricEncrypt } from "better-auth/crypto";
import pg from "pg";

const root = resolve(import.meta.dirname, "../../..");
const SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e";
const site = `http://127.0.0.1:${process.env.SITE_PORT ?? 8790}`;
const ACCOUNTS: Record<string, string> = { alice: "1", bob: "2", dana: "3" };

export const SIGNED_IN = join(root, "target", "site-e2e-signed-in.json");

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
  const accountId = ACCOUNTS[login];
  if (accountId) {
    await sql(
      `INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, created_at, updated_at)
       VALUES ($1, $2, 'github', $3, $4, $5, now() + interval '8 hours', now() + interval '180 days', now(), now()) ON CONFLICT (id) DO NOTHING`,
      [`a-${login}`, accountId, userId, await symmetricEncrypt({ key: SECRET, data: `ghu_${login}` }), await symmetricEncrypt({ key: SECRET, data: `ghr_${login}` })],
    );
  }
  const token = randomBytes(24).toString("base64url");
  await sql(`INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, now() + interval '1 day', now())`, [randomBytes(12).toString("hex"), token, userId]);
  const signature = createHmac("sha256", SECRET).update(token).digest("base64");
  await context.addCookies([{ name: "commitscape.session_token", value: encodeURIComponent(`${token}.${signature}`), url: site }]);
}
