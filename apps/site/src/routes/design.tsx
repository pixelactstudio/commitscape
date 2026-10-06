import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GitCommitHorizontal } from "lucide-react";
import { AddedRemoved, Chip, Eyebrow, LangDot, Meter, Page, PageHead, Panel, Stat } from "@commitscape/ui";
import { COLOR, DURATION, EASE, FLAME, HEAT, ICON, RADIUS, SERIES, SPACE, STAGE_HEAT, TYPE, Z } from "@commitscape/ui/design";
import { useReducedMotion } from "@commitscape/ui/motion";

export const Route = createFileRoute("/design")({
  head: () => ({ meta: [{ title: "Design system" }, { name: "robots", content: "noindex" }] }),
  component: Design,
});

const TEXT_STYLES = [
  "type-hero",
  "type-display",
  "type-title",
  "type-heading",
  "type-panel",
  "type-lead",
  "type-body",
  "type-description",
  "type-label",
  "type-caption",
  "type-micro",
  "type-eyebrow",
  "type-stat-lg",
  "type-stat",
  "type-stat-sm",
  "type-code",
] as const;

const FLUID = [
  ["3xl", "text-3xl", "28–36"],
  ["4xl", "text-4xl", "34–44"],
  ["5xl", "text-5xl", "44–76"],
] as const;

const SHADOWS = [
  ["shadow-xs", "shadow-xs"],
  ["shadow-sm", "shadow-sm"],
  ["shadow-md", "shadow-md"],
  ["shadow-lg", "shadow-lg"],
  ["shadow-float", "shadow-float"],
] as const;

const PALETTE: { group: string; swatches: [string, string][] }[] = [
  {
    group: "Ink",
    swatches: [
      ["--ink-1", COLOR.ink],
      ["--ink-2", COLOR.ink2],
      ["--ink-3", COLOR.ink3],
      ["--ink-quiet", "var(--ink-quiet)"],
    ],
  },
  {
    group: "Surface",
    swatches: [
      ["--surface-body", "var(--surface-body)"],
      ["--surface", COLOR.surface],
      ["--surface-raised", "var(--surface-raised)"],
      ["--surface-sunken", "var(--surface-sunken)"],
      ["--surface-hover", "var(--surface-hover)"],
    ],
  },
  {
    group: "Line",
    swatches: [
      ["--line", COLOR.line],
      ["--line-strong", COLOR.lineStrong],
    ],
  },
  {
    group: "Brand",
    swatches: [
      ["--brand", COLOR.brand],
      ["--brand-strong", "var(--brand-strong)"],
      ["--brand-soft", COLOR.brandSoft],
      ["--brand-line", "var(--brand-line)"],
      ["--on-brand", "var(--on-brand)"],
    ],
  },
  {
    group: "Data",
    swatches: [
      ...SERIES.map((value, i): [string, string] => [`--s${i + 1}`, value]),
      ["--side-a", COLOR.sideA],
      ["--side-b", COLOR.sideB],
      ["--added", COLOR.added],
      ["--removed", COLOR.removed],
      ["--other", COLOR.other],
    ],
  },
  {
    group: "Astryx",
    swatches: [
      ["--color-text-primary", "var(--color-text-primary)"],
      ["--color-background-body", "var(--color-background-body)"],
      ["--color-background-surface", "var(--color-background-surface)"],
      ["--color-border", "var(--color-border)"],
    ],
  },
];

const SCHEMES = ["light", "dark"] as const;

