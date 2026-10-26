import { describe, expect, test } from "vitest";
import { createDb } from "./client";

describe("createDb", () => {
  test("keeps idle connections for minutes, with TCP keep-alive, and lets a finished process exit", async () => {
    const { pool } = createDb("postgres://nobody@127.0.0.1:1/none", 3);
    expect(pool.options).toMatchObject({ max: 3, idleTimeoutMillis: 300_000, keepAlive: true, keepAliveInitialDelayMillis: 30_000, allowExitOnIdle: true });
    await pool.end();
  });
});
