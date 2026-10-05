import type { ReactNode } from "react";
import { ordinal, type CardImages, type HallOfFameData, type ProfileCardData, type StandingCardData, type VersusCardData, type ArchetypeCardData, type AchievementCardData, type WindowCardData, type WrappedCardData, leadersOf, WINDOW_VIEWS } from "@commitscape/data";
import { compact, grouped, many } from "../format";
import type { Paint } from "./paint";
import { versusValue } from "./values";
import { calendarSize, CELL, GAP, hallOfFameSize, languagesSize, repositoriesSize, STANDING_SIZE, SURVIVAL_SIZE, TOTALS_SIZE, versusSize, ARCHETYPE_SIZE, ACHIEVEMENT_SIZE, windowSize, WRAPPED_CALENDAR_SIZE } from "./sizes";
import { lookOf, type CardStyle, type Look } from "./style";
import type { CardTheme, Tokens } from "./tokens";

export type CardProps<T> = { data: T; theme: CardTheme; paint: Paint; images: CardImages; site: string; style?: CardStyle };

const LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIiBmaWxsPSJub25lIj48cGF0aCBkPSJNMCAyMEMwIDEyLjUyMzEgMCA4Ljc4NDYxIDEuNjA3NjkgNkMyLjY2MDkxIDQuMTc1NzcgNC4xNzU3NyAyLjY2MDkxIDYgMS42MDc2OUM4Ljc4NDYxIDAgMTIuNTIzMSAwIDIwIDBDMjcuNDc2OSAwIDMxLjIxNTQgMCAzNCAxLjYwNzY5QzM1LjgyNDIgMi42NjA5MSAzNy4zMzkxIDQuMTc1NzcgMzguMzkyMyA2QzQwIDguNzg0NjEgNDAgMTIuNTIzMSA0MCAyMEM0MCAyNy40NzY5IDQwIDMxLjIxNTQgMzguMzkyMyAzNEMzNy4zMzkxIDM1LjgyNDIgMzUuODI0MiAzNy4zMzkxIDM0IDM4LjM5MjNDMzEuMjE1NCA0MCAyNy40NzY5IDQwIDIwIDQwQzEyLjUyMzEgNDAgOC43ODQ2MSA0MCA2IDM4LjM5MjNDNC4xNzU3NyAzNy4zMzkxIDIuNjYwOTEgMzUuODI0MiAxLjYwNzY5IDM0QzAgMzEuMjE1NCAwIDI3LjQ3NjkgMCAyMFoiIGZpbGw9IiMwMERDMzMiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTI4LjA0NDEgNy42MDkyN0MyOC44ODY4IDYuODAzMzEgMzAuMjE1MiA2Ljc5OTY1IDMxLjA2MjIgNy41ODIyOUwzMS4xNDI1IDcuNjYwMDVMMzEuNDE2NCA3Ljk0NzI5QzM0LjE5MTEgMTAuOTMxOCAzNS4yMjUxIDE0LjQwOTggMzQuOTU5OSAxNy44MDY1QzM0LjY5MDggMjEuMjUxMSAzMy4xMDEyIDI0LjQ5OTQgMzAuODgzNiAyNy4wNjY0QzI4LjY2NzMgMjkuNjMxNiAyNS43MDg0IDMxLjY1MTkgMjIuNTEgMzIuNTI4N0MxOS4yNzE0IDMzLjQxNjQgMTUuNzI5NCAzMy4xMzM0IDEyLjY1NDcgMzAuOTYyOUMxMC4wNDY5IDI5LjEyMTggOS4wNTQwNiAyNi4xNDY1IDguOTg2NjEgMjMuMjU2MUM3LjUyMzIzIDIyLjUzODQgNS45ODM0NiAyMS42NDYzIDQuMzY3ODkgMjAuNTYxNUwzLjk0MSAyMC4yNzE2TDMuODUwMDYgMjAuMjA2QzIuOTMyODUgMTkuNTA1MyAyLjcyMzEzIDE4LjIwODQgMy4zOTE2MSAxNy4yNTY0QzQuMDYwMjkgMTYuMzA0MyA1LjM2MjMzIDE2LjA0NiA2LjM0NjY1IDE2LjY1MTJMNi40NDEzNCAxNi43MTI2TDYuODMwMjQgMTYuOTc3MUM3Ljc5ODA1IDE3LjYyNjkgOC43MjE1MyAxOC4xOTAzIDkuNTk5NjYgMTguNjc2N0MxMC4xNjYxIDE2LjY4ODkgMTEuMTA0NyAxNC43ODAyIDEyLjM0MTMgMTMuMjA3QzE0LjE5MzggMTAuODUwMSAxNi45NzEzIDguOTY1MjUgMjAuMzc0IDkuMjQ2NDdDMjMuNDM5IDkuNDk5OTUgMjUuNzAzNiAxMS4wODEgMjYuODcyNSAxMy4zMTIyQzI4LjAwNDQgMTUuNDcyOCAyOC4wMjExIDE4LjA3MTkgMjcuMDMxOSAyMC4zMDdDMjYuMDIzNCAyMi41ODU3IDIzLjk3NiAyNC40ODQgMjEuMDMwOSAyNS4yNjYyQzE4LjkxMTQgMjUuODI5MSAxNi40Mjg0IDI1Ljc5MDUgMTMuNjI2NyAyNS4wMzY3VjI1LjAzNzdDMTIuNTExNSAyNC43Mzc1IDExLjM0MjcgMjQuMzIzIDEwLjEyMTIgMjMuNzg0NkM5Ljg0NzIgMjMuNjYzOCA5LjYwODczIDIzLjg0ODMgMTAuMTIxMiAyNC4xNjg2QzExLjU2MzYgMjUuMTkyNCAxMy41OTU2IDI2LjA1MDUgMTQuMTgzNiAyNi4zMzg1QzE0LjQ2MTUgMjYuNzg4IDE0LjgwNjEgMjcuMTU2OCAxNS4yMDExIDI3LjQzNTZDMTcuMDE4OCAyOC43MTg4IDE5LjE0NTEgMjguOTUzOSAyMS4zMzk2IDI4LjM1MjNDMjMuNTc0MyAyNy43Mzk3IDI1LjgxNDEgMjYuMjYyNSAyNy41NTE0IDI0LjI1MTZDMjkuMjg3MyAyMi4yNDIzIDMwLjQwNjUgMTkuODM0OCAzMC41OTA5IDE3LjQ3MjdDMzAuNzY1IDE1LjI0MzkgMzAuMTIxOCAxMi45NTQzIDI4LjE4NDIgMTAuODczNkwyNy45OTI3IDEwLjY3MzFMMjcuOTE2MiAxMC41OTA2QzI3LjE1MzggOS43Mjc0OCAyNy4yMDE4IDguNDE1MTYgMjguMDQ0MSA3LjYwOTI3Wk0yMC4wMDkyIDEzLjU2NTFDMTguNjAzMyAxMy40NDg5IDE3LjExOTYgMTQuMTg5IDE1LjgwMTMgMTUuODY2MkMxNC43OTczIDE3LjE0MzYgMTQuMDM3NiAxOC44MDMzIDEzLjY1MDMgMjAuNTExMkMxNi40MDkzIDIxLjQ1NDQgMTguNDY1NSAyMS40NjA4IDE5Ljg5NDIgMjEuMDgxNEMyMS41NDgxIDIwLjY0MjIgMjIuNTM5OSAxOS42NDc3IDIzLjAxNzIgMTguNTY5M0MyMy41MTM3IDE3LjQ0NzIgMjMuNDYyOCAxNi4yMjQ1IDIyLjk4MTMgMTUuMzA1NUMyMi41MzY5IDE0LjQ1NzEgMjEuNjQyMiAxMy43MDAyIDIwLjAwOTIgMTMuNTY1MVoiIGZpbGw9IndoaXRlIi8+PC9zdmc+";

