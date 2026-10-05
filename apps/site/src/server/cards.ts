import "@tanstack/react-start/server-only";
import { Resvg } from "@resvg/resvg-js";
import { and, eq } from "drizzle-orm";
import { monthName, type AchievementCardData, type ArchetypeCardData, type CardImages, type WindowCardData, type WrappedCardData, type CardKind, type Facts, type HallOfFameData, type Profile, type ProfileCardData, type StandingCardData, type VersusCardData } from "@commitscape/data";
import { now, repoId, schema } from "@commitscape/server";
import { CARD_DESIGN, CARDS, DEFAULT_STYLE, isOffered, placesFor, styleKey, topLine, type CardSpec, type CardStyle, type CardTheme } from "@commitscape/ui";
import { renderCard, renderPending } from "@commitscape/ui/cards/render";
import { SiteError } from "./http";
import { survivingTotal } from "./engine";
import { isHidden } from "./people";
import { readProfile } from "./profiles";
import type { Deps } from "./repos";
import { standingsOf } from "./standings";
import { crewOf, raceOf } from "./races";
import { traitsOf } from "./traits";
import { wrappedFor } from "./wrapped";
import { versusOf } from "./versus";

const { profiles, repositories } = schema;

export const CARD_FOR = 6 * 3600;
const PENDING_FOR = 60;

export type CardDeps = Deps & { site: string; avatar?: (login: string) => Promise<string | null> };
export type Subject = { login?: string; owner?: string; repo?: string; versus?: string; achievement?: string; race?: string; crew?: string; year?: number };
export type Format = "svg" | "png";
export type Served = { body: Uint8Array; type: string; maxAge: number; ms: number | null };

const anonymous = { address: "cards", sameOrigin: true, session: async () => null, token: async () => null, login: async () => null };

const faces = new Map<string, Promise<string | null>>();

/** A GitHub avatar as a data URL, kept in memory; avatars come from GitHub's image host, never its API. */
export function avatarOf(login: string): Promise<string | null> {
  const key = login.toLowerCase();
  let found = faces.get(key);
  if (!found) {
    found = fetch(`https://github.com/${encodeURIComponent(login)}.png?size=96`)
      .then(async (r) => (r.ok ? `data:${r.headers.get("content-type") ?? "image/png"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}` : null))
      .catch(() => null);
    faces.set(key, found);
    if (faces.size > 2000) faces.delete(faces.keys().next().value as string);
  }
  return found;
}

async function images(deps: CardDeps, logins: (string | null)[]): Promise<CardImages> {
  const out: CardImages = {};
  await Promise.all(
    [...new Set(logins.filter((l): l is string => !!l))].map(async (l) => {
      const face = await (deps.avatar ?? avatarOf)(l);
      if (face) out[l.toLowerCase()] = face;
    }),
  );
  return out;
}

/** A person's Card numbers from their stored public Profile and the engine's counts, never from GitHub; null until a Profile is stored, when one is read in the background. */
export async function profileCardData(deps: CardDeps, login: string): Promise<ProfileCardData | null> {
  if (await isHidden(deps, login)) throw new SiteError(404, "This person has chosen to stay out, so they have no Cards.");
  const [row] = await deps.db
    .select({ data: profiles.data })
    .from(profiles)
    .where(and(eq(profiles.login, login.toLowerCase()), eq(profiles.scope, "public")));
  if (!row?.data) {
    void readProfile(deps, anonymous, login, true).catch(() => null);
    return null;
  }
  const p = JSON.parse(row.data) as Profile;
  const engine = await survivingTotal(deps.db, login);
  return {
    identity: { login: p.identity.login, name: p.identity.name },
    totals: p.totals,
    repositories: p.repositories.slice(0, 5),
    years: p.years,
    calendar: { firstDay: p.calendar.firstDay + Math.max(0, p.calendar.days.length - 380), days: p.calendar.days.slice(-380) },
    engine,
    at: p.fetchedAt,
  };
}

/** A person's place in one public repository, for its Card. */
export async function standingCardData(deps: CardDeps, login: string, owner: string, repo: string): Promise<StandingCardData> {
  if (await isHidden(deps, login)) throw new SiteError(404, "This person has chosen to stay out, so they have no Cards.");
  const s = await standingsOf(deps, anonymous, owner, repo);
  const row = s.people.find((r) => r.login?.toLowerCase() === login.toLowerCase());
  if (!row) throw new SiteError(404, "No Standing of that person in that repository.");
  const places = placesFor(s, row.key);
  return {
    identity: { login: row.login ?? login, name: row.name },
    repo: { owner: s.repo.owner, name: s.repo.name },
    places,
    people: s.people.length,
    top: topLine(s, places),
    numbers: { surviving: row.surviving, prsMerged: row.prsMerged, reviews: row.reviews, commits: row.commits },
  };
}

