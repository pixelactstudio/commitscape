import type { ReactNode } from "react";
import type { CardImages, HallOfFameData } from "@commitscape/data";
import { compact, grouped, many } from "../format";
import { Eyebrow, Pill, Shell, type CardProps } from "./Cards";
import { clip, glass, inner, LANGUAGE_COLOURS, STAR } from "./parts";
import type { Paint } from "./paint";
import { FACES_ROW, FACES_SHOWN, HALL_SHOWN, hallOfFameSize, REPO_COMPACT_SIZE, REPO_STATS_SIZE, repoFacesSize } from "./sizes";
import { alpha, lookOf, type Look } from "./style";

type Who = HallOfFameData["people"][number];

const MEDALS = ["#e8b923", "#b9c0c9", "#cd8a52"];

function leadOf(data: HallOfFameData): { value: (p: Who) => number | null; one: string; more: string; by: string } {
  const lines = data.people.some((p) => (p.surviving ?? 0) > 0);
  return lines ? { value: (p) => p.surviving, one: "line running", more: "lines running", by: "lines still running" } : { value: (p) => p.commits, one: "commit", more: "commits", by: "commits" };
}

function ranked(data: HallOfFameData, most: number): Who[] {
  const lead = leadOf(data);
  return [...data.people].sort((a, b) => (lead.value(b) ?? -1) - (lead.value(a) ?? -1)).slice(0, most);
}

const short = (n: number) => (n >= 10_000 ? compact(n) : grouped(n));

function Face({ look, src, size, ring, square = false }: { look: Look; src: string | undefined; size: number; ring?: string; square?: boolean }) {
  const t = look.t;
  const radius = square ? inner(look, 6) : size;
  const edge = ring ? Math.max(2, Math.round(size / 20)) : 0;
  const body = src ? <img src={src} width={size} height={size} style={{ borderRadius: radius }} /> : <div style={{ display: "flex", width: size, height: size, borderRadius: radius, background: t.surface, border: `1px solid ${t.border}` }} />;
  if (!ring) return body;
  return <div style={{ display: "flex", padding: edge, borderRadius: radius + edge * 2, background: ring }}><div style={{ display: "flex", padding: edge, borderRadius: radius + edge, background: t.bg }}>{body}</div></div>;
}

function Header({ look, paint, data, images, size = 56, title = 28 }: { look: Look; paint: Paint; data: HallOfFameData; images: CardImages; size?: number; title?: number }) {
  const t = look.t;
  return (
    <div style={{ display: "flex", alignItems: "center", flexGrow: 1, minWidth: 0 }}>
      <Face look={look} src={images[data.repo.owner.toLowerCase()]} size={size} square />
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 14, minWidth: 0 }}>
        <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 0) }}>{`${data.repo.owner} /`}</span>
        <span style={{ fontSize: title, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.1, color: paint.mark("rise", t.text, 40) }}>{clip(data.repo.name, 26)}</span>
      </div>
    </div>
  );
}

function Stars({ look, data }: { look: Look; data: HallOfFameData }) {
  const t = look.t;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <Pill look={look}>
        <svg width={15} height={15} viewBox="0 0 24 24">
          <path d={STAR} fill={t.accent} />
        </svg>
        <span style={{ marginLeft: 6, fontWeight: 700, color: t.text }}>{compact(data.repo.stars)}</span>
      </Pill>
      {data.repo.forks !== null && data.repo.forks !== undefined && (
        <Pill look={look}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={t.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
            <path d="M12 12v3" />
          </svg>
          <span style={{ marginLeft: 6, fontWeight: 700, color: t.text }}>{compact(data.repo.forks)}</span>
        </Pill>
      )}
    </div>
  );
}

function Facts({ look, data, size = 14 }: { look: Look; data: HallOfFameData; size?: number }) {
  const t = look.t;
  const language = data.repo.language ?? null;
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize: size, color: t.muted }}>
      {language && (
        <div style={{ display: "flex", alignItems: "center", marginRight: 16 }}>
          <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, background: LANGUAGE_COLOURS[language] ?? t.faint, marginRight: 7 }} />
          <span style={{ color: t.text }}>{language}</span>
        </div>
      )}
      <span>{many(data.total, "contributor", "contributors")}</span>
    </div>
  );
}

function others(p: Who, lead: ReturnType<typeof leadOf>): string {
  if (lead.by !== "commits" && p.commits) return many(p.commits, "commit", "commits");
  return p.prsMerged ? many(p.prsMerged, "PR merged", "PRs merged") : "";
}

