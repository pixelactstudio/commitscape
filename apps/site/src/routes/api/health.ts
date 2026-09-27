import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "#/server/context";
import { json } from "#/server/http";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const ok = await db()
          .execute(sql`select 1`)
          .then(() => true)
          .catch(() => false);
        return json({ ok }, ok ? 200 : 503);
      },
    },
  },
});