/** A public repository's people, for its hall of fame, with what GitHub says of the repository itself. */
export async function hallOfFameData(deps: CardDeps, owner: string, repo: string): Promise<HallOfFameData> {
  const s = await standingsOf(deps, anonymous, owner, repo);
  const id = repoId(s.repo.owner, s.repo.name);
  const [row] = id ? await deps.db.select({ facts: repositories.facts, language: repositories.language }).from(repositories).where(eq(repositories.id, id)) : [];
  const facts = factsOf(row?.facts ?? null);
  const top = s.people.slice(0, 10);
  return {
    repo: { owner: s.repo.owner, name: s.repo.name, stars: facts?.stars ?? s.repo.stars, forks: facts?.forks ?? null, description: facts?.description ?? null, language: facts?.languages[0]?.name ?? row?.language ?? null },
    people: top.map((r) => ({ login: r.login, name: r.login && top.filter((o) => o.name === r.name).length > 1 ? `@${r.login}` : r.name, surviving: r.surviving, prsMerged: r.prsMerged, commits: r.commits })),
    total: s.people.length,
  };
}

function factsOf(text: string | null): Facts | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Facts;
  } catch {
    return null;
  }
}

function keyOf(kind: CardKind, subject: Subject, theme: CardTheme, format: Format, style: CardStyle = DEFAULT_STYLE): string {
  const look = styleKey(style);
  return look ? baseKey(kind, subject, theme, format).replace(/\.(svg|png)$/, `-s-${look}.$1`) : baseKey(kind, subject, theme, format);
}

function baseKey(kind: CardKind, subject: Subject, theme: CardTheme, format: Format): string {
  if (subject.race) return `cards/races/${subject.race}/${kind}-${theme}-d${CARD_DESIGN}.${format}`;
  if (subject.crew) return `cards/crews/${subject.crew}/${kind}-${theme}-d${CARD_DESIGN}.${format}`;
  if (subject.versus) return `cards/vs/${subject.login?.toLowerCase()}/${subject.versus.toLowerCase()}/${kind}-${theme}-d${CARD_DESIGN}.${format}`;
  const who = subject.login ? `u/${subject.login.toLowerCase()}${subject.owner ? `/${subject.owner.toLowerCase()}/${subject.repo?.toLowerCase()}` : ""}` : `gh/${subject.owner?.toLowerCase()}/${subject.repo?.toLowerCase()}`;
  return `cards/${who}/${kind}${subject.achievement ? `-${subject.achievement}` : ""}${subject.year ? `-${subject.year}` : ""}-${theme}-d${CARD_DESIGN}.${format}`;
}

