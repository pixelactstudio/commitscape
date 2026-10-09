import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "#/server/auth";
import { db } from "#/server/context";
import { SiteError } from "#/server/http";
import { choicesOf, saveChoices } from "#/server/people";
import { standingsOf } from "#/server/standings";
import { deps, loginFor, profileViewer } from "#/server/viewer";

const where = z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100), focus: z.string().max(39).optional() });

/** Everyone's Standings in a repository the Site has built. */
export const getStandings = createServerFn({ method: "GET" })
  .validator(where)
  .handler(({ data }) => standingsOf(deps(), profileViewer(getRequest()), data.owner, data.repo, data.focus));

async function signedIn() {
  const s = await auth.api.getSession({ headers: getRequest().headers });
  if (!s) throw new SiteError(401, "Not signed in.");
  const login = await loginFor(getRequest(), s.user.id);
  if (!login) throw new SiteError(401, "Not signed in with GitHub.");
  return { userId: s.user.id, login };
}

/** The signed-in person's choices: hidden from comparisons, private work named on their Profile. */
export const getMyChoices = createServerFn({ method: "GET" }).handler(async () => {
  const me = await signedIn().catch(() => null);
  return me ? { login: me.login, ...(await choicesOf({ db: db() }, me.login)) } : null;
});

/** Saves the signed-in person's choices. */
export const saveMyChoices = createServerFn({ method: "POST" })
  .validator(z.object({ hidden: z.boolean().optional(), namePrivate: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const me = await signedIn();
    return { login: me.login, ...(await saveChoices({ db: db() }, me.userId, me.login, data)) };
  });
