import type { ReactNode } from "react";
import { ordinal, VIEWS, type CardImages, type HallOfFameData, type ProfileCardData, type StandingCardData, type VersusCardData, type ArchetypeCardData, type AchievementCardData, type WindowCardData, type WrappedCardData, leadersOf, WINDOW_VIEWS } from "@commitscape/data";
import { compact, grouped, many } from "../format";
import type { Paint } from "./paint";
import { versusValue } from "./values";
import { calendarSize, CELL, GAP, hallOfFameSize, languagesSize, repositoriesSize, STANDING_SIZE, SURVIVAL_SIZE, TOTALS_SIZE, versusSize, ARCHETYPE_SIZE, ACHIEVEMENT_SIZE, windowSize, WRAPPED_CALENDAR_SIZE } from "./sizes";
import { TOKENS, type CardTheme, type Tokens } from "./tokens";

export type CardProps<T> = { data: T; theme: CardTheme; paint: Paint; images: CardImages; site: string };

const LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIiBmaWxsPSJub25lIj48cGF0aCBkPSJNMCAyMEMwIDEyLjUyMzEgMCA4Ljc4NDYxIDEuNjA3NjkgNkMyLjY2MDkxIDQuMTc1NzcgNC4xNzU3NyAyLjY2MDkxIDYgMS42MDc2OUM4Ljc4NDYxIDAgMTIuNTIzMSAwIDIwIDBDMjcuNDc2OSAwIDMxLjIxNTQgMCAzNCAxLjYwNzY5QzM1LjgyNDIgMi42NjA5MSAzNy4zMzkxIDQuMTc1NzcgMzguMzkyMyA2QzQwIDguNzg0NjEgNDAgMTIuNTIzMSA0MCAyMEM0MCAyNy40NzY5IDQwIDMxLjIxNTQgMzguMzkyMyAzNEMzNy4zMzkxIDM1LjgyNDIgMzUuODI0MiAzNy4zMzkxIDM0IDM4LjM5MjNDMzEuMjE1NCA0MCAyNy40NzY5IDQwIDIwIDQwQzEyLjUyMzEgNDAgOC43ODQ2MSA0MCA2IDM4LjM5MjNDNC4xNzU3NyAzNy4zMzkxIDIuNjYwOTEgMzUuODI0MiAxLjYwNzY5IDM0QzAgMzEuMjE1NCAwIDI3LjQ3NjkgMCAyMFoiIGZpbGw9IiMwMERDMzMiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTI4LjA0NDEgNy42MDkyN0MyOC44ODY4IDYuODAzMzEgMzAuMjE1MiA2Ljc5OTY1IDMxLjA2MjIgNy41ODIyOUwzMS4xNDI1IDcuNjYwMDVMMzEuNDE2NCA3Ljk0NzI5QzM0LjE5MTEgMTAuOTMxOCAzNS4yMjUxIDE0LjQwOTggMzQuOTU5OSAxNy44MDY1QzM0LjY5MDggMjEuMjUxMSAzMy4xMDEyIDI0LjQ5OTQgMzAuODgzNiAyNy4wNjY0QzI4LjY2NzMgMjkuNjMxNiAyNS43MDg0IDMxLjY1MTkgMjIuNTEgMzIuNTI4N0MxOS4yNzE0IDMzLjQxNjQgMTUuNzI5NCAzMy4xMzM0IDEyLjY1NDcgMzAuOTYyOUMxMC4wNDY5IDI5LjEyMTggOS4wNTQwNiAyNi4xNDY1IDguOTg2NjEgMjMuMjU2MUM3LjUyMzIzIDIyLjUzODQgNS45ODM0NiAyMS42NDYzIDQuMzY3ODkgMjAuNTYxNUwzLjk0MSAyMC4yNzE2TDMuODUwMDYgMjAuMjA2QzIuOTMyODUgMTkuNTA1MyAyLjcyMzEzIDE4LjIwODQgMy4zOTE2MSAxNy4yNTY0QzQuMDYwMjkgMTYuMzA0MyA1LjM2MjMzIDE2LjA0NiA2LjM0NjY1IDE2LjY1MTJMNi40NDEzNCAxNi43MTI2TDYuODMwMjQgMTYuOTc3MUM3Ljc5ODA1IDE3LjYyNjkgOC43MjE1MyAxOC4xOTAzIDkuNTk5NjYgMTguNjc2N0MxMC4xNjYxIDE2LjY4ODkgMTEuMTA0NyAxNC43ODAyIDEyLjM0MTMgMTMuMjA3QzE0LjE5MzggMTAuODUwMSAxNi45NzEzIDguOTY1MjUgMjAuMzc0IDkuMjQ2NDdDMjMuNDM5IDkuNDk5OTUgMjUuNzAzNiAxMS4wODEgMjYuODcyNSAxMy4zMTIyQzI4LjAwNDQgMTUuNDcyOCAyOC4wMjExIDE4LjA3MTkgMjcuMDMxOSAyMC4zMDdDMjYuMDIzNCAyMi41ODU3IDIzLjk3NiAyNC40ODQgMjEuMDMwOSAyNS4yNjYyQzE4LjkxMTQgMjUuODI5MSAxNi40Mjg0IDI1Ljc5MDUgMTMuNjI2NyAyNS4wMzY3VjI1LjAzNzdDMTIuNTExNSAyNC43Mzc1IDExLjM0MjcgMjQuMzIzIDEwLjEyMTIgMjMuNzg0NkM5Ljg0NzIgMjMuNjYzOCA5LjYwODczIDIzLjg0ODMgMTAuMTIxMiAyNC4xNjg2QzExLjU2MzYgMjUuMTkyNCAxMy41OTU2IDI2LjA1MDUgMTQuMTgzNiAyNi4zMzg1QzE0LjQ2MTUgMjYuNzg4IDE0LjgwNjEgMjcuMTU2OCAxNS4yMDExIDI3LjQzNTZDMTcuMDE4OCAyOC43MTg4IDE5LjE0NTEgMjguOTUzOSAyMS4zMzk2IDI4LjM1MjNDMjMuNTc0MyAyNy43Mzk3IDI1LjgxNDEgMjYuMjYyNSAyNy41NTE0IDI0LjI1MTZDMjkuMjg3MyAyMi4yNDIzIDMwLjQwNjUgMTkuODM0OCAzMC41OTA5IDE3LjQ3MjdDMzAuNzY1IDE1LjI0MzkgMzAuMTIxOCAxMi45NTQzIDI4LjE4NDIgMTAuODczNkwyNy45OTI3IDEwLjY3MzFMMjcuOTE2MiAxMC41OTA2QzI3LjE1MzggOS43Mjc0OCAyNy4yMDE4IDguNDE1MTYgMjguMDQ0MSA3LjYwOTI3Wk0yMC4wMDkyIDEzLjU2NTFDMTguNjAzMyAxMy40NDg5IDE3LjExOTYgMTQuMTg5IDE1LjgwMTMgMTUuODY2MkMxNC43OTczIDE3LjE0MzYgMTQuMDM3NiAxOC44MDMzIDEzLjY1MDMgMjAuNTExMkMxNi40MDkzIDIxLjQ1NDQgMTguNDY1NSAyMS40NjA4IDE5Ljg5NDIgMjEuMDgxNEMyMS41NDgxIDIwLjY0MjIgMjIuNTM5OSAxOS42NDc3IDIzLjAxNzIgMTguNTY5M0MyMy41MTM3IDE3LjQ0NzIgMjMuNDYyOCAxNi4yMjQ1IDIyLjk4MTMgMTUuMzA1NUMyMi41MzY5IDE0LjQ1NzEgMjEuNjQyMiAxMy43MDAyIDIwLjAwOTIgMTMuNTY1MVoiIGZpbGw9IndoaXRlIi8+PC9zdmc+";

