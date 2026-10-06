import type { ReactNode } from "react";
import { ordinal, type CardImages, type HallOfFameData, type ProfileCardData, type ProfileRepo, type StandingCardData, type VersusCardData, type ArchetypeCardData, type AchievementCardData, type WindowCardData, type WrappedCardData, leadersOf, WINDOW_VIEWS } from "@commitscape/data";
import { compact, grouped, many } from "../format";
import { STILL, type Paint } from "./paint";
import { versusValue } from "./values";
import { calendarSize, CELL, GAP, hallOfFameSize, languagesSize, repositoriesSize, STANDING_SIZE, SURVIVAL_SIZE, TOTALS_SIZE, versusSize, ARCHETYPE_SIZE, ACHIEVEMENT_SIZE, windowSize, WRAPPED_CALENDAR_SIZE } from "./sizes";
import { alpha, lookOf, mix, type CardStyle, type Look } from "./style";
import type { CardTheme, Tokens } from "./tokens";

export type CardProps<T> = { data: T; theme: CardTheme; paint: Paint; images: CardImages; site: string; style?: CardStyle };

const LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIiBmaWxsPSJub25lIj48cGF0aCBkPSJNMCAyMEMwIDEyLjUyMzEgMCA4Ljc4NDYxIDEuNjA3NjkgNkMyLjY2MDkxIDQuMTc1NzcgNC4xNzU3NyAyLjY2MDkxIDYgMS42MDc2OUM4Ljc4NDYxIDAgMTIuNTIzMSAwIDIwIDBDMjcuNDc2OSAwIDMxLjIxNTQgMCAzNCAxLjYwNzY5QzM1LjgyNDIgMi42NjA5MSAzNy4zMzkxIDQuMTc1NzcgMzguMzkyMyA2QzQwIDguNzg0NjEgNDAgMTIuNTIzMSA0MCAyMEM0MCAyNy40NzY5IDQwIDMxLjIxNTQgMzguMzkyMyAzNEMzNy4zMzkxIDM1LjgyNDIgMzUuODI0MiAzNy4zMzkxIDM0IDM4LjM5MjNDMzEuMjE1NCA0MCAyNy40NzY5IDQwIDIwIDQwQzEyLjUyMzEgNDAgOC43ODQ2MSA0MCA2IDM4LjM5MjNDNC4xNzU3NyAzNy4zMzkxIDIuNjYwOTEgMzUuODI0MiAxLjYwNzY5IDM0QzAgMzEuMjE1NCAwIDI3LjQ3NjkgMCAyMFoiIGZpbGw9IiMwMERDMzMiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTI4LjA0NDEgNy42MDkyN0MyOC44ODY4IDYuODAzMzEgMzAuMjE1MiA2Ljc5OTY1IDMxLjA2MjIgNy41ODIyOUwzMS4xNDI1IDcuNjYwMDVMMzEuNDE2NCA3Ljk0NzI5QzM0LjE5MTEgMTAuOTMxOCAzNS4yMjUxIDE0LjQwOTggMzQuOTU5OSAxNy44MDY1QzM0LjY5MDggMjEuMjUxMSAzMy4xMDEyIDI0LjQ5OTQgMzAuODgzNiAyNy4wNjY0QzI4LjY2NzMgMjkuNjMxNiAyNS43MDg0IDMxLjY1MTkgMjIuNTEgMzIuNTI4N0MxOS4yNzE0IDMzLjQxNjQgMTUuNzI5NCAzMy4xMzM0IDEyLjY1NDcgMzAuOTYyOUMxMC4wNDY5IDI5LjEyMTggOS4wNTQwNiAyNi4xNDY1IDguOTg2NjEgMjMuMjU2MUM3LjUyMzIzIDIyLjUzODQgNS45ODM0NiAyMS42NDYzIDQuMzY3ODkgMjAuNTYxNUwzLjk0MSAyMC4yNzE2TDMuODUwMDYgMjAuMjA2QzIuOTMyODUgMTkuNTA1MyAyLjcyMzEzIDE4LjIwODQgMy4zOTE2MSAxNy4yNTY0QzQuMDYwMjkgMTYuMzA0MyA1LjM2MjMzIDE2LjA0NiA2LjM0NjY1IDE2LjY1MTJMNi40NDEzNCAxNi43MTI2TDYuODMwMjQgMTYuOTc3MUM3Ljc5ODA1IDE3LjYyNjkgOC43MjE1MyAxOC4xOTAzIDkuNTk5NjYgMTguNjc2N0MxMC4xNjYxIDE2LjY4ODkgMTEuMTA0NyAxNC43ODAyIDEyLjM0MTMgMTMuMjA3QzE0LjE5MzggMTAuODUwMSAxNi45NzEzIDguOTY1MjUgMjAuMzc0IDkuMjQ2NDdDMjMuNDM5IDkuNDk5OTUgMjUuNzAzNiAxMS4wODEgMjYuODcyNSAxMy4zMTIyQzI4LjAwNDQgMTUuNDcyOCAyOC4wMjExIDE4LjA3MTkgMjcuMDMxOSAyMC4zMDdDMjYuMDIzNCAyMi41ODU3IDIzLjk3NiAyNC40ODQgMjEuMDMwOSAyNS4yNjYyQzE4LjkxMTQgMjUuODI5MSAxNi40Mjg0IDI1Ljc5MDUgMTMuNjI2NyAyNS4wMzY3VjI1LjAzNzdDMTIuNTExNSAyNC43Mzc1IDExLjM0MjcgMjQuMzIzIDEwLjEyMTIgMjMuNzg0NkM5Ljg0NzIgMjMuNjYzOCA5LjYwODczIDIzLjg0ODMgMTAuMTIxMiAyNC4xNjg2QzExLjU2MzYgMjUuMTkyNCAxMy41OTU2IDI2LjA1MDUgMTQuMTgzNiAyNi4zMzg1QzE0LjQ2MTUgMjYuNzg4IDE0LjgwNjEgMjcuMTU2OCAxNS4yMDExIDI3LjQzNTZDMTcuMDE4OCAyOC43MTg4IDE5LjE0NTEgMjguOTUzOSAyMS4zMzk2IDI4LjM1MjNDMjMuNTc0MyAyNy43Mzk3IDI1LjgxNDEgMjYuMjYyNSAyNy41NTE0IDI0LjI1MTZDMjkuMjg3MyAyMi4yNDIzIDMwLjQwNjUgMTkuODM0OCAzMC41OTA5IDE3LjQ3MjdDMzAuNzY1IDE1LjI0MzkgMzAuMTIxOCAxMi45NTQzIDI4LjE4NDIgMTAuODczNkwyNy45OTI3IDEwLjY3MzFMMjcuOTE2MiAxMC41OTA2QzI3LjE1MzggOS43Mjc0OCAyNy4yMDE4IDguNDE1MTYgMjguMDQ0MSA3LjYwOTI3Wk0yMC4wMDkyIDEzLjU2NTFDMTguNjAzMyAxMy40NDg5IDE3LjExOTYgMTQuMTg5IDE1LjgwMTMgMTUuODY2MkMxNC43OTczIDE3LjE0MzYgMTQuMDM3NiAxOC44MDMzIDEzLjY1MDMgMjAuNTExMkMxNi40MDkzIDIxLjQ1NDQgMTguNDY1NSAyMS40NjA4IDE5Ljg5NDIgMjEuMDgxNEMyMS41NDgxIDIwLjY0MjIgMjIuNTM5OSAxOS42NDc3IDIzLjAxNzIgMTguNTY5M0MyMy41MTM3IDE3LjQ0NzIgMjMuNDYyOCAxNi4yMjQ1IDIyLjk4MTMgMTUuMzA1NUMyMi41MzY5IDE0LjQ1NzEgMjEuNjQyMiAxMy43MDAyIDIwLjAwOTIgMTMuNTY1MVoiIGZpbGw9IndoaXRlIi8+PC9zdmc+";

