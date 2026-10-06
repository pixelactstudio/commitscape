import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { profileCardData } from "#/server/cards";
import { engineOf } from "#/server/engine";
import { traitsOf } from "#/server/traits";
import { env } from "#/server/env";
import { deps, profileViewer } from "#/server/viewer";

/** What a person's Card gallery needs: their Card numbers, and the repositories they have a Standing in. */
export const getCardGallery = createServerFn({ method: "GET" })
  .validator(z.object({ login: z.string().min(1).max(39) }))
  .handler(async ({ data }) => {
    const site = new URL(env.BETTER_AUTH_URL).host;
    const card = await profileCardData({ ...deps(), site }, data.login);
    const engine = await engineOf(deps(), { ...profileViewer(getRequest()), login: async () => null }, data.login);
    const traits = card ? await traitsOf(deps(), { login: async () => null, token: async () => null }, data.login).catch(() => null) : null;
    return {
      card,
      standings: engine.repos.filter((r) => !r.private).slice(0, 4).map((r) => ({ owner: r.owner, name: r.name })),
      archetype: traits?.archetypes[0] ?? null,
      achievements: (traits?.achievements ?? []).filter((a) => a.earned).map((a) => ({ id: a.id, title: a.title, rule: a.rule })),
      origin: new URL(env.BETTER_AUTH_URL).origin,
    };
  });