const font = "Inter";

function Shell({ t, width, height, children, site, login }: { t: Tokens; width: number; height: number; children: ReactNode; site: string; login?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width, height, padding: "26px 30px 20px", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 18, fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>{children}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={LOGO} width={18} height={18} style={{ borderRadius: 5 }} />
          <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 600, color: t.muted }}>commitscape</span>
        </div>
        {login && <span style={{ fontSize: 13, color: t.faint }}>{`${site}/u/${login}`}</span>}
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

function Stat({ t, p, value, label, delay, big = 34 }: { t: Tokens; p: Paint; value: string; label: string; delay: number; big?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0 }}>
      <span style={{ fontSize: big, fontWeight: 700, letterSpacing: -1, color: p.mark("rise", t.text, delay) }}>{value}</span>
      <span style={{ fontSize: 14, color: p.mark("rise", t.muted, delay + 60), marginTop: 2 }}>{label}</span>
    </div>
  );
}


/** A person's headline numbers. */
export function TotalsCard({ data, theme, paint, images, site }: CardProps<ProfileCardData>) {
  const t = TOKENS[theme];
  const d = data.totals;
  const stats: [string, string][] = [
    ...(data.engine ? ([[compact(data.engine.surviving), "lines still running"]] as [string, string][]) : []),
    [grouped(d.prsMerged), "pull requests merged"],
    [grouped(d.reviews), "reviews given"],
    [grouped(d.commits), "commits"],
  ];
  return (
    <Shell t={t} {...TOTALS_SIZE} site={site} login={data.identity.login}>
      <Person t={t} p={paint} login={data.identity.login} name={data.identity.name} images={images} />
      <div style={{ display: "flex", marginTop: 24 }}>
        {stats.slice(0, 4).map(([value, label], i) => (
          <Stat key={label} t={t} p={paint} value={value} label={label} delay={150 + i * 120} />
        ))}
      </div>
    </Shell>
  );
}