const font = "Inter";

const SHORT_VIEW: Record<string, string> = { surviving: "lines running", prsMerged: "PRs merged", reviews: "reviews", linesAdded: "lines added", commits: "commits" };

function paper(look: Look, width: number, height: number) {
  const b = look.backdrop(width, height);
  return b.backgroundImage ? { backgroundImage: b.backgroundImage, backgroundSize: b.backgroundSize } : {};
}

const inner = (look: Look, less = 10) => (look.radius === 0 ? 0 : Math.max(6, look.radius - less));

function glass(look: Look, lead = false) {
  const t = look.t;
  const dark = look.theme === "dark";
  if (lead) return { backgroundColor: alpha(mix(t.bg, t.accent, dark ? 0.16 : 0.1), look.background === "plain" ? 1 : 0.84), border: `1px solid ${alpha(t.accent, dark ? 0.4 : 0.32)}` };
  return { backgroundColor: look.background === "plain" ? t.surface : alpha(t.bg, dark ? 0.62 : 0.74), border: `1px solid ${alpha(t.text, dark ? 0.1 : 0.08)}` };
}

function Eyebrow({ t, p, children, delay = 0 }: { t: Tokens; p: Paint; children: string; delay?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", width: 7, height: 7, borderRadius: 2, marginRight: 8, background: p.mark("rise", t.accent, delay) }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: p.mark("rise", t.accent, delay) }}>{children}</span>
    </div>
  );
}

type ShellProps = { look: Look; paint: Paint; width: number; height: number; children: ReactNode; site: string; login?: string; link?: string; eyebrow?: string; meta?: string; padX?: number };

function Shell({ look, paint, width, height, children, site, login, link, eyebrow, meta, padX = 26 }: ShellProps) {
  const t = look.t;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, height, padding: `22px ${padX}px 18px`, backgroundColor: t.bg, ...paper(look, width, height), border: `1px solid ${t.border}`, borderRadius: look.radius, fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      {(eyebrow || meta) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 16, marginBottom: 12 }}>
          {eyebrow ? <Eyebrow t={t} p={paint}>{eyebrow}</Eyebrow> : <div style={{ display: "flex" }} />}
          {meta && <span style={{ fontSize: 12, color: paint.mark("rise", t.muted, 40) }}>{meta}</span>}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>{children}</div>
      <Footer t={t} site={site} login={login} link={link} />
    </div>
  );
}

function Footer({ t, site, login, link, scale = 1 }: { t: Tokens; site: string; login?: string; link?: string; scale?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 * scale }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <img src={LOGO} width={16 * scale} height={16 * scale} style={{ borderRadius: 4.5 * scale }} />
        <span style={{ marginLeft: 7 * scale, fontSize: 13 * scale, fontWeight: 600, letterSpacing: -0.2, color: t.muted }}>commitscape</span>
      </div>
      {(link ?? login) && <span style={{ fontSize: 12 * scale, color: t.muted }}>{link ?? `${site}/u/${login}`}</span>}
    </div>
  );
}

function Avatar({ look, src, size }: { look: Look; src: string | undefined; size: number }) {
  const t = look.t;
  const ring = Math.max(2, Math.round(size / 22));
  return (
    <div style={{ display: "flex", padding: ring, borderRadius: size, backgroundColor: t.accent }}>
      {src ? <img src={src} width={size} height={size} style={{ borderRadius: size, border: `${ring}px solid ${t.bg}` }} /> : <div style={{ display: "flex", width: size, height: size, borderRadius: size, background: t.surface, border: `${ring}px solid ${t.bg}` }} />}
    </div>
  );
}

function Person({ look, p, login, name, images, size = 44 }: { look: Look; p: Paint; login: string; name: string | null; images: CardImages; size?: number }) {
  const t = look.t;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <Avatar look={look} src={images[login.toLowerCase()]} size={size} />
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 12 }}>
        <span style={{ fontSize: size > 40 ? 19 : 16, fontWeight: 700, letterSpacing: -0.3, color: p.mark("rise", t.text, 0) }}>{name ?? login}</span>
        <span style={{ fontSize: 13, color: p.mark("rise", t.muted, 60) }}>{`@${login}`}</span>
      </div>
    </div>
  );
}

function Tile({ look, p, value, label, note, delay, lead = false, grow = 1, big = 24 }: { look: Look; p: Paint; value: string; label: string; note?: string | null; delay: number; lead?: boolean; grow?: number; big?: number }) {
  const t = look.t;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: grow, flexBasis: 0, padding: "11px 13px 12px", borderRadius: inner(look), ...glass(look, lead) }}>
      <span style={{ fontSize: big, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.1, color: p.mark("rise", lead ? t.accent : t.text, delay) }}>{value}</span>
      <span style={{ fontSize: 12, lineHeight: 1.3, marginTop: 4, color: p.mark("rise", t.muted, delay + 60) }}>{label}</span>
      {note && <span style={{ fontSize: 11, lineHeight: 1.3, marginTop: 2, color: p.mark("rise", t.faint, delay + 90) }}>{note}</span>}
    </div>
  );
}

function yearsOf(data: ProfileCardData): string | null {
  const years = data.years.map((y) => y.year);
  if (years.length === 0) return null;
  const [first, last] = [Math.min(...years), Math.max(...years)];
  return first === last ? `on GitHub in ${first}` : `on GitHub, ${first}–${last}`;
}

const count = (n: number) => (n >= 100_000 ? compact(n) : grouped(n));

function covered(e: NonNullable<ProfileCardData["engine"]>, short = false): string {
  const of = e.of && e.of > e.repositories ? e.of : null;
  if (short) return of ? `in ${grouped(e.repositories)} of ${many(of, "repo", "repos")} read` : `in ${many(e.repositories, "repo", "repos")} read`;
  return of ? `Counted in ${grouped(e.repositories)} of the ${many(of, "public repository", "public repositories")} I committed to; the rest are not read yet.` : `Counted in the ${many(e.repositories, "public repository", "public repositories")} of mine commitscape has read.`;
}