/** A repository's Card: its owner's face, name, what it is and its stars and forks, then the people who built it, the first three on a podium and the rest beneath, each with the one number they are ranked by. */
export function HallOfFameCard({ data, theme, paint, images, site, style }: CardProps<HallOfFameData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const lead = leadOf(data);
  const people = ranked(data, HALL_SHOWN);
  const podium = people.slice(0, 3);
  const rest = people.slice(3);
  const pairs: Who[][] = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push(rest.slice(i, i + 2));
  return (
    <Shell look={look} paint={paint} {...hallOfFameSize(data)} site={site} link={`${site}/gh/${data.repo.owner}/${data.repo.name}`}>
      <div style={{ display: "flex", alignItems: "center", height: 64 }}>
        <Header look={look} paint={paint} data={data} images={images} />
        <Stars look={look} data={data} />
      </div>
      <span style={{ display: "flex", height: 20, marginTop: 12, fontSize: 15, color: paint.mark("rise", data.repo.description ? t.text : t.faint, 80) }}>{data.repo.description ? clip(data.repo.description, 86) : "No description on GitHub"}</span>
      <div style={{ display: "flex", height: 20, marginTop: 10 }}>
        <Facts look={look} data={data} />
      </div>
      <div style={{ display: "flex", height: 1, marginTop: 16, marginBottom: 14, background: t.border }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 18, marginBottom: 8 }}>
        <Eyebrow t={t} p={paint} delay={100}>{people.length === 1 ? "Built by" : "Who built it"}</Eyebrow>
        <span style={{ fontSize: 12, color: t.faint }}>{`ranked by ${lead.by}`}</span>
      </div>
      <div style={{ display: "flex", gap: 10, height: 124 }}>
        {podium.map((p, i) => {
          const value = lead.value(p);
          const note = others(p, lead);
          return (
            <div key={`${p.login ?? p.name}${i}`} style={{ display: "flex", alignItems: "center", flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: "hidden", padding: "0 14px", borderRadius: inner(look), ...glass(look, i === 0) }}>
              <div style={{ display: "flex", position: "relative" }}>
                <Face look={look} src={p.login ? images[p.login.toLowerCase()] : undefined} size={44} ring={MEDALS[i]} />
                <div style={{ display: "flex", position: "absolute", right: -4, bottom: -4, width: 20, height: 20, borderRadius: 20, alignItems: "center", justifyContent: "center", background: MEDALS[i], border: `2px solid ${t.bg}`, fontSize: 11, fontWeight: 700, color: "#1a1a19" }}>{String(i + 1)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 14, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: paint.mark("rise", t.text, 160 + i * 80) }}>{clip(p.name, 15)}</span>
                <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.15, marginTop: 4, color: paint.mark("rise", i === 0 ? t.accent : t.text, 200 + i * 80) }}>{value !== null ? short(value) : "—"}</span>
                <span style={{ fontSize: 11, color: paint.mark("rise", t.muted, 240 + i * 80) }}>{value === 1 ? lead.one : lead.more}</span>
                {note && <span style={{ fontSize: 11, marginTop: 2, color: paint.mark("rise", t.faint, 260 + i * 80) }}>{note}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {pairs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
          {pairs.map((pair, row) => (
            <div key={row} style={{ display: "flex", gap: 28, height: 36 }}>
              {pair.map((p, k) => {
                const place = 4 + row * 2 + k;
                const value = lead.value(p);
                return (
                  <div key={`${p.login ?? p.name}${place}`} style={{ display: "flex", alignItems: "center", flexGrow: 1, flexBasis: 0, minWidth: 0, borderBottom: `1px solid ${alpha(t.text, 0.07)}` }}>
                    <span style={{ width: 24, fontSize: 12, fontWeight: 700, color: t.faint }}>{String(place)}</span>
                    <Face look={look} src={p.login ? images[p.login.toLowerCase()] : undefined} size={22} />
                    <span style={{ flexGrow: 1, marginLeft: 10, fontSize: 14, fontWeight: 600, color: paint.mark("rise", t.text, 320 + place * 40) }}>{clip(p.name, 24)}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: paint.mark("rise", t.muted, 340 + place * 40) }}>{value !== null ? short(value) : "—"}</span>
                  </div>
                );
              })}
              {pair.length === 1 && <div style={{ display: "flex", flexGrow: 1, flexBasis: 0 }} />}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/** A repository's small Card: its name, stars, forks and language, and a row of the faces who built it. */
export function RepoCompactCard({ data, theme, paint, images, site, style }: CardProps<HallOfFameData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const people = ranked(data, 8);
  const first = people[0];
  const more = Math.max(0, data.total - people.length);
  return (
    <Shell look={look} paint={paint} {...REPO_COMPACT_SIZE} site={site} link={`${site}/gh/${data.repo.owner}/${data.repo.name}`}>
      <div style={{ display: "flex", alignItems: "center", height: 64 }}>
        <Header look={look} paint={paint} data={data} images={images} size={60} title={26} />
        <Stars look={look} data={data} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
        <Facts look={look} data={data} size={13} />
        <div style={{ display: "flex", alignItems: "center" }}>
          {people.map((p, i) => (
            <div key={`${p.login ?? p.name}${i}`} style={{ display: "flex", marginLeft: i === 0 ? 0 : -8, padding: 2, borderRadius: 32, background: t.bg }}>
              <Face look={look} src={p.login ? images[p.login.toLowerCase()] : undefined} size={26} />
            </div>
          ))}
          {first && <span style={{ marginLeft: 10, fontSize: 13, color: paint.mark("rise", t.muted, 200) }}>{more > 0 ? `+${compact(more)}` : ""}</span>}
        </div>
      </div>
    </Shell>
  );
}

function Figure({ look, paint, value, label, note, delay, lead = false }: { look: Look; paint: Paint; value: string; label: string; note?: string; delay: number; lead?: boolean }) {
  const t = look.t;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 174, height: 76, padding: "12px 14px", borderRadius: inner(look), ...glass(look, lead) }}>
      <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.9, lineHeight: 1.05, color: paint.mark("rise", lead ? t.accent : t.text, delay) }}>{value}</span>
      <span style={{ fontSize: 12, marginTop: 5, color: paint.mark("rise", t.muted, delay + 60) }}>{label}</span>
      {note && <span style={{ fontSize: 10, marginTop: 1, color: paint.mark("rise", t.faint, delay + 90) }}>{note}</span>}
    </div>
  );
}

