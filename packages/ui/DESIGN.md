# The Site's design system

Every screen of the Site, from the home page to a repository's nested
screens and the animated scenes, draws from one set of tokens. Pick a token;
never type a raw size, colour, radius or duration.

| Layer | Where | Used as |
|---|---|---|
| Tokens (CSS) | `src/design/tokens.css` | `var(--type-sm)`, `var(--brand)`, `var(--radius-lg)` |
| Tailwind bridge | `src/design/theme.css` | `text-sm`, `rounded-lg`, `gap-gutter`, `bg-heat-0`, `type-panel` |
| Tokens (TypeScript) | `src/design/tokens.ts` (`@commitscape/ui/design`) | charts, GSAP, inline styles: `CHART.tick`, `heat(2)`, `ICON.sm` |
| Motion | `src/motion` (`@commitscape/ui/motion`) | `DURATION`, `EASE`, `GSAP_EASE`, `useScene`, `Reveal` |
| Primitives | `src/kit/layout.tsx` | `Page`, `PageHead`, `Panel`, `Stat`, `Chip`, `Eyebrow`, `Meter` |

`tokens.test.ts` keeps the CSS and the TypeScript in step.

## Type

One scale, 11 to 76 px. Sizes from `3xl` up grow with the viewport.

| Utility | Size / leading | For |
|---|---|---|
| `text-2xs` | 11 / 16 | chart ticks, legends, the smallest meta |
| `text-xs` | 12 / 16 | captions, chips, table meta |
| `text-sm` | 13 / 20 | descriptions, list rows, labels |
| `text-base` | 14 / 22 | body |
| `text-md` | 15 / 24 | lead paragraphs |
| `text-lg` | 16 / 24 | panel titles |
| `text-xl` | 20 / 28 | section headings, small numbers |
| `text-2xl` | 26 / 32 | numbers in a panel |
| `text-3xl` | 28–36 | page titles |
| `text-4xl` | 34–44 | headline numbers, home section headings |
| `text-5xl` | 44–76 | the hero |

Text styles combine size, weight, tracking and colour. Prefer them to
assembling the same classes by hand:

`type-hero`, `type-display`, `type-title`, `type-heading`, `type-panel`,
`type-lead`, `type-body`, `type-description`, `type-label`, `type-caption`,
`type-micro`, `type-eyebrow`, `type-stat-lg`, `type-stat`, `type-stat-sm`,
`type-code`.

Weights: 400 body, 500 labels and links, 600 titles and numbers. Numbers that
line up use `tnum`.

## Space

Tailwind's 4 px steps for anything inside a component (`gap-1` … `gap-6`).
Between components, use the named rhythm:

| Token | Value | Between |
|---|---|---|
| `cluster` | 8 | buttons, chips, inline groups |
| `stack` | 16 | a panel's head and body, stacked blocks in a panel |
| `gutter` | 16 | panels in a grid |
| `panel` | 20 | a panel's edge and its content |
| `page-top` | 40 | the header and a page's title |
| `section` | 48 | a page's sections |
| `band` | 96 | full-width bands on the home page |

## Radius

`rounded-cell` (3) calendar cells and bars, `rounded-xs` (4) avatars of
repositories and small marks, `rounded-sm` (6) inputs inside controls,
`rounded-md` (8) buttons, rows and tiles, `rounded-lg` (12) panels and cards,
`rounded-xl` (16) media and scene stages, `rounded-2xl` (20) hero objects,
`rounded-full` chips, avatars of people and meters.

## Colour

Astryx gives the surfaces and text (`bg-body`, `bg-surface`, `text-primary`,
`text-secondary`); the design tokens add what the product needs, each with a
light and a dark value:

- Ink: `text-primary`, `text-secondary`, `text-tertiary`, `text-quiet`.
- Surfaces: `bg-body`, `bg-surface`, `bg-raised`, `bg-sunken`, `bg-hover`.
- Lines: `border-line`, `border-line-strong`.
- Brand: `text-brand`, `bg-brand-soft`, `border-brand-line`, `text-on-brand`.
- Data: series `--s1` … `--s8` (`personColour`), `--side-a` / `--side-b` for
  the two people in a Versus, `added` / `removed`, `other`.
- Activity: `--heat-0` … `--heat-4` (`heat(level)`); on a coloured stage,
  `--stage-cell-0` … `--stage-cell-4` (`heat(level, "stage")`). An empty day
  is `heat-0`, never a hole.
- Streaks: `--flame-1` … `--flame-5`, cold to hot.
- Stages: `--gradient-wrapped`, `--gradient-archetype`, `--glow-brand`,
  `--dots`; text on them is `text-on-stage` / `text-on-stage-2`.

## Elevation and layers

`shadow-xs` hairline lift, `shadow-sm` controls, `shadow-md` floating
cards in a scene, `shadow-lg` dialogs and popovers, `shadow-float` hero
objects. Layers: `--z-sticky` (20), `--z-header` (30), `--z-overlay` (40),
`--z-toast` (50), `--z-progress` (100).

## Motion

Durations `instant` 120, `fast` 200, `base` 360, `slow` 600, `reveal` 800, `scene` 1200 ms;
eases `out`, `in-out`, `in`, `emphasized`. CSS reads them as
`var(--duration-base)` / `var(--ease-out)`, scripts as `DURATION.base` /
`EASE.out` / `GSAP_EASE.out`. Framer Motion for one element at a time, GSAP
`useScene` for sequences. Above the fold, use the CSS `rise` / `fade`
classes so nothing waits on hydration. Reduced motion shows the finished frame.

Stages that should feel alive (the Archetype) use `MeshGradient`, a WebGL
fragment shader that flows through a palette (`MeshPalette`: a dark base and
three lights), drawn at reduced resolution, paused off screen, still with
reduced motion, and backed by `meshFallback(palette)` as a CSS gradient.

## Icons

Lucide, at `ICON.xs` 12 in chips, `ICON.sm` 14 in buttons and rows,
`ICON.md` 16 in panel heads, `ICON.lg` 20 in feature tiles.
