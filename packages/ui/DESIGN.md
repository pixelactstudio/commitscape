# The Site's design system

Art direction: an instrument. Precise, calm, dense, dark-first, honest
numbers. Every screen draws from one set of tokens; pick a token, never type a
raw size, colour, radius or duration. `/design` on the Site renders all of it
from the tokens themselves.

| Layer | Where | Used as |
|---|---|---|
| Tokens (CSS) | `src/design/tokens.css` | `var(--color-text-secondary)`, `var(--brand)`, `var(--header-height)` |
| Tailwind bridge | `src/design/theme.css` | `text-sm`, `rounded-lg`, `gap-gutter`, `bg-heat-0`, `type-panel`, `surface` |
| Astryx theme | `src/theme.ts` | Astryx components read the same tokens: neutrals, accent, radius, motion, sizes, syntax |
| Tokens (TypeScript) | `src/design/tokens.ts` (`@commitscape/ui/design`) | charts, GSAP, inline styles: `CHART.tick`, `heat(2)`, `ICON.sm`, `FRAME`, `MOTION` |
| Motion | `src/motion` (`@commitscape/ui/motion`) | `DURATION`, `EASE`, `SPRING`, `useScene`, `Reveal` |
| Kit | `src/kit/` | `Page`, `PageHead`, `Panel`, `Stat`, `Surface`, `Pill`, `PlainButton`, `RowButton`, `InlineLink`, `Quiet`, `ScreenHeader`, `ScrollRow` |
| Frames | `src/App.tsx` (`Workspace`, `ScreenColumn`), the Site's `components/Frame.tsx` | the two frames below |

`tokens.test.ts` keeps the CSS, the TypeScript and the Astryx motion in step,
and checks that the brand is exactly `#0f7a37` / `#3ccf74`, that surfaces and
text are solid on the one neutral hue, and that nothing is below 12px.

The tokens are declared on `:root` and on `[data-astryx-theme]`, so they win
over the values Astryx generates for the same names on its theme wrapper.

## Frames

Every page sits in one of two frames, chosen by the route
(`staticData: { frame: "workspace" }`, read by `Frame`, which sets
`data-frame`). Every bar on a page uses the same edges: `--frame-inset`,
`max(--gutter, (100% − --frame) / 2 + --gutter)`, is the padding of the top
bar (through the Astryx theme's `top-nav` override), `Page`, the footer and
the home bands.

- **Page frame**: home, profiles, leaderboards, versus, races, crews, the
  dashboard, settings, privacy, Wrapped, Cards, `/design`, 404. One centred
  column `--page` (76rem). `Page width="narrow"` is a centred `--page-narrow`
  (48rem) column for reading and single forms.
- **Workspace frame**: a repository (`/gh/$owner/$repo`) and a Shared Report
  (`/s/$id`). The top bar runs the full width with a 16px gutter. Below it,
  from 1024px, a sidebar `--sidebar-width` (248px), sticky and the full height
  under the top bar: the repository, the Window (one row, 30d 90d 1y All, and
  a quiet dates button; where a screen ignores the Window the second row says
  so in a few words and the rows stay the same height), the screens as links
  grouped Report / Explore / Git with their counts, and Share and View on
  GitHub at the bottom. The sidebar scrolls as one piece when the window is
  short. Each screen reads in `ScreenColumn`, `--content` (80rem)
  centred in the main area with `--main-pad` (16 / 24 / 32); the Universe
  takes the whole main area. Below 1024px the sidebar becomes a slim bar
  (`--repo-bar-height`) with the Window and a button that opens it as a
  drawer. Switching screens never moves the navigation.
- The Overview opens with the repository's hero (face backdrop under a
  scrim); every other screen starts with one `ScreenHeader`: its title as
  the page's `h1`, what it counts, and its actions.

The shell is a plain `header` (sticky), `main` and `footer` in that order: the
footer sits outside `main`, so it is the page's `contentinfo` landmark, and the
"Skip to content" link moves focus to `main`.

Chrome heights are tokens, and every sticky offset, `scroll-margin` and
full-height box reads them; heights use `dvh`, never `vh`.

| Token | Value | For |
|---|---|---|
| `--header-height` | 56px | the top bar |
| `--repo-bar-height` | 48px | the slim workspace bar below 1024px |
| `--screen-header-height` | 56px | a screen's one-line header |
| `--chrome-top` | header, plus the slim bar below 1024px in a workspace | sticky offsets, `scroll-padding-block-start`, `scroll-mt-(--chrome-top)` |
| `--main-height` | `100dvh − --chrome-top` | the sidebar, anything that fills the window |

## Colour