/** Where a person's work is, with a bar each for their merged pull requests and commits. */
export function RepositoriesCard({ data, theme, paint, site }: CardProps<ProfileCardData>) {
  const t = TOKENS[theme];
  const repos = data.repositories.slice(0, 5);
  const most = Math.max(1, ...repos.map((r) => r.prsMerged * 3 + r.commits));
  return (
    <Shell t={t} {...repositoriesSize(data)} site={site} login={data.identity.login}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>Where my work is</span>
      <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 60), marginTop: 2 }}>{`${many(data.repositories.length, "repository", "repositories")} on GitHub`}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
        {repos.map((r, i) => (
          <div key={`${r.owner}/${r.name}`} style={{ display: "flex", flexDirection: "column", height: 50, justifyContent: "center" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
              <span style={{ fontWeight: 600, color: paint.mark("rise", t.text, 150 + i * 90) }}>{`${r.owner}/${r.name}`}</span>
              <span style={{ color: paint.mark("rise", t.muted, 200 + i * 90) }}>
                {[r.prsMerged > 0 && many(r.prsMerged, "merged PR", "merged PRs"), r.commits > 0 && many(r.commits, "commit", "commits")].filter(Boolean).join(" · ") || "reviews"}
              </span>
            </div>
            <div style={{ display: "flex", height: 6, marginTop: 6, background: t.empty, borderRadius: 3 }}>
              <div style={{ display: "flex", width: `${Math.max(1.5, ((r.prsMerged * 3 + r.commits) * 100) / most)}%`, height: 6, borderRadius: 3, background: paint.mark("grow", r.colour && /^#[0-9a-f]{6}$/i.test(r.colour) ? r.colour : t.accent, 200 + i * 90) }} />
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}


/** "41k of the 120k lines I wrote still run": a person's Surviving Lines against what they added. */
export function SurvivalCard({ data, theme, paint, site }: CardProps<ProfileCardData>) {
  const t = TOKENS[theme];
  const e = data.engine;
  const share = e && e.added && e.surviving <= e.added ? e.surviving / e.added : null;
  return (
    <Shell t={t} {...SURVIVAL_SIZE} site={site} login={data.identity.login}>
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
export function CalendarCard({ data, theme, paint, site }: CardProps<ProfileCardData>) {
  const t = TOKENS[theme];
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
    <Shell t={t} {...calendarSize()} site={site} login={data.identity.login}>
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
export function LanguagesCard({ data, theme, paint, site }: CardProps<ProfileCardData>) {
  const t = TOKENS[theme];
  const years = data.years.filter((y) => y.languages.length > 0).slice(-8);
  const totals = new Map<string, number>();
  for (const y of years) for (const l of y.languages) totals.set(l.name, (totals.get(l.name) ?? 0) + l.commits);
  const named = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const colour = (n: string) => (named.includes(n) ? (t.series[named.indexOf(n)] ?? t.other) : t.other);
  return (
    <Shell t={t} {...languagesSize(data)} site={site} login={data.identity.login}>
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
export function StandingCard({ data, theme, paint, images, site }: CardProps<StandingCardData>) {
  const t = TOKENS[theme];
  const headline = data.top ?? `${data.identity.name ?? data.identity.login} in ${data.repo.owner}/${data.repo.name}`;
  return (
    <Shell t={t} {...STANDING_SIZE} site={site} login={data.identity.login}>
      <Person t={t} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={36} />
      <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, marginTop: 16, color: paint.mark("rise", t.text, 120) }}>{headline}</span>
      <div style={{ display: "flex", marginTop: 16 }}>
        {data.places.slice(0, 4).map((p, i) => (
          <Stat key={p.view} t={t} p={paint} big={26} value={ordinal(p.place)} label={`of ${grouped(p.of)} by ${VIEWS.find((v) => v.id === p.view)?.label.toLowerCase()}`} delay={250 + i * 110} />
        ))}
      </div>
    </Shell>
  );
}


/** A repository's contributors, with their faces and numbers, for its maintainers to thank them. */
export function HallOfFameCard({ data, theme, paint, images, site }: CardProps<HallOfFameData>) {
  const t = TOKENS[theme];
  const people = data.people.slice(0, 10);
  return (
    <Shell t={t} {...hallOfFameSize(data)} site={site}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>{`The people who built ${data.repo.owner}/${data.repo.name}`}</span>
      <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 60), marginTop: 2 }}>{`${many(data.total, "contributor", "contributors")}; the ${people.length} with the most lines still running`}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        {people.map((p, i) => {
          const face = p.login ? images[p.login.toLowerCase()] : undefined;
          return (
            <div key={`${p.login ?? p.name}${i}`} style={{ display: "flex", alignItems: "center", height: 40, fontSize: 15 }}>
              {face ? <img src={face} width={26} height={26} style={{ borderRadius: 26 }} /> : <div style={{ display: "flex", width: 26, height: 26, borderRadius: 26, background: t.surface }} />}
              <span style={{ marginLeft: 10, flexGrow: 1, fontWeight: 600, color: paint.mark("rise", t.text, 120 + i * 60) }}>{p.name}</span>
              <span style={{ width: 150, textAlign: "right", color: paint.mark("rise", t.muted, 160 + i * 60) }}>{p.surviving !== null ? `${compact(p.surviving)} lines run` : ""}</span>
              <span style={{ width: 130, textAlign: "right", color: paint.mark("rise", t.muted, 180 + i * 60) }}>{p.prsMerged ? many(p.prsMerged, "merged PR", "merged PRs") : ""}</span>
              <span style={{ width: 110, textAlign: "right", color: paint.mark("rise", t.muted, 200 + i * 60) }}>{p.commits ? many(p.commits, "commit", "commits") : ""}</span>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}


/** A Profile's link preview, as GitHub's are. */
export function PreviewCard({ data, theme, paint, images, site }: CardProps<ProfileCardData>) {
  const t = TOKENS[theme];
  const face = images[data.identity.login.toLowerCase()];
  const d = data.totals;
  const stats: [string, string][] = [
    ...(data.engine ? ([[compact(data.engine.surviving), "lines still running"]] as [string, string][]) : []),
    [grouped(d.prsMerged), "pull requests merged"],
    [grouped(d.reviews), "reviews given"],
    [grouped(d.commits), "commits"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: 630, padding: "64px 72px", background: t.bg, fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {face ? <img src={face} width={136} height={136} style={{ borderRadius: 136 }} /> : <div style={{ display: "flex", width: 136, height: 136, borderRadius: 136, background: t.surface }} />}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 32 }}>
          <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2, color: paint.mark("rise", t.text, 0) }}>{data.identity.name ?? data.identity.login}</span>
          <span style={{ fontSize: 30, color: paint.mark("rise", t.muted, 60) }}>{`@${data.identity.login}`}</span>
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 72, flexGrow: 1 }}>
        {stats.slice(0, 4).map(([value, label], i) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0 }}>
            <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, color: paint.mark("rise", t.text, 100 + i * 80) }}>{value}</span>
            <span style={{ fontSize: 26, color: paint.mark("rise", t.muted, 140 + i * 80) }}>{label}</span>
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
  const t = TOKENS[theme];
  return (
    <Shell t={t} width={width} height={height} site={site} login={login}>
      <span style={{ fontSize: 24, fontWeight: 700, marginTop: 20 }}>{`Reading @${login} from GitHub…`}</span>
      <span style={{ fontSize: 15, color: t.muted, marginTop: 10 }}>This Card fills in within a minute.</span>
    </Shell>
  );
}

/** The Site's own link preview, for pages about no one in particular. */
export function SiteCard({ theme, site }: { theme: CardTheme; site: string }) {
  const t = TOKENS[theme];
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 1200, height: 630, padding: "80px 88px", background: t.bg, fontFamily: font, color: t.text, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <img src={LOGO} width={72} height={72} style={{ borderRadius: 20 }} />
        <span style={{ marginLeft: 22, fontSize: 48, fontWeight: 700 }}>commitscape</span>
      </div>
      <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05 }}>What you've built, in numbers worth sharing.</span>
      <span style={{ fontSize: 30, color: t.muted }}>{`Pull requests, reviews, and the lines of yours that still run · ${site}`}</span>
    </div>
  );
}


/** Two people side by side: a winner for each view, and none overall. */
export function VersusCard({ data, theme, paint, images, site }: CardProps<VersusCardData>) {
  const t = TOKENS[theme];
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
    <Shell t={t} {...versusSize(data)} site={site}>
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
export function ArchetypeCard({ data, theme, paint, images, site }: CardProps<ArchetypeCardData>) {
  const t = TOKENS[theme];
  const a = data.archetype;
  return (
    <Shell t={t} {...ARCHETYPE_SIZE} site={site} login={data.identity.login}>
      <Person t={t} p={paint} login={data.identity.login} name={data.identity.name} images={images} size={36} />
      <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 100), marginTop: 18, textTransform: "uppercase", letterSpacing: 2 }}>Archetype</span>
      <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, color: paint.mark("rise", a ? t.text : t.muted, 160) }}>{a ? a.title : "Not decided yet"}</span>
      <span style={{ fontSize: 15, color: paint.mark("rise", t.muted, 240), marginTop: 6, lineHeight: 1.35 }}>{a ? a.rule : "None of the rules fits yet."}</span>
      {data.also.length > 0 && <span style={{ fontSize: 13, color: paint.mark("rise", t.faint, 320), marginTop: 6 }}>{`Also: ${data.also.join(", ")}`}</span>}
    </Shell>
  );
}