const font = "Inter";

const SHORT_VIEW: Record<string, string> = { surviving: "lines running", prsMerged: "PRs merged", reviews: "reviews", linesAdded: "lines added", commits: "commits" };

const paper = (look: Look) => (look.backgroundImage ? { backgroundImage: look.backgroundImage, backgroundSize: look.backgroundSize ?? "100% 100%" } : {});

function Shell({ look, width, height, children, site, login, link }: { look: Look; width: number; height: number; children: ReactNode; site: string; login?: string; link?: string }) {
  const t = look.t;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, height, padding: "26px 30px 20px", backgroundColor: t.bg, ...paper(look), border: `1px solid ${t.border}`, borderRadius: look.radius, fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>{children}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={18} height={18} style={{ borderRadius: 5 }} />
          <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 600, color: t.muted }}>commitscape</span>
        </div>
        {(link ?? login) && <span style={{ fontSize: 13, color: t.faint }}>{link ?? `${site}/u/${login}`}</span>}
      </div>
    </div>
  );
}

function Person({ t, p, login, name, images, size = 44 }: { t: Tokens; p: Paint; login: string; name: string | null; images: CardImages; size?: number }) {
  const face = images[login.toLowerCase()];
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {face ? <img src={face} width={size} height={size} style={{ borderRadius: size }} /> : <div style={{ display: "flex", width: size, height: size, borderRadius: size, background: t.surface }} />}
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: p.mark("rise", t.text, 0) }}>{name ?? login}</span>
        <span style={{ fontSize: 14, color: p.mark("rise", t.muted, 60) }}>{`@${login}`}</span>
      </div>
    </div>
  );
}