/** A person's headline numbers. */
export function TotalsCard({ data, theme, paint, images, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const d = data.totals;
  const e = data.engine;
  const span = yearsOf(data);
  const stats = [
    ...(e ? [{ value: compact(e.surviving), label: "lines that still run", note: covered(e, true), lead: true }] : []),
    { value: count(d.prsMerged), label: "PRs merged", note: null, lead: false },
    { value: count(d.reviews), label: "reviews given", note: null, lead: false },
    { value: count(d.commits), label: "commits", note: null, lead: false },
  ];
  return (
    <Shell look={look} paint={paint} {...TOTALS_SIZE} site={site} login={data.identity.login}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Person look={look} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={42} />
        {span && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <Eyebrow t={t} p={paint} delay={40}>Totals</Eyebrow>
            <span style={{ fontSize: 12, marginTop: 4, color: paint.mark("rise", t.muted, 80) }}>{span}</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", marginTop: "auto", gap: 8 }}>
        {stats.map((s, i) => (
          <Tile key={s.label} look={look} p={paint} value={s.value} label={s.label} note={s.note} delay={150 + i * 110} lead={s.lead} grow={s.lead ? 1.3 : 1} big={s.lead ? 28 : 24} />
        ))}
      </div>
    </Shell>
  );
}

type Slice = { key: string; name: string; owner: string | null; value: number; colour: string; thin?: boolean };

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const p = (a: number) => [cx + r * Math.cos(((a - 90) * Math.PI) / 180), cy + r * Math.sin(((a - 90) * Math.PI) / 180)];
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  return `M${x1?.toFixed(2)} ${y1?.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2?.toFixed(2)} ${y2?.toFixed(2)}`;
}

function Donut({ look, slices, size, stroke, children }: { look: Look; slices: Slice[]; size: number; stroke: number; children: ReactNode }) {
  const t = look.t;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const gap = slices.length > 1 ? 1.4 : 0;
  let at = 0;
  const arcs = slices.map((s) => {
    const sweep = total > 0 ? (s.value / total) * 360 : 0;
    const from = at + gap / 2;
    const to = at + Math.max(sweep - gap / 2, from - at + 0.4);
    at += sweep;
    return { s, d: arc(c, c, r, from, Math.min(to, from + 359.99)) };
  });
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", top: 0, left: 0 }}>
        {slices.length === 1 ? <circle cx={c} cy={c} r={r} fill="none" stroke={slices[0]?.colour} strokeWidth={stroke} /> : arcs.map(({ s, d }) => <path key={s.key} d={d} fill="none" stroke={s.colour} strokeWidth={s.thin ? stroke * 0.36 : stroke} />)}
        <circle cx={c} cy={c} r={r - stroke / 2 - 5} fill="none" stroke={t.text} strokeOpacity={0.07} strokeWidth={1} />
        <circle cx={c} cy={c} r={r + stroke / 2 + 4} fill="none" stroke={t.text} strokeOpacity={0.05} strokeWidth={1} />
      </svg>
      {children}
    </div>
  );
}

function sliceShades(look: Look, n: number): string[] {
  const t = look.t;
  const steps = look.theme === "dark" ? [0, 0.2, 0.36, 0.5, 0.6] : [0, 0.26, 0.44, 0.58, 0.7];
  return Array.from({ length: n }, (_, i) => mix(t.accent, t.bg, steps[i] ?? 0.78));
}

