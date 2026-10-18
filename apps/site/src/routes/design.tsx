import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GitCommitHorizontal } from "lucide-react";
import { AddedRemoved, Eyebrow, InlineLink, LangDot, Meter, Page, PageHead, Panel, Pill, PlainButton, Quiet, RowButton, ScreenHeader, Stat, Surface } from "@commitscape/ui";
import { COLOR, DURATION, EASE, FLAME, FRAME, HEAT, ICON, MOTION, RADIUS, SERIES, SPACE, STAGE_HEAT, TYPE, Z } from "@commitscape/ui/design";
import { useReducedMotion } from "@commitscape/ui/motion";

export const Route = createFileRoute("/design")({
  head: () => ({ meta: [{ title: "Design system" }, { name: "robots", content: "noindex" }] }),
  component: Design,
});

const TEXT_STYLES = [
  "type-hero",
  "type-display",
  "type-page",
  "type-title",
  "type-heading",
  "type-panel",
  "type-lead",
  "type-body",
  "type-ui",
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
  ["3xl", "text-3xl", "28–32"],
  ["4xl", "text-4xl", "36–44"],
  ["5xl", "text-5xl", "44–72"],
] as const;

const FEATURES = [
  ["normal", "normal", "Il1 0O aa gaearon/react 2,184"],
  ["cv11, ss01 (the root)", '"cv11", "ss01"', "Il1 0O aa gaearon/react 2,184"],
  ["type-id: cv05, cv08 too", '"cv11", "ss01", "cv05", "cv08"', "Il1 0O aa gaearon/react 2,184"],
] as const;

const CHROME: [string, string, string][] = [
  ["--page", `${FRAME.page}rem`, "the page frame's column: top bar, page and footer"],
  ["--page-narrow", `${FRAME.pageNarrow}rem`, "reading pages, centred"],
  ["--content", `${FRAME.content}rem`, "a workspace screen's column"],
  ["--gutter", "16 / 24", "the one side inset, 24 from 640px; 16 in a workspace"],
  ["--main-pad", "16 / 24 / 32", "a workspace screen's inset"],
  ["--header-height", `${FRAME.header}rem`, "the top bar"],
  ["--sidebar-width", `${FRAME.sidebar}rem`, "the workspace sidebar"],
  ["--repo-bar-height", `${FRAME.repoBar}rem`, "the slim bar below 1024px"],
  ["--screen-header-height", `${FRAME.screenHeader}rem`, "a screen's one-line header"],
  ["--chrome-top", "header (+ bar)", "every sticky offset and scroll margin"],
  ["--main-height", "100dvh − chrome", "the sidebar and anything that fills the window"],
];

const SHADOWS = [
  ["shadow-xs", "shadow-xs"],
  ["shadow-sm", "shadow-sm"],
  ["shadow-md", "shadow-md"],
  ["shadow-lg", "shadow-lg"],
  ["shadow-float", "shadow-float"],
] as const;