One cool neutral (OKLCH hue 262), solid surfaces, the brand green used
sparingly. Each token has a light and a dark value through `light-dark()`,
driven by `color-scheme` from `data-theme`. Alpha is only for scrims, overlays
and shadows, never under text. `prefers-contrast: more` widens the text and
border steps in each mode.

| Role | Utility | Light / dark |
|---|---|---|
| page | `bg-body` | 0.975 / 0.145 L |
| surface | `bg-surface` | white / 0.18 |
| raised (menus, chosen segments) | `bg-raised` | white / 0.215 |
| sunken (wells, inputs) | `bg-sunken` | 0.965 / 0.155 |
| row hover, the one hover | `bg-hover`, `row-hover` | 0.95 / 0.215 |
| active, pressed | `bg-active` | 0.92 / 0.25 |
| inverse (primary buttons) | `bg-inverse` | ink / near white |
| text | `text-primary`, `text-secondary`, `text-tertiary`, `text-disabled` | 15.7, 6.4, 4.7:1 and up on every surface |
| separators, panel edges | `border-separator`, `border-line`, `border-line-strong` | hairlines |
| inputs (3:1) | `border-strong` | 0.64 / 0.52 L |
| focus | `outline-focus`, `--focus-ring` | the brand, 2px at 2px offset |
| accent | `bg-brand`, `bg-brand-strong` (hover), `text-brand`, `bg-brand-soft`, `border-brand-line`, `text-on-brand` | `#0f7a37` / `#3ccf74` solid |
| changes | `text-added`, `bg-added-solid`, `bg-added-soft`; the same for `removed` | keep their + and − signs |

Data: person series `--s1` … `--s8` (`personColour`), outside the green and red
bands and told apart under colour blindness; `--side-a` / `--side-b` for a
Versus; `--other`. Activity `--heat-0` … `--heat-4` (`heat(level)`), on a
coloured stage `--stage-cell-0` … `-4`, and for large filled areas such as the
Map's blocks the calmer `--area-heat-1` … `-4` (`heat(level, "area")`); streaks `--flame-1` … `-5`; stages
`--gradient-wrapped`, `--gradient-archetype`, `--glow-brand`, `--dots`, with
`text-on-stage` / `text-on-stage-2`. `--face-scrim` lies between a blurred
face and the text over it.

Astryx is pointed at the same tokens in `theme.ts`: backgrounds, borders,
icons, overlays, `--color-accent` (so focus rings and indicators are the
brand), on-accent, status colours and the grays. `color.accent` there takes
hex only; OKLCH lives in the tokens.

## Type

Inter 4.1, self-hosted from `/fonts` (subset to Latin, Latin Extended A,
punctuation, arrows and the symbols the Site uses; every OpenType feature and
the `opsz` and `wght` axes kept; the roman preloaded), with
`font-optical-sizing: auto`, so large type uses display optics and needs no
heavy tracking. The sans root sets `"cv11", "ss01"` (single-storey a, open
digits); `type-id` adds `"cv05", "cv08"` for logins, repository and file
names, so `I`, `l` and `1` differ. JetBrains Mono Variable for code, diffs,
hashes, paths, branch and tag names and key hints (`code`, `font-mono`,
`mono`, `type-code`), with `font-feature-settings: normal` and no ligatures.
Numbers are tabular (`tnum`, every `type-stat-*`, tables, `time`).

One scale, 12 to 72px, line heights unitless, tracking in `em`:

| Utility | Size / leading | For |
|---|---|---|
| `text-xs` (`text-2xs`) | 12 / 1.33 | chart ticks, legends, meta; the floor |
| `text-sm` | 13 / 1.54 | captions, pills, row meta |
| `text-base` | 14 / 1.43 | the interface: rows, buttons, menus, inputs from 640px |
| `text-md` | 16 / 1.5 | prose, explanations, inputs below 640px |
| `text-lg` | 18 / 1.33 | panel titles |
| `text-xl` | 24 / 1.25 | section headings, `type-stat` |
| `text-2xl` | 32 / 1.2 | large numbers |
| `text-3xl` | 28–32 | `type-page` |
| `text-4xl` | 36–44 | `type-display`, `type-stat-lg` |
| `text-5xl` | 44–72 | `type-hero` |

Roles, one class each: `type-hero` (home), `type-display` (identity heroes
and home sections), `type-page` (every page title, through `PageHead`),
`type-title` (section headings and a workspace `ScreenHeader`),
`type-heading` / `type-panel`, `type-lead`, `type-body`, `type-ui`,
`type-description`, `type-label`, `type-caption`, `type-micro`,
`type-eyebrow` (+0.05em, uppercase, `case`), `type-stat-lg`, `type-stat`,
`type-stat-sm`, `type-code`. Weights: 400 body, 500 labels, links and
buttons, 600 titles and numbers.

## Space