/** Where a person's work is: the share of their commits in each of their top public repositories, as a donut with a ranked legend. */
export function RepositoriesCard({ data, theme, paint, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const size = repositoriesSize(data);
  const shown = data.repositories.filter((r) => !r.private);
  const by: "commits" | "prsMerged" = shown.some((r) => r.commits > 0) ? "commits" : "prsMerged";
  const word = by === "commits" ? ["commit", "commits"] : ["merged PR", "merged PRs"];
  const top = [...shown].filter((r) => r[by] > 0).sort((a, b) => b[by] - a[by] || `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`)).slice(0, 5);
  const listed = top.reduce((a, r) => a + r[by], 0);
  const spread = data.spread?.[by] ?? null;
  const all = Math.max(listed, spread?.total ?? listed);
  const others = spread ? Math.max(0, spread.repositories - top.length) : 0;
  const rest = all - listed;
  const shades = sliceShades(look, top.length);
  const slices: Slice[] = [...top.map((r: ProfileRepo, i) => ({ key: `${r.owner}/${r.name}`, name: r.name, owner: r.owner, value: r[by], colour: shades[i] ?? t.accent })), ...(rest > 0 && others > 0 ? [{ key: "rest", name: `${grouped(others)} more`, owner: null, value: rest, colour: mix(t.text, t.bg, look.theme === "dark" ? 0.7 : 0.76), thin: true }] : [])];
  const repos = spread ? Math.max(spread.repositories, top.length) : top.length;
  const donut = Math.max(132, Math.min(184, size.height - 196));
  const row = Math.min(38, Math.floor((size.height - 160) / Math.max(1, slices.length)));
  return (
    <Shell look={look} paint={paint} {...size} site={site} login={data.identity.login} eyebrow="Top repositories" meta={`by ${word[1]}, public repositories`}>
      <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: paint.mark("rise", t.text, 0) }}>{top.length === 0 ? "No public repository with my work yet" : rest > 0 ? `My top ${grouped(top.length)} of ${grouped(repos)} repositories hold ${share(listed, all)} of my ${word[1]}` : `${grouped(all)} ${all === 1 ? word[0] : word[1]} across ${many(repos, "repository", "repositories")}`}</span>
      {top.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", flexGrow: 1, marginTop: 6 }}>
          <Donut look={look} slices={slices} size={donut} stroke={Math.round(donut * 0.13)}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, color: paint.mark("rise", t.text, 160) }}>{compact(all)}</span>
              <span style={{ fontSize: 11.5, color: paint.mark("rise", t.muted, 200) }}>{all === 1 ? word[0] : word[1]}</span>
            </div>
          </Donut>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginLeft: 26 }}>
            {slices.map((s, i) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", height: row, borderBottom: i < slices.length - 1 ? `1px solid ${alpha(t.text, 0.07)}` : "none" }}>
                <span style={{ display: "flex", width: 18, fontSize: 12, fontWeight: 700, color: paint.mark("rise", s.owner ? (i === 0 ? t.accent : t.faint) : t.faint, 160 + i * 80) }}>{s.owner ? String(i + 1) : ""}</span>
                <div style={{ display: "flex", width: 10, height: 10, borderRadius: 3, marginRight: 10, background: paint.mark("rise", s.colour, 160 + i * 80) }} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, color: paint.mark("rise", s.owner ? t.text : t.muted, 180 + i * 80) }}>{clip(s.name, 24)}</span>
                  {s.owner && row >= 34 && <span style={{ fontSize: 11, lineHeight: 1.25, color: paint.mark("rise", t.faint, 200 + i * 80) }}>{clip(s.owner, 30)}</span>}
                </div>
                <span style={{ display: "flex", justifyContent: "flex-end", fontSize: 14, fontWeight: 600, color: paint.mark("rise", t.text, 200 + i * 80) }}>{count(s.value)}</span>
                <span style={{ display: "flex", justifyContent: "flex-end", width: 44, fontSize: 12, color: paint.mark("rise", t.muted, 220 + i * 80) }}>{share(s.value, all)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

function share(n: number, of: number): string {
  if (of <= 0) return "";
  const p = (n * 100) / of;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

function Ring({ look, share: s, size, stroke, children }: { look: Look; share: number; size: number; stroke: number; children: ReactNode }) {
  const t = look.t;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const sweep = Math.max(1.5, Math.min(359.99, s * 360));
  const id = "ring";
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", top: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={look.hues[0]} />
            <stop offset="1" stopColor={t.accent} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke={t.empty} strokeWidth={stroke} />
        <path d={arc(c, c, r, 0, sweep)} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round" />
        <circle cx={c} cy={c} r={r - stroke / 2 - 6} fill="none" stroke={t.text} strokeOpacity={0.07} strokeWidth={1} />
      </svg>
      {children}
    </div>
  );
}

/** "41k of the 120k lines I wrote still run": a person's Surviving Lines against what they added, saying which repositories it covers. */
export function SurvivalCard({ data, theme, paint, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const e = data.engine;
  const s = e && e.added && e.surviving <= e.added ? e.surviving / e.added : null;
  return (
    <Shell look={look} paint={paint} {...SURVIVAL_SIZE} site={site} login={data.identity.login} eyebrow="Code that survived" meta={`@${data.identity.login}`}>
      {e ? (
        <div style={{ display: "flex", alignItems: "center", flexGrow: 1 }}>
          {s !== null ? (
            <Ring look={look} share={s} size={118} stroke={12}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, color: paint.mark("rise", t.text, 120) }}>{share(e.surviving, e.added ?? 0)}</span>
                <span style={{ fontSize: 11, color: paint.mark("rise", t.muted, 160) }}>still runs</span>
              </div>
            </Ring>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: 118, height: 118, flexShrink: 0, alignItems: "center", borderRadius: inner(look, 4), ...glass(look, true) }}>
              <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1, color: paint.mark("rise", t.accent, 120) }}>{compact(e.surviving)}</span>
              <span style={{ fontSize: 11, color: paint.mark("rise", t.muted, 160) }}>lines still run</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, marginLeft: 26 }}>
            <span style={{ fontSize: 23, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.22, color: paint.mark("rise", t.text, 0) }}>{e.added ? `${compact(e.surviving)} of the ${compact(e.added)} lines I wrote still run.` : `${compact(e.surviving)} lines I wrote still run.`}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 10, color: paint.mark("rise", t.muted, 220) }}>{covered(e)}</span>
            <span style={{ fontSize: 12, lineHeight: 1.4, marginTop: 3, color: paint.mark("rise", t.faint, 280) }}>Lines at the head today; reformats and generated files left out.</span>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 }}>
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, color: paint.mark("rise", t.text, 0) }}>Lines that still run: being counted</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: paint.mark("rise", t.muted, 100), marginTop: 8 }}>None of my public repositories has been read and counted here yet.</span>
        </div>
      )}
    </Shell>
  );
}