async function draw(deps: CardDeps, kind: CardKind, subject: Subject, theme: CardTheme, style: CardStyle): Promise<{ svg: string; png: Uint8Array; ms: number } | null> {
  let data: ProfileCardData | StandingCardData | HallOfFameData | VersusCardData | ArchetypeCardData | AchievementCardData | WindowCardData | WrappedCardData | null;
  let logins: (string | null)[];
  if (kind === "wrapped" || kind === "wrapped-calendar") {
    if (!(await profileCardData(deps, subject.login ?? ""))) return null;
    const w = await wrappedFor(deps, anonymous, subject.login ?? "", subject.year ?? 0);
    data = w;
    logins = [w.login];
  } else if (kind === "race") {
    const r = await raceOf(deps, null, subject.race ?? "");
    if (!r.standings) throw new SiteError(404, "This Race has not started.");
    data = { title: r.name, subtitle: `A Race from ${r.from} to ${r.to}, ${r.state === "finished" ? "finished" : "running"}`, rows: r.standings.rows };
    logins = r.standings.rows.map((x) => x.login);
  } else if (kind === "season") {
    const c = await crewOf(deps, null, subject.crew ?? "");
    const s = c.last && c.last.rows.length > 0 ? c.last : c.standings;
    if (!s) throw new SiteError(404, "This Crew has no Season yet.");
    data = { title: c.name, subtitle: `The Crew's Season of ${monthName(s.from.slice(0, 7))}${s === c.standings ? ", so far" : ""}`, rows: s.rows };
    logins = s.rows.map((x) => x.login);
  } else if (kind === "archetype" || kind === "achievement") {
    const login = subject.login ?? "";
    const card = await profileCardData(deps, login);
    if (!card) return null;
    const traits = await traitsOf(deps, anonymous, login);
    const identity = card.identity;
    if (kind === "archetype") data = { identity, archetype: traits.archetypes[0] ?? null, also: traits.archetypes.slice(1).map((a) => a.title) };
    else {
      const achievement = traits.achievements.find((a) => a.id === subject.achievement && a.earned);
      if (!achievement) throw new SiteError(404, "No such Achievement reached.");
      data = { identity, achievement };
    }
    logins = [identity.login];
  } else if (kind === "versus") {
    const v = await versusOf(deps, subject.login ?? "", subject.versus ?? "");
    data = { a: { identity: v.a.identity }, b: { identity: v.b.identity }, rows: v.rows };
    logins = [v.a.identity.login, v.b.identity.login];
  } else if (kind === "hall-of-fame") {
    const d = await hallOfFameData(deps, subject.owner ?? "", subject.repo ?? "");
    data = d;
    logins = [d.repo.owner, ...d.people.map((p) => p.login)];
  } else if (kind === "standing") {
    data = await standingCardData(deps, subject.login ?? "", subject.owner ?? "", subject.repo ?? "");
    logins = [data.identity.login];
  } else {
    data = await profileCardData(deps, subject.login ?? "");
    logins = data ? [data.identity.login] : [];
  }
  if (!data) return null;
  const spec = CARDS[kind] as CardSpec<typeof data>;
  const faces = await images(deps, logins);
  const started = performance.now();
  const out = await renderCard(spec, data, theme, { images: faces, site: deps.site, style });
  const png = new Resvg(out.still, { fitTo: { mode: "zoom", value: 2 } }).render().asPng();
  return { svg: out.animated, png, ms: performance.now() - started };
}

const refreshing = new Set<string>();

async function store(deps: CardDeps, kind: CardKind, subject: Subject, theme: CardTheme, style: CardStyle) {
  const drawn = await draw(deps, kind, subject, theme, style);
  if (!drawn || !isOffered(style)) return drawn;
  const at = String(now());
  await Promise.all([
    deps.storage.put(keyOf(kind, subject, theme, "svg", style), drawn.svg, { type: "image/svg+xml" }),
    deps.storage.put(keyOf(kind, subject, theme, "png", style), drawn.png, { type: "image/png" }),
    deps.storage.put(`${keyOf(kind, subject, theme, "svg", style)}.at`, at, { type: "text/plain" }),
  ]);
  return drawn;
}

/** A Card as an image in a style: the stored copy while it is under six hours old, a stale one while a new one is drawn in the background, and a plain "reading" card while nothing is stored yet; colours outside the offered swatches are drawn each time and never stored. */
export async function cardImage(deps: CardDeps, kind: CardKind, subject: Subject, theme: CardTheme, format: Format, style: CardStyle = DEFAULT_STYLE): Promise<Served> {
  for (const who of [subject.login, subject.versus]) if (who && (await isHidden(deps, who))) throw new SiteError(404, "This person has chosen to stay out, so they have no Cards.");
  const type = format === "svg" ? "image/svg+xml" : "image/png";
  const key = keyOf(kind, subject, theme, format, style);
  const [kept, at] = isOffered(style) ? await Promise.all([deps.storage.get(key), deps.storage.get(`${keyOf(kind, subject, theme, "svg", style)}.at`)]) : [null, null];
  if (kept) {
    const age = now() - Number(new TextDecoder().decode(at?.body ?? new Uint8Array()) || 0);
    if (age > CARD_FOR && !refreshing.has(key)) {
      refreshing.add(key);
      void store(deps, kind, subject, theme, style)
        .catch(() => null)
        .finally(() => refreshing.delete(key));
    }
    return { body: kept.body, type, maxAge: CARD_FOR, ms: null };
  }
  const drawn = await store(deps, kind, subject, theme, style);
  if (!drawn) {
    const svg = await renderPending(subject.login ?? "", theme, deps.site, kind === "preview" ? { width: 1200, height: 630 } : { width: 600, height: 236 });
    const body = format === "svg" ? new TextEncoder().encode(svg) : new Resvg(svg, { fitTo: { mode: "zoom", value: 2 } }).render().asPng();
    return { body, type, maxAge: PENDING_FOR, ms: null };
  }
  return { body: format === "svg" ? new TextEncoder().encode(drawn.svg) : drawn.png, type, maxAge: CARD_FOR, ms: drawn.ms };
}