function Stat({ t, p, value, label, delay, big = 34, lead = false }: { t: Tokens; p: Paint; value: string; label: string; delay: number; big?: number; lead?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, paddingRight: 14 }}>
      <span style={{ fontSize: big, fontWeight: 700, letterSpacing: -1, color: p.mark("rise", lead ? t.accent : t.text, delay) }}>{value}</span>
      <span style={{ fontSize: 13, lineHeight: 1.3, color: p.mark("rise", t.muted, delay + 60), marginTop: 3 }}>{label}</span>
    </div>
  );
}


/** A person's headline numbers. */
export function TotalsCard({ data, theme, paint, images, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const d = data.totals;
  const stats: [string, string][] = [
    ...(data.engine ? ([[compact(data.engine.surviving), "lines still running"]] as [string, string][]) : []),
    [grouped(d.prsMerged), "pull requests merged"],
    [grouped(d.reviews), "reviews given"],
    [grouped(d.commits), "commits"],
  ];
  return (
    <Shell look={look} {...TOTALS_SIZE} site={site} login={data.identity.login}>
      <Person t={t} p={paint} login={data.identity.login} name={data.identity.name} images={images} />
      <div style={{ display: "flex", marginTop: 24 }}>
        {stats.slice(0, 4).map(([value, label], i) => (
          <Stat key={label} t={t} p={paint} value={value} label={label} delay={150 + i * 120} lead={i === 0} />
        ))}
      </div>
    </Shell>
  );
}


/** Where a person's work is, with a bar each for their merged pull requests and commits. */
export function RepositoriesCard({ data, theme, paint, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const repos = data.repositories.slice(0, 5);
  const most = Math.max(1, ...repos.map((r) => r.prsMerged * 3 + r.commits));
  return (
    <Shell look={look} {...repositoriesSize(data)} site={site} login={data.identity.login}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>Where my work is</span>
      <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 60), marginTop: 2 }}>{`${many(data.repositories.length, "repository", "repositories")} on GitHub`}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
        {repos.map((r, i) => (
          <div key={`${r.owner}/${r.name}`} style={{ display: "flex", flexDirection: "column", height: 50, justifyContent: "center" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, marginRight: 8, background: r.colour && /^#[0-9a-f]{6}$/i.test(r.colour) ? r.colour : t.faint }} />
                <span style={{ fontWeight: 600, color: paint.mark("rise", t.text, 150 + i * 90) }}>{`${r.owner}/${r.name}`}</span>
              </div>
              <span style={{ color: paint.mark("rise", t.muted, 200 + i * 90) }}>
                {[r.prsMerged > 0 && many(r.prsMerged, "merged PR", "merged PRs"), r.commits > 0 && many(r.commits, "commit", "commits")].filter(Boolean).join(" · ") || "reviews"}
              </span>
            </div>
            <div style={{ display: "flex", height: 6, marginTop: 6, background: t.empty, borderRadius: 3 }}>
              <div style={{ display: "flex", width: `${Math.max(1.5, ((r.prsMerged * 3 + r.commits) * 100) / most)}%`, height: 6, borderRadius: 3, background: paint.mark("grow", t.accent, 200 + i * 90) }} />
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}


/** "41k of the 120k lines I wrote still run": a person's Surviving Lines against what they added. */
export function SurvivalCard({ data, theme, paint, site, style }: CardProps<ProfileCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const e = data.engine;
  const share = e && e.added && e.surviving <= e.added ? e.surviving / e.added : null;
  return (
    <Shell look={look} {...SURVIVAL_SIZE} site={site} login={data.identity.login}>
      {e ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.2, color: paint.mark("rise", t.text, 0) }}>
            {e.added ? `${compact(e.surviving)} of the ${compact(e.added)} lines I wrote still run.` : `${compact(e.surviving)} lines I wrote still run.`}
          </span>
          {share !== null && (
            <div style={{ display: "flex", height: 14, marginTop: 22, background: t.empty, borderRadius: 7 }}>
              <div style={{ display: "flex", width: `${Math.max(1, share * 100)}%`, height: 14, borderRadius: 7, background: paint.mark("grow", t.brand, 250) }} />
            </div>
          )}
          <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 400), marginTop: 14 }}>
            {`${share !== null ? `${Math.round(share * 100)}% still at the head, ` : ""}in ${many(e.repositories, "repository", "repositories")} commitscape has read, reformats left out`}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>Lines that still run: being counted</span>
          <span style={{ fontSize: 15, color: paint.mark("rise", t.muted, 100), marginTop: 10 }}>From the history of the repositories commitscape has read.</span>
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
  return (
    <Shell look={look} {...calendarSize()} site={site} login={data.identity.login}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>{`${grouped(total)} contributions in the last year`}</span>
      <div style={{ display: "flex", marginTop: 16 }}>
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} style={{ display: "flex", flexDirection: "column", marginRight: GAP }}>
            {Array.from({ length: 7 }, (_, d) => {
              const n = shown[w * 7 + d];
              if (n === undefined) return <div key={d} style={{ display: "flex", width: CELL, height: CELL, marginBottom: GAP }} />;
              const s = stepOf(n, bounds);
              const colour = s < 0 ? t.empty : t.ramp[s] ?? t.ramp[3];
              return <div key={d} style={{ display: "flex", width: CELL, height: CELL, marginBottom: GAP, borderRadius: 3, background: s < 0 ? colour : paint.mark("fill", colour, 200 + w * 18 + d * 6) }} />;
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
  return (
    <Shell look={look} {...languagesSize(data)} site={site} login={data.identity.login}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>Languages over the years</span>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 8 }}>
        {[...named, ...(totals.size > named.length ? ["Other"] : [])].map((n) => (
          <div key={n} style={{ display: "flex", alignItems: "center", marginRight: 14, fontSize: 13, color: t.muted }}>
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 3, background: n === "Other" ? t.other : colour(n), marginRight: 5 }} />
            <span>{n}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        {years.map((y, i) => {
          const other = y.languages.filter((l) => !named.includes(l.name)).reduce((a, l) => a + l.commits, 0);
          const parts = [...y.languages.filter((l) => named.includes(l.name)).map((l) => [l.name, l.commits] as const), ...(other > 0 ? [["Other", other] as const] : [])];
          return (
            <div key={y.year} style={{ display: "flex", alignItems: "center", height: 26 }}>
              <div style={{ display: "flex", width: 46, flexShrink: 0, fontSize: 13, color: t.muted }}>{String(y.year)}</div>
              <div style={{ display: "flex", flexGrow: 1, height: 12, gap: 2 }}>
                {parts.map(([n, c]) => (
                  <div key={n} style={{ display: "flex", flexGrow: c, flexBasis: 0, height: 12, borderRadius: 3, background: paint.mark("grow", n === "Other" ? t.other : colour(n), 120 + i * 80) }} />
                ))}
              </div>
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
    <Shell look={look} {...STANDING_SIZE} site={site} login={data.identity.login}>
      <Person t={t} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={36} />
      <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, marginTop: 16, color: paint.mark("rise", t.text, 120) }}>{headline}</span>
      <div style={{ display: "flex", marginTop: 16 }}>
        {data.places.slice(0, 4).map((p, i) => (
          <Stat key={p.view} t={t} p={paint} big={26} value={ordinal(p.place)} label={`of ${grouped(p.of)} · ${SHORT_VIEW[p.view]}`} delay={250 + i * 110} lead={p.place === 1} />
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

function Pill({ t, children }: { t: Tokens; children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 12px", marginLeft: 8, borderRadius: 30, border: `1px solid ${t.border}`, backgroundColor: t.surface, fontSize: 14 }}>{children}</div>;
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
    <Shell look={look} {...hallOfFameSize(data)} site={site} link={`${site}/gh/${data.repo.owner}/${data.repo.name}`}>
      <div style={{ display: "flex", alignItems: "center", height: 64 }}>
        {owner ? <img src={owner} width={60} height={60} style={{ borderRadius: 16, border: `1px solid ${t.border}` }} /> : <div style={{ display: "flex", width: 60, height: 60, borderRadius: 16, background: t.surface, border: `1px solid ${t.border}` }} />}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 16, flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, color: paint.mark("rise", t.muted, 0) }}>{`${data.repo.owner} /`}</span>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.1, color: paint.mark("rise", t.text, 40) }}>{clip(data.repo.name, 28)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Pill t={t}>
            <svg width={15} height={15} viewBox="0 0 24 24">
              <path d={STAR} fill={t.accent} />
            </svg>
            <span style={{ marginLeft: 6, fontWeight: 700, color: t.text }}>{compact(data.repo.stars)}</span>
            <span style={{ marginLeft: 4, color: t.muted }}>{data.repo.stars === 1 ? "star" : "stars"}</span>
          </Pill>
          {data.repo.forks !== null && data.repo.forks !== undefined && (
            <Pill t={t}>
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
      <div style={{ display: "flex", alignItems: "center", height: 18, marginBottom: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.6, color: t.faint }}>
        <span style={{ flexGrow: 1 }}>{people.length === 1 ? "BUILT BY" : `TOP ${people.length} CONTRIBUTORS`}</span>
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
  const face = images[data.identity.login.toLowerCase()];
  const d = data.totals;
  const stats: [string, string][] = [
    ...(data.engine ? ([[compact(data.engine.surviving), "lines still running"]] as [string, string][]) : []),
    [grouped(d.prsMerged), "pull requests merged"],
    [grouped(d.reviews), "reviews given"],
    [grouped(d.commits), "commits"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: 630, padding: "64px 72px", backgroundColor: t.bg, ...paper(look), fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {face ? <img src={face} width={136} height={136} style={{ borderRadius: 136 }} /> : <div style={{ display: "flex", width: 136, height: 136, borderRadius: 136, background: t.surface }} />}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 32 }}>
          <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2, color: paint.mark("rise", t.text, 0) }}>{data.identity.name ?? data.identity.login}</span>
          <span style={{ fontSize: 30, color: paint.mark("rise", t.muted, 60) }}>{`@${data.identity.login}`}</span>
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 72, flexGrow: 1 }}>
        {stats.slice(0, 4).map(([value, label], i) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, paddingRight: 28 }}>
            <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, color: paint.mark("rise", i === 0 ? t.accent : t.text, 100 + i * 80) }}>{value}</span>
            <span style={{ fontSize: 24, lineHeight: 1.25, color: paint.mark("rise", t.muted, 140 + i * 80) }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={40} height={40} style={{ borderRadius: 11 }} />
          <span style={{ marginLeft: 14, fontSize: 30, fontWeight: 700 }}>commitscape</span>
        </div>
        <span style={{ fontSize: 26, color: t.faint }}>{`${site}/u/${data.identity.login}`}</span>
      </div>
    </div>
  );
}

/** What a Card shows while its person's Profile is first read from GitHub. */
export function PendingCard({ login, theme, site, width, height }: { login: string; theme: CardTheme; site: string; width: number; height: number }) {
  const look = lookOf(theme);
  const t = look.t;
  return (
    <Shell look={look} width={width} height={height} site={site} login={login}>
      <span style={{ fontSize: 24, fontWeight: 700, marginTop: 20 }}>{`Reading @${login} from GitHub…`}</span>
      <span style={{ fontSize: 15, color: t.muted, marginTop: 10 }}>This Card fills in within a minute.</span>
    </Shell>
  );
}

/** The Site's own link preview, for pages about no one in particular. */
export function SiteCard({ theme, site }: { theme: CardTheme; site: string }) {
  const look = lookOf(theme, { preset: "classic", accent: null, background: "aurora", corner: null });
  const t = look.t;
  const cells = Array.from({ length: 26 * 7 }, (_, i) => {
    const x = Math.sin(i * 12.9898 + 7 * 78.233) * 43758.5453;
    const v = x - Math.floor(x);
    const fade = Math.min(1, (i / 7) / 14);
    return v * fade > 0.45 ? t.ramp[Math.min(3, Math.floor((v * fade - 0.45) * 7))] ?? t.ramp[3] : t.empty;
  });
  return (
    <div style={{ display: "flex", width: 1200, height: 630, padding: "72px 80px", backgroundColor: t.bg, ...paper(look), fontFamily: font, color: t.text, boxSizing: "border-box" }}>
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
        <div style={{ display: "flex", flexDirection: "column", flexWrap: "wrap", height: 7 * 30, width: 12 * 30 }}>
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
  const side = (login: string, name: string | null, align: "flex-start" | "flex-end", delay: number) => {
    const face = images[login.toLowerCase()];
    return (
      <div style={{ display: "flex", flexDirection: align === "flex-start" ? "row" : "row-reverse", alignItems: "center", flexGrow: 1, flexBasis: 0 }}>
        {face ? <img src={face} width={44} height={44} style={{ borderRadius: 44 }} /> : <div style={{ display: "flex", width: 44, height: 44, borderRadius: 44, background: t.surface }} />}
        <div style={{ display: "flex", flexDirection: "column", alignItems: align, margin: "0 12px" }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: paint.mark("rise", t.text, delay) }}>{name ?? login}</span>
          <span style={{ fontSize: 13, color: paint.mark("rise", t.muted, delay + 60) }}>{`@${login}`}</span>
        </div>
      </div>
    );
  };
  return (
    <Shell look={look} {...versusSize(data)} site={site}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {side(data.a.identity.login, data.a.identity.name, "flex-start", 0)}
        <span style={{ fontSize: 15, fontWeight: 700, color: t.faint, margin: "0 8px" }}>versus</span>
        {side(data.b.identity.login, data.b.identity.name, "flex-end", 80)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
        {rows.map((r, i) => (
          <div key={r.view} style={{ display: "flex", alignItems: "center", height: 34, borderTop: `1px solid ${t.border}`, fontSize: 15 }}>
            <div style={{ display: "flex", alignItems: "center", flexGrow: 1, flexBasis: 0 }}>
              {r.winner === "a" && <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, marginRight: 8, background: paint.mark("rise", t.brand, 150 + i * 70) }} />}
              <span style={{ fontWeight: r.winner === "a" ? 700 : 400, color: paint.mark("rise", r.winner === "a" ? t.text : t.muted, 150 + i * 70) }}>{versusValue(r, r.a)}</span>
            </div>
            <span style={{ display: "flex", justifyContent: "center", width: 220, fontSize: 13, color: t.faint }}>{r.label}</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexGrow: 1, flexBasis: 0 }}>
              <span style={{ fontWeight: r.winner === "b" ? 700 : 400, color: paint.mark("rise", r.winner === "b" ? t.text : t.muted, 190 + i * 70) }}>{versusValue(r, r.b)}</span>
              {r.winner === "b" && <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, marginLeft: 8, background: paint.mark("rise", t.brand, 190 + i * 70) }} />}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** A person's Archetype, with the rule that gave it. */
export function ArchetypeCard({ data, theme, paint, images, site, style }: CardProps<ArchetypeCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const a = data.archetype;
  return (
    <Shell look={look} {...ARCHETYPE_SIZE} site={site} login={data.identity.login}>
      <Person t={t} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={36} />
      <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 100), marginTop: 18, textTransform: "uppercase", letterSpacing: 2 }}>Archetype</span>
      <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, color: paint.mark("rise", a ? t.text : t.muted, 160) }}>{a ? a.title : "Not decided yet"}</span>
      <span style={{ fontSize: 15, color: paint.mark("rise", t.muted, 240), marginTop: 6, lineHeight: 1.35 }}>{a ? a.rule : "None of the rules fits yet."}</span>
      {data.also.length > 0 && <span style={{ fontSize: 13, color: paint.mark("rise", t.faint, 320), marginTop: 6 }}>{`Also: ${data.also.join(", ")}`}</span>}
    </Shell>
  );
}

