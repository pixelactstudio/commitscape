import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes a migration into drizzle/ from src/db/schema.ts;
// Wrangler applies them (`wrangler d1 migrations apply`).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