function stepOf(n: number, bounds: number[]): number {
  if (n <= 0) return -1;
  const i = bounds.findIndex((b) => n <= b);
  return i === -1 ? 3 : i;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function runOf(days: number[]): number {
  let best = 0;
  let run = 0;
  for (const n of days) {
    run = n > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The last year's contributions, a square a day, filling in as it is shown. */
export function CalendarCard({ data, theme, paint, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const { firstDay, days } = data.calendar;
  const lastDay = firstDay + days.length - 1;
  const start = lastDay - ((lastDay + 4) % 7) - 52 * 7;
  const shown = Array.from({ length: lastDay - start + 1 }, (_, i) => days[start + i - firstDay] ?? 0);
  const sorted = shown.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 1;
  const bounds = [q(0.25), q(0.5), q(0.75), Infinity];
  const total = shown.reduce((a, b) => a + b, 0);
  const weeks = Math.ceil(shown.length / 7);
  const cell = look.radius === 0 ? 2 : 3;
  const labels: { w: number; m: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const m = new Date((start + w * 7) * 86_400_000).getUTCMonth();
    const before = w === 0 ? -1 : new Date((start + (w - 1) * 7) * 86_400_000).getUTCMonth();
    if (m !== before && w < weeks - 2) labels.push({ w, m: MONTHS[m] ?? "" });
  }
  if (labels[0]?.w === 0 && (labels[1]?.w ?? 99) < 3) labels.shift();
  return (
    <Shell look={look} paint={paint} {...calendarSize()} site={site} login={data.identity.login} padX={30}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: paint.mark("rise", t.text, 0) }}>{`${grouped(total)} contributions in the last year`}</span>
        <span style={{ fontSize: 12, color: paint.mark("rise", t.muted, 60) }}>{`${many(shown.filter((n) => n > 0).length, "active day", "active days")} · longest run ${many(runOf(shown), "day", "days")}`}</span>
      </div>
      <div style={{ display: "flex", position: "relative", height: 14, marginTop: 10 }}>
        {labels.map((l) => (
          <span key={l.w} style={{ position: "absolute", left: l.w * (CELL + GAP), top: 0, fontSize: 10.5, color: t.faint }}>
            {l.m}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 4 }}>
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} style={{ display: "flex", flexDirection: "column", marginRight: GAP }}>
            {Array.from({ length: 7 }, (_, d) => {
              const n = shown[w * 7 + d];
              if (n === undefined) return <div key={d} style={{ display: "flex", width: CELL, height: CELL, marginBottom: GAP }} />;
              const s = stepOf(n, bounds);
              const colour = s < 0 ? t.empty : (t.ramp[s] ?? t.ramp[3]);
              return <div key={d} style={{ display: "flex", width: CELL, height: CELL, marginBottom: GAP, borderRadius: cell, background: s < 0 ? colour : paint.mark("fill", colour, 200 + w * 18 + d * 6) }} />;
            })}
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** The languages of a person's commits, year by year. */
export function LanguagesCard({ data, theme, paint, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const years = data.years.filter((y) => y.languages.length > 0).slice(-8);
  const totals = new Map<string, number>();
  for (const y of years) for (const l of y.languages) totals.set(l.name, (totals.get(l.name) ?? 0) + l.commits);
  const named = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const colour = (n: string) => (named.includes(n) ? (t.series[named.indexOf(n)] ?? t.other) : t.other);
  const bar = look.radius === 0 ? 1 : 4;
  return (
    <Shell look={look} paint={paint} {...languagesSize(data)} site={site} login={data.identity.login}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: paint.mark("rise", t.text, 0) }}>Languages over the years</span>
        <span style={{ fontSize: 12, color: paint.mark("rise", t.faint, 60) }}>commits, by each repository's main language</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 10 }}>
        {[...named, ...(totals.size > named.length ? ["Other"] : [])].map((n) => (
          <div key={n} style={{ display: "flex", alignItems: "center", marginRight: 14, fontSize: 12, color: t.muted }}>
            <div style={{ display: "flex", width: 9, height: 9, borderRadius: 3, background: n === "Other" ? t.other : colour(n), marginRight: 6 }} />
            <span>{n}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
        {years.map((y, i) => {
          const other = y.languages.filter((l) => !named.includes(l.name)).reduce((a, l) => a + l.commits, 0);
          const parts = [...y.languages.filter((l) => named.includes(l.name)).map((l) => [l.name, l.commits] as const), ...(other > 0 ? [["Other", other] as const] : [])];
          const sum = y.languages.reduce((a, l) => a + l.commits, 0);
          return (
            <div key={y.year} style={{ display: "flex", alignItems: "center", height: 26 }}>
              <div style={{ display: "flex", width: 42, flexShrink: 0, fontSize: 12, fontWeight: 600, color: t.muted }}>{String(y.year)}</div>
              <div style={{ display: "flex", flexGrow: 1, height: 14, gap: 2, padding: 2, borderRadius: bar + 2, background: alpha(t.text, look.theme === "dark" ? 0.06 : 0.05) }}>
                {parts.map(([n, c]) => (
                  <div key={n} style={{ display: "flex", flexGrow: c, flexBasis: 0, height: 10, borderRadius: bar, background: paint.mark("grow", n === "Other" ? t.other : colour(n), 120 + i * 80) }} />
                ))}
              </div>
              <span style={{ display: "flex", justifyContent: "flex-end", width: 52, flexShrink: 0, fontSize: 11.5, color: paint.mark("rise", t.faint, 140 + i * 80) }}>{compact(sum)}</span>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

/** A person in one repository: their best place as a headline, and their place in each view. */
export function StandingCard({ data, theme, paint, images, site, style }: CardProps<StandingCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const headline = data.top ?? `${data.identity.name ?? data.identity.login} in ${data.repo.owner}/${data.repo.name}`;
  return (
    <Shell look={look} paint={paint} {...STANDING_SIZE} site={site} login={data.identity.login}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Person look={look} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={32} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <Eyebrow t={t} p={paint} delay={40}>{clip(`${data.repo.owner}/${data.repo.name}`, 34)}</Eyebrow>
          <span style={{ fontSize: 12, marginTop: 4, color: paint.mark("rise", t.muted, 80) }}>{`among ${many(data.people, "person", "people")}`}</span>
        </div>
      </div>
      <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.28, marginTop: 14, color: paint.mark("rise", t.text, 120) }}>{headline}</span>
      <div style={{ display: "flex", marginTop: "auto", gap: 8 }}>
        {data.places.slice(0, 4).map((p, i) => (
          <Tile key={p.view} look={look} p={paint} big={22} value={ordinal(p.place)} label={`of ${grouped(p.of)} · ${SHORT_VIEW[p.view]}`} delay={250 + i * 110} lead={p.place === 1} />
        ))}
      </div>
    </Shell>
  );
}

const LANGUAGE_COLOURS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Swift: "#f05138",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4f5d95",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#663399",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00b4ab",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Scala: "#c22d40",
  Lua: "#000080",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  "Objective-C": "#438eff",
  OCaml: "#ef7a08",
  Clojure: "#db5855",
  "Jupyter Notebook": "#da5b0b",
  MDX: "#fcb32c",
};

const STAR = "M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5z";

function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= most ? flat : `${flat.slice(0, most - 1).trimEnd()}…`;
}

function Pill({ look, children }: { look: Look; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 12px", marginLeft: 8, borderRadius: look.radius === 0 ? 0 : 30, fontSize: 14, ...glass(look) }}>{children}</div>;
}

/** A repository's Card: its owner's face, its name, what it is, its stars, forks and main language, then the people who built it with their faces and numbers. */
export function HallOfFameCard({ data, theme, paint, images, site, style }: CardProps<HallOfFameData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const people = data.people.slice(0, 10);
  const owner = images[data.repo.owner.toLowerCase()];
  const language = data.repo.language ?? null;
  const dot = language ? (LANGUAGE_COLOURS[language] ?? t.faint) : null;
  const lines = people.some((p) => p.surviving !== null);
  const most = Math.max(1, ...people.map((p) => (lines ? (p.surviving ?? 0) : (p.commits ?? 0))));
  return (
    <Shell look={look} paint={paint} {...hallOfFameSize(data)} site={site} link={`${site}/gh/${data.repo.owner}/${data.repo.name}`}>
      <div style={{ display: "flex", alignItems: "center", height: 64 }}>
        {owner ? <img src={owner} width={60} height={60} style={{ borderRadius: inner(look, 6), border: `1px solid ${t.border}` }} /> : <div style={{ display: "flex", width: 60, height: 60, borderRadius: inner(look, 6), background: t.surface, border: `1px solid ${t.border}` }} />}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 16, flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, color: paint.mark("rise", t.muted, 0) }}>{`${data.repo.owner} /`}</span>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.1, color: paint.mark("rise", t.text, 40) }}>{clip(data.repo.name, 28)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Pill look={look}>
            <svg width={15} height={15} viewBox="0 0 24 24">
              <path d={STAR} fill={t.accent} />
            </svg>
            <span style={{ marginLeft: 6, fontWeight: 700, color: t.text }}>{compact(data.repo.stars)}</span>
            <span style={{ marginLeft: 4, color: t.muted }}>{data.repo.stars === 1 ? "star" : "stars"}</span>
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
              <span style={{ marginLeft: 4, color: t.muted }}>{data.repo.forks === 1 ? "fork" : "forks"}</span>
            </Pill>
          )}
        </div>
      </div>
      <span style={{ display: "flex", height: 20, marginTop: 12, fontSize: 15, color: paint.mark("rise", data.repo.description ? t.text : t.faint, 80) }}>{data.repo.description ? clip(data.repo.description, 86) : "No description on GitHub"}</span>
      <div style={{ display: "flex", alignItems: "center", height: 20, marginTop: 12, fontSize: 14, color: t.muted }}>
        {language && dot && (
          <div style={{ display: "flex", alignItems: "center", marginRight: 18 }}>
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, background: dot, marginRight: 7 }} />
            <span style={{ color: t.text }}>{language}</span>
          </div>
        )}
        <span>{many(data.total, "contributor", "contributors")}</span>
      </div>
      <div style={{ display: "flex", height: 1, marginTop: 16, marginBottom: 14, background: t.border }} />
      <div style={{ display: "flex", alignItems: "center", height: 18, marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: t.faint }}>
        <span style={{ flexGrow: 1, color: t.accent }}>{people.length === 1 ? "BUILT BY" : `TOP ${people.length} CONTRIBUTORS`}</span>
        <span style={{ display: "flex", justifyContent: "flex-end", width: 110 }}>{lines ? "LINES RUNNING" : ""}</span>
        <span style={{ display: "flex", justifyContent: "flex-end", width: 80 }}>PRS</span>
        <span style={{ display: "flex", justifyContent: "flex-end", width: 96 }}>COMMITS</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {people.map((p, i) => {
          const face = p.login ? images[p.login.toLowerCase()] : undefined;
          const value = lines ? (p.surviving ?? 0) : (p.commits ?? 0);
          return (
            <div key={`${p.login ?? p.name}${i}`} style={{ display: "flex", alignItems: "center", height: 40, fontSize: 15 }}>
              <span style={{ width: 24, fontSize: 13, fontWeight: 700, color: i === 0 ? t.accent : t.faint }}>{String(i + 1)}</span>
              {face ? <img src={face} width={28} height={28} style={{ borderRadius: 28 }} /> : <div style={{ display: "flex", width: 28, height: 28, borderRadius: 28, background: t.surface, border: `1px solid ${t.border}` }} />}
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginLeft: 12, marginRight: 16 }}>
                <span style={{ fontWeight: 600, color: paint.mark("rise", t.text, 140 + i * 60) }}>{clip(p.name, 30)}</span>
                <div style={{ display: "flex", height: 3, marginTop: 4, width: 220, background: t.empty, borderRadius: 3 }}>
                  <div style={{ display: "flex", width: `${Math.max(value > 0 ? 3 : 0, (value * 100) / most)}%`, height: 3, borderRadius: 3, background: paint.mark("grow", t.accent, 180 + i * 60) }} />
                </div>
              </div>
              <span style={{ display: "flex", justifyContent: "flex-end", width: 110, fontWeight: 700, color: paint.mark("rise", t.accent, 160 + i * 60) }}>{p.surviving !== null ? compact(p.surviving) : lines ? "—" : ""}</span>
              <span style={{ display: "flex", justifyContent: "flex-end", width: 80, color: paint.mark("rise", t.muted, 180 + i * 60) }}>{p.prsMerged ? compact(p.prsMerged) : "—"}</span>
              <span style={{ display: "flex", justifyContent: "flex-end", width: 96, color: paint.mark("rise", t.muted, 200 + i * 60) }}>{p.commits ? compact(p.commits) : "—"}</span>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

/** A Profile's link preview, as GitHub's are. */
export function PreviewCard({ data, theme, paint, images, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const d = data.totals;
  const e = data.engine;
  const span = yearsOf(data);
  const stats = [
    ...(e ? [{ value: compact(e.surviving), label: "lines that still run", note: covered(e, true), lead: true }] : []),
    { value: count(d.prsMerged), label: "PRs merged", note: null, lead: false },
    { value: count(d.reviews), label: "reviews given", note: null, lead: false },
    { value: count(d.commits), label: "commits", note: null, lead: false },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: 630, padding: "60px 72px 52px", backgroundColor: t.bg, ...paper(look, 1200, 630), fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Avatar look={look} src={images[data.identity.login.toLowerCase()]} size={128} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 32 }}>
            <span style={{ fontSize: 62, fontWeight: 700, letterSpacing: -2, lineHeight: 1.1, color: paint.mark("rise", t.text, 0) }}>{clip(data.identity.name ?? data.identity.login, 22)}</span>
            <span style={{ fontSize: 28, color: paint.mark("rise", t.muted, 60) }}>{`@${data.identity.login}`}</span>
          </div>
        </div>
        {span && <span style={{ fontSize: 22, color: paint.mark("rise", t.faint, 80) }}>{span}</span>}
      </div>
      <div style={{ display: "flex", marginTop: "auto", gap: 16 }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", flexGrow: s.lead ? 1.25 : 1, flexBasis: 0, padding: "22px 26px 24px", borderRadius: inner(look, 2) * 1.2, ...glass(look, s.lead) }}>
            <span style={{ fontSize: s.lead ? 64 : 54, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05, color: paint.mark("rise", s.lead ? t.accent : t.text, 100 + i * 80) }}>{s.value}</span>
            <span style={{ fontSize: 23, marginTop: 8, color: paint.mark("rise", t.muted, 140 + i * 80) }}>{s.label}</span>
            {s.note && <span style={{ fontSize: 19, marginTop: 4, color: paint.mark("rise", t.faint, 170 + i * 80) }}>{s.note}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 40 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={40} height={40} style={{ borderRadius: 11 }} />
          <span style={{ marginLeft: 14, fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>commitscape</span>
        </div>
        <span style={{ fontSize: 26, color: t.faint }}>{`${site}/u/${data.identity.login}`}</span>
      </div>
    </div>
  );
}

/** What a Card shows while its person's Profile is first read from GitHub. */
export function PendingCard({ login, theme, site, width, height }: { login: string; theme: CardTheme; site: string; width: number; height: number }) {
  const look = lookOf(theme, { preset: "classic", accent: null, background: "glow", corner: null });
  const t = look.t;
  return (
    <Shell look={look} paint={STILL} width={width} height={height} site={site} login={login} eyebrow="Reading">
      <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, marginTop: 12 }}>{`Reading @${login} from GitHub…`}</span>
      <span style={{ fontSize: 14, color: t.muted, marginTop: 8 }}>This Card fills in within a minute.</span>
    </Shell>
  );
}

/** The Site's own link preview, for pages about no one in particular. */
export function SiteCard({ theme, site }: { theme: CardTheme; site: string }) {
  const look = lookOf(theme, { preset: "classic", accent: null, background: "mesh", corner: null });
  const t = look.t;
  const cells = Array.from({ length: 26 * 7 }, (_, i) => {
    const x = Math.sin(i * 12.9898 + 7 * 78.233) * 43758.5453;
    const v = x - Math.floor(x);
    const fade = Math.min(1, i / 7 / 14);
    return v * fade > 0.45 ? (t.ramp[Math.min(3, Math.floor((v * fade - 0.45) * 7))] ?? t.ramp[3]) : alpha(t.text, theme === "dark" ? 0.08 : 0.07);
  });
  return (
    <div style={{ display: "flex", width: 1200, height: 630, padding: "72px 80px", backgroundColor: t.bg, ...paper(look, 1200, 630), fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={60} height={60} style={{ borderRadius: 16 }} />
          <span style={{ marginLeft: 18, fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>commitscape</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02 }}>What you've built,</span>
          <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02, color: t.accent }}>in numbers worth sharing.</span>
        </div>
        <span style={{ fontSize: 26, color: t.muted, lineHeight: 1.35 }}>{`Pull requests, reviews and the lines of yours that still run. Cards for your README. ${site}`}</span>
      </div>
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", flexWrap: "wrap", height: 7 * 30, width: 12 * 30, padding: 0 }}>
          {cells.slice(-12 * 7).map((c, i) => (
            <div key={i} style={{ display: "flex", width: 24, height: 24, margin: 3, borderRadius: 6, background: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Two people side by side: a winner for each view, and none overall. */
export function VersusCard({ data, theme, paint, images, site, style }: CardProps<VersusCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const rows = data.rows.filter((r) => r.a !== null || r.b !== null);
  const side = (login: string, name: string | null, align: "flex-start" | "flex-end", delay: number) => (
    <div style={{ display: "flex", flexDirection: align === "flex-start" ? "row" : "row-reverse", alignItems: "center", flexGrow: 1, flexBasis: 0 }}>
      <Avatar look={look} src={images[login.toLowerCase()]} size={42} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: align, margin: "0 12px" }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: paint.mark("rise", t.text, delay) }}>{clip(name ?? login, 22)}</span>
        <span style={{ fontSize: 13, color: paint.mark("rise", t.muted, delay + 60) }}>{`@${login}`}</span>
      </div>
    </div>
  );
  return (
    <Shell look={look} paint={paint} {...versusSize(data)} site={site}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {side(data.a.identity.login, data.a.identity.name, "flex-start", 0)}
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 26, borderRadius: look.radius === 0 ? 0 : 13, fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: t.accent, ...glass(look, true) }}>VS</span>
        {side(data.b.identity.login, data.b.identity.name, "flex-end", 80)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
        {rows.map((r, i) => (
          <div key={r.view} style={{ display: "flex", alignItems: "center", height: 34, borderTop: `1px solid ${alpha(t.text, 0.08)}`, fontSize: 15 }}>
            <div style={{ display: "flex", alignItems: "center", flexGrow: 1, flexBasis: 0 }}>
              {r.winner === "a" && <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, marginRight: 8, background: paint.mark("rise", t.accent, 150 + i * 70) }} />}
              <span style={{ fontWeight: r.winner === "a" ? 700 : 400, color: paint.mark("rise", r.winner === "a" ? t.text : t.muted, 150 + i * 70) }}>{versusValue(r, r.a)}</span>
            </div>
            <span style={{ display: "flex", justifyContent: "center", width: 220, fontSize: 12.5, color: t.faint }}>{r.label}</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexGrow: 1, flexBasis: 0 }}>
              <span style={{ fontWeight: r.winner === "b" ? 700 : 400, color: paint.mark("rise", r.winner === "b" ? t.text : t.muted, 190 + i * 70) }}>{versusValue(r, r.b)}</span>
              {r.winner === "b" && <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, marginLeft: 8, background: paint.mark("rise", t.accent, 190 + i * 70) }} />}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Prism({ look, size }: { look: Look; size: number }) {
  const t = look.t;
  const dark = look.theme === "dark";
  const top = mix(t.accent, "#ffffff", dark ? 0.35 : 0.45);
  const left = t.accent;
  const right = mix(t.accent, dark ? "#000000" : t.text, dark ? 0.4 : 0.35);
  const cube = (x: number, y: number, s: number, o: number) => {
    const h = s * 0.5;
    return (
      <g key={`${x}${y}`} opacity={o}>
        <path d={`M${x} ${y - s}L${x + s} ${y - h}L${x} ${y}L${x - s} ${y - h}Z`} fill={top} />
        <path d={`M${x - s} ${y - h}L${x} ${y}L${x} ${y + s}L${x - s} ${y + h}Z`} fill={left} />
        <path d={`M${x + s} ${y - h}L${x} ${y}L${x} ${y + s}L${x + s} ${y + h}Z`} fill={right} />
      </g>
    );
  };
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <ellipse cx={c} cy={size * 0.88} rx={size * 0.34} ry={size * 0.07} fill={t.text} fillOpacity={dark ? 0.25 : 0.1} />
      {cube(c, c + size * 0.06, size * 0.26, 1)}
      {cube(c + size * 0.33, c - size * 0.24, size * 0.09, 0.85)}
      {cube(c - size * 0.34, c - size * 0.16, size * 0.065, 0.7)}
      {cube(c + size * 0.3, c + size * 0.3, size * 0.05, 0.6)}
    </svg>
  );
}

/** A person's Archetype, with the rule that gave it. */
export function ArchetypeCard({ data, theme, paint, images, site, style }: CardProps<ArchetypeCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const a = data.archetype;
  return (
    <Shell look={look} paint={paint} {...ARCHETYPE_SIZE} site={site} login={data.identity.login} eyebrow="Archetype">
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0 }}>
          <Person look={look} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={30} />
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.4, lineHeight: 1.1, marginTop: 14, color: paint.mark("rise", a ? t.text : t.muted, 160) }}>{a ? a.title : "Not decided yet"}</span>
          <span style={{ fontSize: 13.5, color: paint.mark("rise", t.muted, 240), marginTop: 6, lineHeight: 1.4 }}>{a ? a.rule : "None of the rules fits yet."}</span>
          {data.also.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 12, marginRight: 6, color: paint.mark("rise", t.faint, 300) }}>Also</span>
              {data.also.slice(0, 3).map((x, i) => (
                <span key={x} style={{ display: "flex", alignItems: "center", height: 22, padding: "0 9px", marginRight: 6, borderRadius: look.radius === 0 ? 0 : 11, fontSize: 12, color: paint.mark("rise", t.text, 320 + i * 40), ...glass(look) }}>
                  {x}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", marginLeft: 12 }}>
          <Prism look={look} size={128} />
        </div>
      </div>
    </Shell>
  );
}

/** One Achievement a person reached. */
export function AchievementCard({ data, theme, paint, images, site, style }: CardProps<AchievementCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const a = data.achievement;
  return (
    <Shell look={look} paint={paint} {...ACHIEVEMENT_SIZE} site={site} login={data.identity.login} eyebrow="Achievement" meta={a.at ? `reached ${a.at}` : undefined}>
      <div style={{ display: "flex", alignItems: "center", flexGrow: 1 }}>
        <div style={{ display: "flex", padding: 5, borderRadius: 80, backgroundImage: `linear-gradient(135deg, ${look.hues[0]}, ${t.accent})` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 66, height: 66, borderRadius: 66, background: paint.mark("rise", a.earned ? t.accent : t.empty, 0), border: `3px solid ${t.bg}` }}>
            <svg width="32" height="32" viewBox="0 0 24 24">
              <path d={STAR} fill={t.bg} />
            </svg>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 20, flexGrow: 1, flexBasis: 0 }}>
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.18, color: paint.mark("rise", t.text, 100) }}>{a.title}</span>
          {a.detail && <span style={{ fontSize: 14, fontWeight: 600, color: paint.mark("rise", t.accent, 180), marginTop: 6 }}>{a.detail}</span>}
          <span style={{ fontSize: 12.5, lineHeight: 1.4, color: paint.mark("rise", t.muted, 220), marginTop: 6 }}>{a.rule}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Avatar look={look} src={images[data.identity.login.toLowerCase()]} size={24} />
        <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 9, color: paint.mark("rise", t.text, 240) }}>{data.identity.name ?? data.identity.login}</span>
      </div>
    </Shell>
  );
}