/** A repository's numbers Card: stars and forks from GitHub, and what commitscape counted at its last Build, each saying what it counts; a number not known is left out. */
export function RepoStatsCard({ data, theme, paint, images, site, style }: CardProps<HallOfFameData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const s = data.stats ?? null;
  const numbers: { value: string; label: string; note?: string }[] = [
    { value: compact(data.repo.stars), label: data.repo.stars === 1 ? "star" : "stars", note: "on GitHub" },
    ...(s?.commits !== null && s?.commits !== undefined ? [{ value: short(s.commits), label: "commits", note: "merges left out" }] : []),
    { value: grouped(data.total), label: data.total === 1 ? "contributor" : "contributors", note: "a commit, PR or review" },
    ...(s?.codeLines !== null && s?.codeLines !== undefined ? [{ value: compact(s.codeLines), label: "lines of code", note: "at HEAD" }] : []),
    ...(s?.maintainers !== null && s?.maintainers !== undefined ? [{ value: grouped(s.maintainers), label: s.maintainers === 1 ? "maintainer" : "maintainers", note: "3+ commits in 90 days" }] : []),
    ...(data.repo.forks !== null && data.repo.forks !== undefined ? [{ value: compact(data.repo.forks), label: data.repo.forks === 1 ? "fork" : "forks", note: "on GitHub" }] : []),
  ].slice(0, 6);
  return (
    <Shell look={look} paint={paint} {...REPO_STATS_SIZE} site={site} link={`${site}/gh/${data.repo.owner}/${data.repo.name}`}>
      <div style={{ display: "flex", alignItems: "center", height: 48 }}>
        <Header look={look} paint={paint} data={data} images={images} size={44} title={22} />
        <Eyebrow t={t} p={paint} delay={60}>By the numbers</Eyebrow>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: "auto" }}>
        {numbers.map((n, i) => (
          <Figure key={n.label} look={look} paint={paint} value={n.value} label={n.label} note={n.note} delay={140 + i * 90} lead={i === 0} />
        ))}
      </div>
    </Shell>
  );
}

/** A repository's people Card: the faces of the people who built it, most first, with their names. */
export function RepoFacesCard({ data, theme, paint, images, site, style }: CardProps<HallOfFameData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const lead = leadOf(data);
  const people = ranked(data, FACES_SHOWN);
  const rows: Who[][] = [];
  for (let i = 0; i < people.length; i += FACES_ROW) rows.push(people.slice(i, i + FACES_ROW));
  const more = Math.max(0, data.total - people.length);
  const cells = (row: Who[], r: number): ReactNode[] => {
    const out: ReactNode[] = row.map((p, k) => {
      const i = r * FACES_ROW + k;
      return (
        <div key={`${p.login ?? p.name}${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 74 }}>
          <Face look={look} src={p.login ? images[p.login.toLowerCase()] : undefined} size={i < 3 ? 44 : 52} ring={i < 3 ? MEDALS[i] : undefined} />
          <span style={{ marginTop: 7, fontSize: 12, fontWeight: 600, color: paint.mark("rise", t.text, 120 + i * 30) }}>{clip(p.name.split(" ")[0] ?? p.name, 10)}</span>
        </div>
      );
    });
    for (let k = row.length; k < FACES_ROW; k++) out.push(<div key={`gap${k}`} style={{ display: "flex", width: 74 }} />);
    return out;
  };
  return (
    <Shell look={look} paint={paint} {...repoFacesSize(data)} site={site} link={`${site}/gh/${data.repo.owner}/${data.repo.name}`}>
      <div style={{ display: "flex", alignItems: "center", height: 48 }}>
        <Header look={look} paint={paint} data={data} images={images} size={44} title={22} />
        <Stars look={look} data={data} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 18, marginTop: 14 }}>
        <Eyebrow t={t} p={paint} delay={80}>The people who built it</Eyebrow>
        <span style={{ fontSize: 12, color: t.faint }}>{`most ${lead.by} first${more > 0 ? `, and ${compact(more)} more` : ""}`}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
        {rows.map((row, r) => (
          <div key={r} style={{ display: "flex", justifyContent: "space-between", height: 96 }}>
            {cells(row, r)}
          </div>
        ))}
      </div>
    </Shell>
  );
}