/** One Achievement a person reached. */
export function AchievementCard({ data, theme, paint, images, site }: CardProps<AchievementCardData>) {
  const t = TOKENS[theme];
  const a = data.achievement;
  return (
    <Shell t={t} {...ACHIEVEMENT_SIZE} site={site} login={data.identity.login}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 64, background: paint.mark("rise", a.earned ? t.brand : t.empty, 0) }}>
          <div style={{ display: "flex", width: 26, height: 26, borderRadius: 26, background: t.bg }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 18, flexGrow: 1, flexBasis: 0 }}>
          <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, color: paint.mark("rise", t.text, 100) }}>{a.title}</span>
          <span style={{ fontSize: 14, color: paint.mark("rise", t.muted, 180), marginTop: 6 }}>{[a.detail, a.at ? `reached ${a.at}` : null].filter(Boolean).join(" · ") || a.rule}</span>
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
export function WindowCard({ data, theme, paint, images, site }: CardProps<WindowCardData>) {
  const t = TOKENS[theme];
  const leaders = leadersOf(data.rows);
  const rows = [...data.rows].sort((a, b) => b.prsMerged - a.prsMerged || b.contributions - a.contributions).slice(0, 10);
  return (
    <Shell t={t} {...windowSize(data)} site={site}>
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
export function WrappedCard({ data, theme, paint, images }: CardProps<WrappedCardData>) {
  const t = TOKENS[theme];
  const face = images[data.login.toLowerCase()];
  const stats: [string, string][] = [
    [grouped(data.contributions), "contributions"],
    [grouped(data.prsMerged), "pull requests merged"],
    [grouped(data.reviews), "reviews given"],
    [many(data.longestStreak, "day", "days"), "longest streak"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: 630, padding: "56px 64px 44px", background: t.bg, fontFamily: font, color: t.text, boxSizing: "border-box" }}>
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
export function WrappedCalendarCard({ data, theme, paint, site }: CardProps<WrappedCardData>) {
  const t = TOKENS[theme];
  return (
    <Shell t={t} {...WRAPPED_CALENDAR_SIZE} site={site} login={data.login}>
      <span style={{ fontSize: 20, fontWeight: 700, color: paint.mark("rise", t.text, 0) }}>{`${grouped(data.contributions)} contributions in ${data.year}`}</span>
      <div style={{ display: "flex", marginTop: 16 }}>{yearCells(t, paint, data, CELL, GAP, 200)}</div>
    </Shell>
  );
}