const SHORT = { prsMerged: "PRs merged", reviews: "Reviews", commits: "Commits", contributions: "Contributions" } as const;

/** A Race or a Season: its people, a column a view, the leader of each marked; never one winner. */
export function WindowCard({ data, theme, paint, images, site, style }: CardProps<WindowCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const leaders = leadersOf(data.rows);
  const rows = [...data.rows].sort((a, b) => b.prsMerged - a.prsMerged || b.contributions - a.contributions).slice(0, 10);
  return (
    <Shell look={look} paint={paint} {...windowSize(data)} site={site}>
      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: paint.mark("rise", t.text, 0) }}>{data.title}</span>
      <span style={{ fontSize: 13, color: paint.mark("rise", t.muted, 60), marginTop: 2 }}>{data.subtitle}</span>
      <div style={{ display: "flex", marginTop: 16, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.faint }}>
        <span style={{ display: "flex", flexGrow: 1 }}>Person</span>
        {WINDOW_VIEWS.map((v) => (
          <span key={v.id} style={{ display: "flex", width: 110, justifyContent: "flex-end" }}>
            {SHORT[v.id]}
          </span>
        ))}
      </div>
      {rows.map((r, i) => {
        const face = images[r.login.toLowerCase()];
        return (
          <div key={r.login} style={{ display: "flex", alignItems: "center", height: 40, borderTop: `1px solid ${alpha(t.text, 0.08)}`, fontSize: 15 }}>
            <div style={{ display: "flex", alignItems: "center", flexGrow: 1 }}>
              {face ? <img src={face} width={24} height={24} style={{ borderRadius: 24 }} /> : <div style={{ display: "flex", width: 24, height: 24, borderRadius: 24, background: t.surface }} />}
              <span style={{ marginLeft: 10, fontWeight: 600, color: paint.mark("rise", t.text, 120 + i * 60) }}>{r.name ?? r.login}</span>
            </div>
            {WINDOW_VIEWS.map((v) => {
              const lead = leaders[v.id].includes(r.login);
              return (
                <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", width: 110 }}>
                  {lead && <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, marginRight: 6, background: paint.mark("rise", t.accent, 160 + i * 60) }} />}
                  <span style={{ fontWeight: lead ? 700 : 400, color: paint.mark("rise", lead ? t.text : t.muted, 160 + i * 60) }}>{grouped(r[v.id])}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </Shell>
  );
}

function yearCells(t: Tokens, paint: Paint, data: WrappedCardData, cell: number, gap: number, delay: number) {
  const { firstDay, days } = data.calendar;
  const offset = (firstDay + 4) % 7;
  const weeks = Math.ceil((days.length + offset) / 7);
  const sorted = days.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 1;
  const bounds = [q(0.25), q(0.5), q(0.75), Infinity];
  return (
    <div style={{ display: "flex" }}>
      {Array.from({ length: weeks }, (_, w) => (
        <div key={w} style={{ display: "flex", flexDirection: "column", marginRight: gap }}>
          {Array.from({ length: 7 }, (_, d) => {
            const i = w * 7 + d - offset;
            const n = days[i];
            if (n === undefined) return <div key={d} style={{ display: "flex", width: cell, height: cell, marginBottom: gap }} />;
            const s = stepOf(n, bounds);
            const colour = s < 0 ? t.empty : (t.ramp[s] ?? t.ramp[3]);
            return <div key={d} style={{ display: "flex", width: cell, height: cell, marginBottom: gap, borderRadius: cell / 4, background: s < 0 ? colour : paint.mark("fill", colour, delay + w * 14 + d * 4) }} />;
          })}
        </div>
      ))}
    </div>
  );
}

/** A person's year across GitHub, for posting: the year, its numbers and its calendar. */
export function WrappedCard({ data, theme, paint, images, style }: CardProps<WrappedCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const stats: [string, string][] = [
    [grouped(data.contributions), "contributions"],
    [grouped(data.prsMerged), "pull requests merged"],
    [grouped(data.reviews), "reviews given"],
    [many(data.longestStreak, "day", "days"), "longest streak"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: 630, padding: "56px 64px 44px", backgroundColor: t.bg, ...paper(look, 1200, 630), fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Avatar look={look} src={images[data.login.toLowerCase()]} size={72} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 20 }}>
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.8, color: paint.mark("rise", t.text, 0) }}>{data.name ?? data.login}</span>
            <span style={{ fontSize: 20, color: paint.mark("rise", t.muted, 60) }}>{`@${data.login}'s year on GitHub`}</span>
          </div>
        </div>
        <span style={{ fontSize: 96, fontWeight: 700, letterSpacing: -4, color: paint.mark("rise", t.accent, 120) }}>{String(data.year)}</span>
      </div>
      <div style={{ display: "flex", marginTop: 28, gap: 14 }}>
        {stats.map(([value, label], i) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, padding: "16px 20px", borderRadius: inner(look, 4), ...glass(look, i === 0) }}>
            <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: -2, lineHeight: 1.1, color: paint.mark("rise", i === 0 ? t.accent : t.text, 200 + i * 90) }}>{value}</span>
            <span style={{ fontSize: 19, marginTop: 4, color: paint.mark("rise", t.muted, 240 + i * 90) }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 30 }}>{yearCells(t, paint, data, 15, 4, 500)}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
        <span style={{ fontSize: 20, color: t.muted }}>{[data.languages[0] ? `mostly ${data.languages[0].name}` : null, data.repositories[0] && !data.repositories[0].private ? `most in ${data.repositories[0].repo}` : null, data.busiest ? `busiest on ${data.busiest.day}` : null].filter(Boolean).join(" · ")}</span>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={30} height={30} style={{ borderRadius: 8 }} />
          <span style={{ marginLeft: 10, fontSize: 22, fontWeight: 700 }}>commitscape</span>
        </div>
      </div>
    </div>
  );
}

/** A person's year, a square a day. */
export function WrappedCalendarCard({ data, theme, paint, site, style }: CardProps<WrappedCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  return (
    <Shell look={look} paint={paint} {...WRAPPED_CALENDAR_SIZE} site={site} login={data.login} padX={30}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: paint.mark("rise", t.text, 0) }}>{`${grouped(data.contributions)} contributions in ${data.year}`}</span>
        <span style={{ fontSize: 12, color: paint.mark("rise", t.muted, 60) }}>{`${many(data.activeDays, "active day", "active days")} · longest streak ${many(data.longestStreak, "day", "days")}`}</span>
      </div>
      <div style={{ display: "flex", marginTop: 20 }}>{yearCells(t, paint, data, CELL, GAP, 200)}</div>
    </Shell>
  );
}
