import "@tanstack/react-start/server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@commitscape/server";
import type { Deps } from "./repos";

const { people } = schema;

/** The logins that chose to stay out of comparisons, from a list. */
export async function hiddenAmong(deps: Pick<Deps, "db">, logins: string[]): Promise<Set<string>> {
  const lower = [...new Set(logins.map((l) => l.toLowerCase()))];
  if (lower.length === 0) return new Set();
  const rows = await deps.db
    .select({ login: people.login })
    .from(people)
    .where(and(inArray(people.login, lower), eq(people.hidden, true)));
  return new Set(rows.map((r) => r.login));
}

/** Whether one login chose to stay out of comparisons. */
export async function isHidden(deps: Pick<Deps, "db">, login: string): Promise<boolean> {
  return (await hiddenAmong(deps, [login])).has(login.toLowerCase());
}

/** Keeps a person's own choices: staying out of comparisons, and naming their private work on their Profile. */
export async function saveChoices(deps: Pick<Deps, "db">, userId: string, login: string, choices: { hidden?: boolean; namePrivate?: boolean }): Promise<{ hidden: boolean; namePrivate: boolean }> {
  const key = login.toLowerCase();
  const values = { login: key, userId, hidden: choices.hidden ?? false, namePrivate: choices.namePrivate ?? false, updatedAt: Math.floor(Date.now() / 1000) };
  const set: Partial<typeof values> = { userId, updatedAt: values.updatedAt };
  if (choices.hidden !== undefined) set.hidden = choices.hidden;
  if (choices.namePrivate !== undefined) set.namePrivate = choices.namePrivate;
  const [row] = await deps.db.insert(people).values(values).onConflictDoUpdate({ target: people.login, set }).returning();
  return { hidden: row?.hidden ?? false, namePrivate: row?.namePrivate ?? false };
}

/** A person's own choices. */
export async function choicesOf(deps: Pick<Deps, "db">, login: string): Promise<{ hidden: boolean; namePrivate: boolean }> {
  const [row] = await deps.db.select().from(people).where(eq(people.login, login.toLowerCase()));
  return { hidden: row?.hidden ?? false, namePrivate: row?.namePrivate ?? false };
}