/** One Achievement a person reached. */
export function AchievementCard({ data, theme, paint, images, site, style }: CardProps<AchievementCardData>) {
  const look = lookOf(theme, style);
  const t = look.t;
  const a = data.achievement;
  return (
    <Shell look={look} {...ACHIEVEMENT_SIZE} site={site} login={data.identity.login}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 68, height: 68, borderRadius: 68, background: paint.mark("rise", a.earned ? t.accent : t.empty, 0), boxShadow: `0 0 0 6px ${t.surface}` }}>
          <svg width="34" height="34" viewBox="0 0 24 24">
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill={t.bg} />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 18, flexGrow: 1, flexBasis: 0 }}>
          <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, color: paint.mark("rise", t.text, 100) }}>{a.title}</span>
          <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 180), marginTop: 6 }}>{[a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule}</span>
          {(a.detail || a.at) && <span style={{ fontSize: 13, lineHeight: 1.35, color: paint.mark("rise", t.faint, 220), marginTop: 6 }}>{a.rule}</span>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 22 }}>
        {images[data.identity.login.toLowerCase()] ? <img src={images[data.identity.login.toLowerCase()]} width={28} height={28} style={{ borderRadius: 28 }} /> : <div style={{ display: "flex", width: 28, height: 28, borderRadius: 28, background: t.surface }} />}
        <span style={{ fontSize: 16, fontWeight: 600, marginLeft: 10, color: paint.mark("rise", t.text, 240) }}>{data.identity.name ?? data.identity.login}</span>
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
    <Shell look={look} {...windowSize(data)} site={site}>
      <span style={{ fontSize: 22, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>{data.title}</span>
      <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 60), marginTop: 2 }}>{data.subtitle}</span>
      <div style={{ display: "flex", marginTop: 16, fontSize: 12, color: t.faint }}>
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
          <div key={r.login} style={{ display: "flex", alignItems: "center", height: 40, borderTop: `1px solid ${t.border}`, fontSize: 15 }}>
            <div style={{ display: "flex", alignItems: "center", flexGrow: 1 }}>
              {face ? <img src={face} width={24} height={24} style={{ borderRadius: 24 }} /> : <div style={{ display: "flex", width: 24, height: 24, borderRadius: 24, background: t.surface }} />}
              <span style={{ marginLeft: 10, fontWeight: 600, color: paint.mark("rise", t.text, 120 + i * 60) }}>{r.name ?? r.login}</span>
            </div>
            {WINDOW_VIEWS.map((v) => {
              const lead = leaders[v.id].includes(r.login);
              return (
                <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", width: 110 }}>
                  {lead && <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, marginRight: 6, background: paint.mark("rise", t.brand, 160 + i * 60) }} />}
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
  const face = images[data.login.toLowerCase()];
  const stats: [string, string][] = [
    [grouped(data.contributions), "contributions"],
    [grouped(data.prsMerged), "pull requests merged"],
    [grouped(data.reviews), "reviews given"],
    [many(data.longestStreak, "day", "days"), "longest streak"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: 630, padding: "56px 64px 44px", backgroundColor: t.bg, ...paper(look), fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {face ? <img src={face} width={72} height={72} style={{ borderRadius: 72 }} /> : <div style={{ display: "flex", width: 72, height: 72, borderRadius: 72, background: t.surface }} />}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 20 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>{data.name ?? data.login}</span>
            <span style={{ fontSize: 20, color: paint.mark("rise", t.muted, 60) }}>{`@${data.login}'s year on GitHub`}</span>
          </div>
        </div>
        <span style={{ fontSize: 96, fontWeight: 700, letterSpacing: -4, color: paint.mark("rise", t.brand, 120) }}>{String(data.year)}</span>
      </div>
      <div style={{ display: "flex", marginTop: 30 }}>
        {stats.map(([value, label], i) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0 }}>
            <span style={{ fontSize: 56, fontWeight: 700, letterSpacing: -2, color: paint.mark("rise", t.text, 200 + i * 90) }}>{value}</span>
            <span style={{ fontSize: 20, color: paint.mark("rise", t.muted, 240 + i * 90) }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 34 }}>{yearCells(t, paint, data, 15, 4, 500)}</div>
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
    <Shell look={look} {...WRAPPED_CALENDAR_SIZE} site={site} login={data.login}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>{`${grouped(data.contributions)} contributions in ${data.year}`}</span>
      <div style={{ display: "flex", marginTop: 16 }}>{yearCells(t, paint, data, CELL, GAP, 200)}</div>
    </Shell>
  );
}
