# The web UI is built on Astryx; charts stay ours unless Astryx's are better

The shared screens (`packages/ui`, ADR-0013) use Meta's Astryx design system (`@astryxdesign/core` and a theme package) for every component: app shell, navigation, tabs, tables, tooltips, dialogs, command palette, avatars, forms, toasts. The charts stay our own SVG, restyled with Astryx's theme tokens. An Astryx chart replaces one of ours only where it's plainly better.

## Status

accepted (2026-09-25, Build Run 4 plan).

## Context

The owner wants the UI to look much better with less effort. They chose Astryx over shadcn/ui, and said a complete visual change is fine: nobody outside has seen the current UI, so there is no consistency to lose.

Facts checked on 2026-09-25:
- **Licence and maturity:** MIT, Meta; version 0.6.3, labelled beta, with a minor release every one to two weeks.
- **Styling:** components are written in StyleX but ship precompiled CSS (`reset.css`, `astryx.css`, the theme's CSS, about 30 KB gzipped for all of it), so no compiler or bundler plugin is needed.
- **Compatibility:** its peers are React 19 and `@stylexjs/stylex`, and it works with Vite (it has an official example app). TanStack Start isn't documented.
- **Components:** Table (sorting, filtering, pagination), CommandPalette, Typeahead, TabList, Tooltip, HoverCard, Dialog, Toast, Avatar and AvatarGroup, date inputs, AppShell, TopNav, SideNav.
- **Charts:** only in `@astryxdesign/charts`, published under `@canary`, built on d3: bar, line, area, dot, band, candlestick. There is no treemap and no calendar heatmap, which the Map, the calendar and hours of the week need.
- **Its CLI:** `astryx init` writes into `AGENTS.md` and `CLAUDE.md`.

## Decision

- **Pin exact versions** (`-E`) of `@astryxdesign/core`, the chosen theme and `@stylexjs/stylex`. Upgrade on purpose, with its codemods (`astryx upgrade`), never by range.
- **Theming.** One commitscape theme, built with `defineTheme` from a seed colour, in light and dark. It replaces `web/src/theme.ts`'s themes. A theme picker offers light, dark and system.
- **Charts are ours** (treemap, calendar grid, hours, columns, lines, bars). They read colours, fonts, radii and motion from Astryx's CSS variables, so they match. `@astryxdesign/charts@canary` may replace the bar and line charts only after a side-by-side screenshot shows it's better. Recharts is the fallback if neither is good enough.
- **Don't run `astryx init` or `swizzle`.** `swizzle` would bring the StyleX compiler into the build.
- **The same components serve the local page and the Site,** so both look the same.

## Consequences

- **Every screen is rebuilt on Astryx components.** The Playwright tests and screenshots are the check that nothing was lost.
- **The binary grows by the added CSS and JS.** A few hundred KB, which is small next to an 8.6 MB binary. The number is recorded.
- **Astryx's churn is a maintenance cost.** Exact pins keep it to the times we choose.
