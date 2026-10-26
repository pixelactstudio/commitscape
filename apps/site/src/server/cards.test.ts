import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Profile } from "@commitscape/data";
import { now, schema } from "@commitscape/server";
import { CARDS } from "@commitscape/ui";
import { renderCard } from "@commitscape/ui/cards/render";
import { ACHIEVEMENT, ARCHETYPE, HALL, PROFILE, STANDING, VERSUS, WRAPPED } from "../../../../packages/ui/src/cards/fixture";
import { testDeps } from "#/test/deps";
import { CARD_FOR, cardImage, profileCardData, type CardDeps } from "./cards";
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

async function cardDeps(): Promise<CardDeps & { storage: Awaited<ReturnType<typeof testDeps>>["storage"]; sent: string[]; faces: string[] }> {
  const base = await testDeps();
  const faces: string[] = [];
  return { ...base, site: "commitscape.example", avatar: async (login) => (faces.push(login), null), faces };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  test("a stale one is served while a new one is drawn; with nothing stored, a pending card for a minute", async () => {
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

  test("for nobody signed in a Card reads nothing from GitHub and starts no Build: someone not read yet gets the pending Card, in a Versus too", async () => {
    const deps = await cardDeps();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      asked.push(String(input instanceof Request ? input.url : input));
      return new Response("{}", { status: 500 });
    });
    await deps.db.insert(profiles).values({ login: "alice", scope: "public", identity: JSON.stringify(profile.identity), identityAt: now(), data: JSON.stringify(profile), fetchedAt: now() });
    for (const [kind, subject] of [
      ["totals", { login: "nobody" }],
      ["archetype", { login: "nobody" }],
      ["wrapped", { login: "nobody", year: 2026 }],
      ["versus", { login: "alice", versus: "nobody" }],
    ] as const) {
      const card = await cardImage(deps, kind, subject, "light", "svg");
      expect(card.maxAge).toBe(60);
    }
    await new Promise((done) => setTimeout(done, 50));
    expect(asked).toEqual([]);
    expect(deps.sent).toEqual([]);
    expect(await deps.db.select().from(profiles)).toHaveLength(1);
  });

  test("a Profile is read for the Cards only through the reader the signed-in gallery gives, and only when none is stored", async () => {
    const deps = await cardDeps();
    let reads = 0;
    const read = async () => void reads++;
    expect(await profileCardData(deps, "alice")).toBeNull();
    expect(await profileCardData(deps, "alice", read)).toBeNull();
    expect(reads).toBe(1);
    await deps.db.insert(profiles).values({ login: "alice", scope: "public", identity: JSON.stringify(profile.identity), identityAt: now(), data: JSON.stringify(profile), fetchedAt: now() });
    expect(await profileCardData(deps, "alice", read)).toMatchObject({ identity: { login: "alice" } });
    expect(reads).toBe(1);
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

const BUDGET_MS = Number(process.env.CARD_BUDGET_MS ?? 200);

describe("every Card as a PNG", () => {
  const out = join(import.meta.dirname, "__snapshots__", "cards");
  mkdirSync(out, { recursive: true });
  const data = { totals: PROFILE, survival: PROFILE, repositories: PROFILE, calendar: PROFILE, languages: PROFILE, preview: PROFILE, standing: STANDING, "hall-of-fame": HALL, "repo-compact": HALL, "repo-stats": HALL, "repo-faces": HALL, versus: VERSUS, archetype: ARCHETYPE, achievement: ACHIEVEMENT, wrapped: WRAPPED, "wrapped-calendar": WRAPPED } as const;
  for (const kind of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${kind} in ${theme}, under 200 ms`, async () => {
        const spec = CARDS[kind] as (typeof CARDS)["totals"];
        await renderCard(spec, data[kind] as never, theme, { images: {}, site: "commitscape.example" });
        let ms = Infinity;
        let png: Uint8Array = new Uint8Array();
        for (let i = 0; i < 3; i++) {
          const started = performance.now();
          const drawn = await renderCard(spec, data[kind] as never, theme, { images: {}, site: "commitscape.example" });
          png = new Resvg(drawn.still, { fitTo: { mode: "zoom", value: 2 } }).render().asPng();
          ms = Math.min(ms, performance.now() - started);
        }
        writeFileSync(join(out, `${kind}-${theme}.png`), png);
        await expect(`${createHash("sha256").update(png).digest("hex")}\n`).toMatchFileSnapshot(join(out, `${kind}-${theme}.png.sha256`));
        expect(ms).toBeLessThan(BUDGET_MS);
      });
    }
  }
});