Tailwind's 4px steps inside a component; between components the named
rhythm: `cluster` 8, `stack` 16, `gutter` 16, `panel` 20, `page-top` 40,
`section` 48 (also every page's and screen's bottom), `band` 96 (home).

## Radius and surfaces

Astryx and Tailwind share one scale (`radius: { base: 4, multiplier: 1 }`):
`rounded-cell` 3 chart cells, `rounded-xs` 4 small marks, `rounded-sm` 6
controls inside controls, `rounded-md` 8 buttons, inputs and rows,
`rounded-lg` 12 panels and cards (Astryx `Card` too), `rounded-xl` 16 media
and stages, `rounded-full` pills, avatars and meters. Nested radii are
concentric. `surface` is the one bordered box (`Surface`); `Panel` is a
titled one. Shadows give elevation, hairline rings in dark: `shadow-ring`,
`shadow-sm` controls, `shadow-md` floating cards, `shadow-lg` dialogs,
`shadow-float` hero objects.

## Kit

- `Surface`: the rounded, hairline-edged box on the surface colour.
- `PlainButton` (`plain-button`): a button with no chrome; `pressable` adds
  the 0.96 press. `RowButton`: a full-width row with the one row hover.
- `Pill` (`Chip` is the same): one size, 24px, 13px text, tones `neutral`,
  `strong`, `brand`, `quiet`, `warning`.
- `InlineLink` (`inline-link`): a link in running text.
- `Quiet`: the line for an empty place, and why.
- `ScreenHeader`: a workspace screen's title, what it counts and its actions,
  set 12 to 16px below the top bar on every screen.
- `ScrollRow` (`kit/scroll.tsx`): a row that scrolls sideways when it does not
  fit, fading at each edge that has more, so a control or list is never cut
  off without a cue.
- `Toolbar` and `ToolbarField` (`kit/toolbar.tsx`): the one row of filters
  above a list, never inside its card: search, then the selectors by width
  (`person`, `option`, `order`), then a switch and "Clear filters". Filters
  that matter less go behind a "More filters" button that shows how many are
  set. The card under it opens with one status line that says how many rows
  and over what.
- `NoMatch` (`screens/kit.tsx`): what every filtered list says when nothing
  is left: the mascot, "No {things} match “{what was typed}”", a hint and a
  button that clears.
- `Page`, `PageHead`, `Panel`, `PanelSkeleton`, `Stat`, `Meter`,
  `AddedRemoved`, `LangDot`, `Eyebrow`, `Person`, `FaceStack`.

## Interaction and accessibility

- One focus ring: `:focus-visible` draws `--focus-ring` (the brand, 2px) at
  `--focus-offset` (2px), in the `reset` layer so Astryx controls keep their
  own; `Highlight` under forced colours. Never `outline-none` without a
  replacement.
- Hit areas are 24px or more (`hit` extends a small control with `::after`);
  the Window choice is 28px.
- Hovers only on hover-capable pointers (Tailwind's `hover:` and
  `@media (hover: hover)` in CSS); high-frequency hovers take
  `--duration-instant` (100ms) on colour or background.
- Transitions name their properties, never `all`. Presses scale to 0.96 over
  150ms (`press`), never when disabled. A theme switch runs no transitions
  (`no-transitions` for two frames).
- `scroll-padding-block-start` is `--chrome-top`, so focus never lands under
  the sticky bars.
- Inputs are 16px below 640px, so iOS does not zoom.

## Motion

`DURATION`: `instant` 100, `fast` 150, `exit` 150, `base` 300, `slow` 600,
`reveal` 800, `scene` 1200ms; Astryx's `--duration-fast/medium/slow` are the
same values (`MOTION`). Eases `out`, `in-out`, `in`, `emphasized`; springs
have no bounce. Enters: opacity, 12px rise and 4px blur over `base`, groups
100ms apart; exits are shorter and smaller. CSS reads `var(--duration-base)`
/ `var(--ease-out)`, scripts `DURATION.base` / `EASE.out` / `GSAP_EASE.out`.
Framer Motion for one element at a time, GSAP `useScene` for sequences. Above
the fold, the CSS `rise` / `fade` classes, so nothing waits on hydration.
Reduced motion shows the finished frame, or a cross-fade.

Stages that should feel alive (the Archetype) use `MeshGradient`, a WebGL
fragment shader drawn at reduced resolution, paused off screen, still with
reduced motion, and backed by `meshFallback(palette)` as a CSS gradient.

## Icons

Lucide, `currentColor`, at `ICON.xs` 12 in pills, `ICON.sm` 14 in buttons
and rows, `ICON.md` 16 in the sidebar and panel heads (stroke 1.75, absolute),
`ICON.lg` 20 in feature tiles.