/** The Site's design system, drawn from its own tokens: type, space, radius, colour, motion and the kit. */
function Design() {
  return (
    <Page className="pb-band">
      <PageHead eyebrow="Internal" title="Design system" description="Every token and primitive the Site draws with, rendered from the tokens themselves." />
      <div className="flex flex-col gap-section">
        <Group title="Type">
          <Panel title="Scale" description="Each TYPE step at its size, with size and leading in px. 3xl and up grow with the viewport.">
            <div className="flex flex-col gap-3">
              {Object.entries(TYPE).map(([name, step]) => (
                <div key={name} className="flex items-baseline gap-4 border-b border-line pb-3 last:border-b-0">
                  <span className="w-28 flex-none type-code text-secondary">
                    {name} · {step.size}/{step.leading}
                  </span>
                  <span className="min-w-0 truncate" style={{ fontSize: step.size, lineHeight: `${step.leading}px` }}>
                    Every commit, counted
                  </span>
                </div>
              ))}
              {FLUID.map(([name, cls, range]) => (
                <div key={name} className="flex items-baseline gap-4 border-b border-line pb-3 last:border-b-0">
                  <span className="w-28 flex-none type-code text-secondary">
                    {name} · {range}
                  </span>
                  <span className={`min-w-0 truncate ${cls}`}>Every commit</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Text styles" description="Size, weight, tracking and colour in one class.">
            <div className="flex flex-col gap-4">
              {TEXT_STYLES.map((style) => (
                <div key={style} className="flex flex-col gap-1 border-b border-line pb-4 last:border-b-0 md:flex-row md:items-baseline md:gap-4">
                  <span className="w-36 flex-none type-code text-secondary">{style}</span>
                  <span className={`min-w-0 ${style}`}>{style.startsWith("type-stat") ? "12,480" : "Who wrote the code that is still here"}</span>
                </div>
              ))}
            </div>
          </Panel>
        </Group>

        <Group title="Space, radius and elevation">
          <div className="grid gap-gutter md:grid-cols-2">
            <Panel title="Space" description="The named rhythm between components.">
              <div className="flex flex-col gap-3">
                {Object.entries(SPACE).map(([name, px]) => (
                  <div key={name} className="flex items-center gap-4">
                    <span className="w-24 flex-none type-code text-secondary">
                      {name} · {px}
                    </span>
                    <span className="block h-3 rounded-cell bg-brand" style={{ width: px }} />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Radius" description="From calendar cells to hero objects.">
              <div className="grid grid-cols-3 gap-gutter sm:grid-cols-4">
                {Object.entries(RADIUS).map(([name, px]) => (
                  <Tile key={name} label={`${name} · ${px}`}>
                    <span className="block size-14 border border-line-strong bg-sunken" style={{ borderRadius: px }} />
                  </Tile>
                ))}
                <Tile label="full">
                  <span className="block size-14 rounded-full border border-line-strong bg-sunken" />
                </Tile>
              </div>
            </Panel>
          </div>
          <Panel title="Shadows" description="Hairline lift to hero objects.">
            <div className="grid grid-cols-2 gap-gutter rounded-lg bg-sunken p-panel sm:grid-cols-5">
              {SHADOWS.map(([name, cls]) => (
                <Tile key={name} label={name}>
                  <span className={`block h-16 w-full rounded-lg bg-surface ${cls}`} />
                </Tile>
              ))}
            </div>
          </Panel>
        </Group>

        <Group title="Colour">
          <Panel title="Palette" description="Each swatch drawn twice, in a light and a dark colour scheme, with the value the browser resolved there. Astryx's own --color-* variables follow the nested colour scheme too.">
            <div className="grid gap-gutter md:grid-cols-2">
              {SCHEMES.map((scheme) => (
                <div key={scheme} className="flex flex-col gap-stack rounded-lg border border-line p-panel" style={{ colorScheme: scheme, background: "var(--surface-body)", color: COLOR.ink }}>
                  <Eyebrow>{scheme}</Eyebrow>
                  {PALETTE.map(({ group, swatches }) => (
                    <div key={group} className="flex flex-col gap-2">
                      <span className="type-label">{group}</span>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {swatches.map(([name, value]) => (
                          <Swatch key={name} name={name} value={value} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid gap-gutter md:grid-cols-2">
            <Panel title="Heat" description="HEAT on the page, STAGE_HEAT on the Wrapped stage.">
              <div className="flex flex-col gap-stack">
                <Cells colours={HEAT} />
                <div className="rounded-xl p-panel" style={{ background: "var(--gradient-wrapped)" }}>
                  <Cells colours={STAGE_HEAT} stage />
                </div>
              </div>
            </Panel>
            <Panel title="Flame" description="Streaks, cold to hot. The same in light and dark.">
              <Cells colours={FLAME} first={1} />
            </Panel>
          </div>
        </Group>

        <Group title="Motion and layers">
          <Panel title="Durations" description="Hover or tap a track: the dot crosses it in that duration with EASE.out.">
            <div className="flex flex-col gap-3">
              {Object.entries(DURATION).map(([name, seconds]) => (
                <Track key={name} name={name} seconds={seconds} />
              ))}
            </div>
          </Panel>
          <div className="grid gap-gutter md:grid-cols-2">
            <Panel title="Z layers">
              <Table head={["Layer", "z-index"]} rows={Object.entries(Z).map(([name, z]) => [name, String(z)])} />
            </Panel>
            <Panel title="Icon sizes">
              <Table
                head={["Size", "px", ""]}
                rows={Object.entries(ICON).map(([name, px]) => [name, String(px), <GitCommitHorizontal key={name} size={px} aria-hidden />])}
              />
            </Panel>
          </div>
        </Group>

        <Group title="Kit">
          <div className="grid gap-gutter md:grid-cols-2">
            <Panel title="Panel" description="A titled surface with a description and its own actions." actions={<Chip tone="quiet">actions</Chip>}>
              <p className="m-0 type-body">The body of a panel sits a stack below its head, a panel's padding from its edge.</p>
            </Panel>
            <Panel title="Stat">
              <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
                <Stat size="lg" value="2,184" label="Commits" />
                <Stat value="64%" label="Surviving" note="of lines written" />
                <Stat size="sm" value="312" label="Days active" />
                <Stat size="md" tone="brand" value="41" label="Streak" />
              </div>
            </Panel>
            <Panel title="Chip and Eyebrow">
              <div className="flex flex-col gap-stack">
                <div className="flex flex-wrap gap-cluster">
                  <Chip>neutral</Chip>
                  <Chip tone="brand" icon={<GitCommitHorizontal size={ICON.xs} aria-hidden />}>
                    brand
                  </Chip>
                  <Chip tone="quiet">quiet</Chip>
                </div>
                <Eyebrow>Eyebrow above a heading</Eyebrow>
              </div>
            </Panel>
            <Panel title="Meter, AddedRemoved and LangDot">
              <div className="flex flex-col gap-3">
                <Labelled label="brand">
                  <Meter value={0.72} label="brand" />
                </Labelled>
                <Labelled label="neutral">
                  <Meter value={0.48} label="neutral" tone="neutral" />
                </Labelled>
                <Labelled label="added">
                  <Meter value={0.3} label="added" tone="added" />
                </Labelled>
                <Labelled label="added/removed">
                  <AddedRemoved added={1840} removed={620} />
                </Labelled>
                <div className="flex flex-wrap items-center gap-4 type-caption">
                  <span className="inline-flex items-center gap-1.5">
                    <LangDot colour={SERIES[3]} /> TypeScript
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <LangDot colour={SERIES[1]} /> Rust
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <LangDot colour={null} /> Other
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </Group>
      </div>
    </Page>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-gutter">
      <h2 className="m-0 type-heading">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="type-code text-secondary">{label}</span>
    </div>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    if (ref.current) setResolved(getComputedStyle(ref.current).backgroundColor);
  }, []);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span ref={ref} className="block size-8 flex-none rounded-md border border-line" style={{ background: value }} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate type-code">{name}</span>
        <span className="truncate type-micro">{resolved || " "}</span>
      </span>
    </div>
  );
}

function Cells({ colours, stage = false, first = 0 }: { colours: readonly string[]; stage?: boolean; first?: number }) {
  return (
    <div className="flex gap-2">
      {colours.map((colour, i) => (
        <div key={colour} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="block h-8 w-full rounded-cell" style={{ background: colour }} />
          <span className={`type-micro ${stage ? "text-on-stage-2" : ""}`}>{i + first}</span>
        </div>
      ))}
    </div>
  );
}

function Track({ name, seconds }: { name: string; seconds: number }) {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(false);
  const style: CSSProperties = {
    left: on ? `calc(100% - ${ICON.xs}px)` : 0,
    width: ICON.xs,
    height: ICON.xs,
    transition: reduce ? "none" : `left ${seconds * 1000}ms cubic-bezier(${EASE.out.join(", ")})`,
  };
  return (
    <button type="button" onClick={() => setOn((v) => !v)} onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)} className="flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent p-0 text-start">
      <span className="w-28 flex-none type-code text-secondary">
        {name} · {Math.round(seconds * 1000)}ms
      </span>
      <span className="relative block h-3 flex-1 rounded-full bg-sunken">
        <span className="absolute top-0 block rounded-full bg-brand" style={style} />
      </span>
    </button>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full border-collapse type-body">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="border-b border-line pb-2 text-start type-eyebrow">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className="border-b border-line py-2 tnum last:text-end">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 flex-none type-code text-secondary">{label}</span>
      <span className="block flex-1">{children}</span>
    </div>
  );
}
