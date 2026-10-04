import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, test } from "vitest";
import type { Profile } from "@commitscape/data";
import { now, schema } from "@commitscape/server";
import { CARDS } from "@commitscape/ui";
import { renderCard } from "@commitscape/ui/cards/render";
import { ACHIEVEMENT, ARCHETYPE, HALL, PROFILE, STANDING, VERSUS, WINDOW, WRAPPED } from "../../../../packages/ui/src/cards/fixture";
import { testDeps } from "#/test/deps";
import { CARD_FOR, cardImage, type CardDeps } from "./cards";
import { saveChoices } from "./people";

const { profiles } = schema;

const profile: Profile = {
  identity: { login: "alice", githubId: 1, name: "Alice Example", avatar: "", bio: null, company: null, location: null, website: null, twitter: null, followers: 0, createdAt: "2020-01-01T00:00:00Z", kind: "user" },
  fetchedAt: 1,
  scope: "public",
  totals: PROFILE.totals,
  years: PROFILE.years,
  months: [],
  calendar: PROFILE.calendar,
  repositories: PROFILE.repositories,
  partners: [],
  prs: [],
  read: { prs: 0, prsTotal: 0, requests: 0, complete: true },
  clock: null,
};

async function cardDeps(): Promise<CardDeps & { storage: Awaited<ReturnType<typeof testDeps>>["storage"]; faces: string[] }> {
  const base = await testDeps();
  const faces: string[] = [];
  return { ...base, site: "commitscape.example", avatar: async (login) => (faces.push(login), null), faces };
}

describe("a Card as an image", () => {
  test("drawn from the stored Profile, stored, then served as stored for six hours", async () => {
    const deps = await cardDeps();
    await deps.db.insert(profiles).values({ login: "alice", scope: "public", identity: JSON.stringify(profile.identity), identityAt: now(), data: JSON.stringify(profile), fetchedAt: now() });
    const first = await cardImage(deps, "totals", { login: "alice" }, "dark", "svg");
    expect(first.type).toBe("image/svg+xml");
    expect(first.maxAge).toBe(CARD_FOR);
    expect(first.ms).not.toBeNull();
    expect(new TextDecoder().decode(first.body)).toContain("@keyframes");
    const png = await cardImage(deps, "totals", { login: "alice" }, "dark", "png");
    expect(Array.from(png.body.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.ms).toBeNull();
    const again = await cardImage(deps, "totals", { login: "alice" }, "dark", "svg");
    expect(again.ms).toBeNull();
    expect(deps.faces).toEqual(["alice"]);
  });

  test("a stale one is served while a new one is drawn; with nothing stored, a reading card for a minute", async () => {
    const deps = await cardDeps();
    await deps.db.insert(profiles).values({ login: "alice", scope: "public", identity: JSON.stringify(profile.identity), identityAt: now(), data: JSON.stringify(profile), fetchedAt: now() });
    await cardImage(deps, "survival", { login: "alice" }, "light", "svg");
    const at = [...deps.storage.objects.keys()].find((k) => k.endsWith(".at")) ?? "";
    await deps.storage.put(at, String(now() - CARD_FOR - 10), { type: "text/plain" });
    const stale = await cardImage(deps, "survival", { login: "alice" }, "light", "svg");
    expect(stale.ms).toBeNull();
    await expect.poll(async () => Number(new TextDecoder().decode((await deps.storage.get(at))?.body))).toBeGreaterThan(now() - 60);
    const nobody = await cardImage(deps, "totals", { login: "nobody" }, "light", "svg");
    expect(nobody.maxAge).toBe(60);
    expect(new TextDecoder().decode(nobody.body)).toContain("<svg");
  });

  test("a hidden person has no Cards, stored or not", async () => {
    const deps = await cardDeps();
    await deps.db.insert(profiles).values({ login: "alice", scope: "public", identity: JSON.stringify(profile.identity), identityAt: now(), data: JSON.stringify(profile), fetchedAt: now() });
    await cardImage(deps, "totals", { login: "alice" }, "light", "png");
    await deps.db.insert(schema.user).values({ id: "u", name: "Alice", email: "a@example.com", login: "alice" });
    await saveChoices(deps, "u", "alice", { hidden: true });
    await expect(cardImage(deps, "totals", { login: "alice" }, "light", "png")).rejects.toThrow("no Cards");
  });
});

describe("every Card as a PNG", () => {
  const out = join(import.meta.dirname, "__snapshots__", "cards");
  mkdirSync(out, { recursive: true });
  const data = { totals: PROFILE, survival: PROFILE, repositories: PROFILE, calendar: PROFILE, languages: PROFILE, preview: PROFILE, standing: STANDING, "hall-of-fame": HALL, versus: VERSUS, archetype: ARCHETYPE, achievement: ACHIEVEMENT, race: WINDOW, season: WINDOW, wrapped: WRAPPED, "wrapped-calendar": WRAPPED } as const;
  for (const kind of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${kind} in ${theme}, under 200 ms`, async () => {
        const spec = CARDS[kind] as (typeof CARDS)["totals"];
        await renderCard(spec, data[kind] as never, theme, { images: {}, site: "commitscape.example" });
        const started = performance.now();
        const drawn = await renderCard(spec, data[kind] as never, theme, { images: {}, site: "commitscape.example" });
        const png = new Resvg(drawn.still, { fitTo: { mode: "zoom", value: 2 } }).render().asPng();
        const ms = performance.now() - started;
        expect(ms).toBeLessThan(200);
        writeFileSync(join(out, `${kind}-${theme}.png`), png);
        await expect(`${createHash("sha256").update(png).digest("hex")}\n`).toMatchFileSnapshot(join(out, `${kind}-${theme}.png.sha256`));
      });
    }
  }
});