const PALETTE: { group: string; swatches: [string, string][] }[] = [
  {
    group: "Text",
    swatches: [
      ["text-primary", COLOR.ink],
      ["text-secondary", COLOR.ink2],
      ["text-tertiary", COLOR.ink3],
      ["text-disabled", "var(--color-text-disabled)"],
    ],
  },
  {
    group: "Background",
    swatches: [
      ["bg-body", "var(--color-bg-page)"],
      ["bg-surface", COLOR.surface],
      ["bg-raised", "var(--color-bg-raised)"],
      ["bg-sunken", "var(--color-bg-sunken)"],
      ["bg-hover", "var(--color-bg-hover)"],
      ["bg-active", "var(--color-bg-active)"],
      ["bg-inverse", "var(--color-bg-inverse)"],
    ],
  },
  {
    group: "Border",
    swatches: [
      ["border-separator", "var(--color-border-separator)"],
      ["border-line", COLOR.line],
      ["border-line-strong", COLOR.lineStrong],
      ["border-strong (inputs)", "var(--color-border-strong)"],
      ["outline-focus", "var(--color-border-focus)"],
    ],
  },
  {
    group: "Accent",
    swatches: [
      ["bg-brand", COLOR.brand],
      ["bg-brand-strong", "var(--brand-strong)"],
      ["text-brand", "var(--brand-text)"],
      ["bg-brand-soft", COLOR.brandSoft],
      ["border-brand-line", "var(--brand-line)"],
      ["text-on-brand", "var(--on-brand)"],
    ],
  },
  {
    group: "Changes",
    swatches: [
      ["text-added", COLOR.added],
      ["bg-added-solid", "var(--added-solid)"],
      ["bg-added-soft", "var(--added-soft)"],
      ["text-removed", COLOR.removed],
      ["bg-removed-solid", "var(--removed-solid)"],
      ["bg-removed-soft", "var(--removed-soft)"],
    ],
  },
  {
    group: "Data",
    swatches: [
      ...SERIES.map((value, i): [string, string] => [`--s${i + 1}`, value]),
      ["--side-a", COLOR.sideA],
      ["--side-b", COLOR.sideB],
      ["--other", COLOR.other],
    ],
  },
  {
    group: "Astryx, pointed at the same tokens",
    swatches: [
      ["--color-accent", "var(--color-accent)"],
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
        <Group title="Frames">
          <Panel title="Two frames, one set of edges" description="A page sits in the page frame: the top bar, the page and the footer share one centred column. A repository or a Shared Report sits in the workspace frame: the top bar runs the full width, a sidebar holds the repository, the Window and the screens, and each screen reads in a centred column beside it. Every sticky offset reads the chrome tokens.">
            <div className="grid gap-gutter md:grid-cols-2">
              <FrameSketch kind="page" />
              <FrameSketch kind="workspace" />
            </div>
            <Table head={["Token", "Value", "For"]} end={false} rows={CHROME.map(([name, value, words]) => [<code key={name}>{name}</code>, value, words])} />
          </Panel>
          <ScreenHeader title="ScreenHeader" counts="Its title, what it counts, and its actions, on one line" actions={<Pill tone="quiet">actions</Pill>} />
        </Group>

        <Group title="Type">
          <Panel title="Fonts" description="Inter 4.1 for the interface, self-hosted with its optical size axis and every feature; JetBrains Mono for code, hashes, paths, branch and tag names and keys, without ligatures.">
            <div className="flex flex-col gap-3">
              {FEATURES.map(([name, features, sample]) => (
                <div key={name} className="flex flex-col gap-1 border-b border-separator pb-3 md:flex-row md:items-baseline md:gap-4">
                  <span className="w-48 flex-none type-code text-secondary">{name}</span>
                  <span className="type-title" style={{ fontFeatureSettings: features }}>
                    {sample}
                  </span>
                </div>
              ))}
              <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
                <span className="w-48 flex-none type-code text-secondary">mono · type-code</span>
                <code className="type-code">3fce3b5 src/main.rs != =&gt; ag/index-design-wip</code>
              </div>
            </div>
          </Panel>
          <Panel title="Scale" description="Each TYPE step at its size, with its unitless line height. 3xl and up grow with the viewport; nothing is smaller than 12px.">
            <div className="flex flex-col gap-3">
              {Object.entries(TYPE).map(([name, step]) => (
                <div key={name} className="flex items-baseline gap-4 border-b border-line pb-3 last:border-b-0">
                  <span className="w-40 flex-none type-code text-secondary">
                    {name} · {step.size}/{step.leading}
                  </span>
                  <span className="min-w-0 truncate" style={{ fontSize: step.size, lineHeight: step.leading }}>
                    Every commit, counted
                  </span>
                </div>
              ))}
              {FLUID.map(([name, cls, range]) => (
                <div key={name} className="flex items-baseline gap-4 border-b border-line pb-3 last:border-b-0">
                  <span className="w-40 flex-none type-code text-secondary">
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
                <div key={scheme} className="flex flex-col gap-stack rounded-lg border border-line p-panel" style={{ colorScheme: scheme, background: "var(--color-bg-page)", color: COLOR.ink }}>
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
          <Panel title="Durations" description={`Hover or tap a track: the dot crosses it in that duration with EASE.out. Hovers and rows take instant, presses fast (Astryx's own fast is ${MOTION.fast}ms, the same), enters base, exits exit; transitions name their properties, and a theme switch runs none.`}>
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
            <Panel title="Panel" description="A titled surface with a description and its own actions." actions={<Pill tone="quiet">actions</Pill>}>
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
            <Panel title="Pill and Eyebrow" description="One size of Pill, in five tones.">
              <div className="flex flex-col gap-stack">
                <div className="flex flex-wrap gap-cluster">
                  <Pill>neutral</Pill>
                  <Pill tone="strong">strong</Pill>
                  <Pill tone="brand" icon={<GitCommitHorizontal size={ICON.xs} aria-hidden />}>
                    brand
                  </Pill>
                  <Pill tone="quiet">quiet</Pill>
                  <Pill tone="warning">warning</Pill>
                </div>
                <Eyebrow>Eyebrow above a heading</Eyebrow>
              </div>
            </Panel>
            <Panel title="Surface, buttons and links" description="The bordered box, the button with no chrome, the row that acts with the one row hover, and a link in running text.">
              <div className="flex flex-col gap-stack">
                <Surface padded>
                  <p className="m-0 type-body">
                    A Surface holds content that is not a titled Panel. Inside text, an <InlineLink href="/design">inline link</InlineLink> keeps the line colour until hovered.
                  </p>
                </Surface>
                <div className="flex flex-col">
                  <RowButton>
                    <GitCommitHorizontal size={ICON.md} aria-hidden /> A RowButton
                  </RowButton>
                  <RowButton>
                    <GitCommitHorizontal size={ICON.md} aria-hidden /> Another, hovered with bg-hover
                  </RowButton>
                </div>
                <PlainButton pressable className="w-fit rounded-md bg-sunken px-3 py-1.5 text-sm font-medium">
                  A PlainButton that presses to 0.96
                </PlainButton>
                <Quiet>A Quiet line, for an empty place and why it is empty.</Quiet>
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

function FrameSketch({ kind }: { kind: "page" | "workspace" }) {
  const bar = <span className="block h-3 rounded-xs bg-active" />;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="flex aspect-video flex-col gap-1.5 rounded-md border border-line bg-sunken p-2" aria-hidden>
        {kind === "page" ? (
          <>
            <div className="mx-8">{bar}</div>
            <div className="mx-8 flex-1 rounded-xs border border-dashed border-line-strong" />
            <div className="mx-8">{bar}</div>
          </>
        ) : (
          <>
            {bar}
            <div className="flex flex-1 gap-1.5">
              <div className="w-1/5 rounded-xs bg-active" />
              <div className="flex flex-1 justify-center">
                <div className="w-4/5 rounded-xs border border-dashed border-line-strong" />
              </div>
            </div>
          </>
        )}
      </div>
      <figcaption className="type-caption">{kind === "page" ? "Page frame: bar, page and footer on --page" : "Workspace frame: full-width bar, sidebar, --content column"}</figcaption>
    </figure>
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
    <button type="button" onClick={() => setOn((v) => !v)} onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)} className="plain-button flex min-h-6 w-full items-center gap-4 text-start">
      <span className="w-28 flex-none type-code text-secondary">
        {name} · {Math.round(seconds * 1000)}ms
      </span>
      <span className="relative block h-3 flex-1 rounded-full bg-sunken">
        <span className="absolute top-0 block rounded-full bg-brand" style={style} />
      </span>
    </button>
  );
}

function Table({ head, rows, end = true }: { head: string[]; rows: ReactNode[][]; end?: boolean }) {
  return (
    <table className="w-full border-collapse type-body">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="border-b border-line pb-2 text-start type-eyebrow">
              {h || <span className="sr-only">Sample</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className={`border-b border-line py-2 pe-4 tnum ${end ? "last:text-end" : ""}`}>
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
