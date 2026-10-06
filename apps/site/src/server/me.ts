import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { removeReports, schema, type Db, type Storage } from "@commitscape/server";
import { asUser, type GitHubConfig } from "./github";
import { SiteError } from "./http";

export type Mine = {
  user: { login: string; name: string | null; avatar: string | null };
  installations: { id: number; account: string; repositories: { name: string; private: boolean; description: string | null }[] }[];
  install: string | null;
};

type Repo = { full_name: string; private: boolean; description: string | null };

/** The signed-in person and every repository the GitHub App may read for them. */
export async function mine(gh: GitHubConfig, user: { login: string; name: string | null; image: string | null }, token: string, slug?: string): Promise<Mine> {
  const installed = await asUser(gh, token, "/user/installations?per_page=100");
  if (installed.status === 401) throw new SiteError(401, "GitHub no longer accepts this sign-in. Sign in again.");
  const installations = ((await installed.json()) as { installations?: { id: number; account: { login: string } }[] }).installations ?? [];
  const lists = await Promise.all(
    installations.slice(0, 20).map(async (i) => {
      const answer = await asUser(gh, token, `/user/installations/${i.id}/repositories?per_page=100`);
      const repos = ((await answer.json()) as { repositories?: Repo[] }).repositories ?? [];
      return { id: i.id, account: i.account.login, repositories: repos.map((r) => ({ name: r.full_name, private: r.private, description: r.description })) };
    }),
  );
  return {
    user: { login: user.login, name: user.name, avatar: user.image },
    installations: lists,
    install: slug ? `https://github.com/apps/${slug}/installations/new` : null,
  };
}

/** Deletes a person's account, sessions and connected Reports. */
export async function deleteMyData(db: Db, storage: Storage, userId: string): Promise<number> {
  const theirs = await db.select().from(schema.repositories).where(eq(schema.repositories.connectedBy, userId));
  await removeReports(db, storage, theirs);
  const [who] = await db.select({ login: schema.user.login }).from(schema.user).where(eq(schema.user.id, userId));
  if (who?.login) {
    await db.delete(schema.profiles).where(and(eq(schema.profiles.login, who.login.toLowerCase()), eq(schema.profiles.scope, "self")));
    await db.delete(schema.people).where(eq(schema.people.login, who.login.toLowerCase()));
  }
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  return theirs.length;
}
