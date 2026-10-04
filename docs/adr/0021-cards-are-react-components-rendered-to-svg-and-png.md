# Cards are React components, rendered to SVG for READMEs and PNG for previews

Each Card is written once as a React component with inline styles. The Site shows it as a component; Satori turns it into SVG for README embeds, with CSS animation added; resvg turns that SVG into PNG for link previews and downloads.

## Status

accepted (2026-10-04, Build Run 5 plan). Replaces the single composited repository Card.

## Context

The owner wants a set of Cards a person picks from, animated README embeds, and dynamic preview images like GitHub's. GitHub strips HTML, styles and scripts from READMEs and serves images through its own caching proxy, so only an image survives there. An SVG with CSS keyframes animates inside a README; a GIF is larger, blurry when scaled and has no dark mode. Designing in HTML and CSS is faster and better than writing SVG by hand.

## Decision

- **One component per Card,** in `packages/ui`, using only the CSS Satori supports (flexbox, no grid).
- **SVG:** Satori renders the component; a small post-processing step adds keyframe animation (counting numbers, growing bars, a filling calendar) to marked elements. Light and dark come as two URLs, for GitHub's `<picture>` with `prefers-color-scheme`.
- **PNG:** resvg renders the same SVG, unanimated, for Open Graph images and downloads.
- **Fonts** are bundled files, so output is the same on every machine.
- **Stored copies.** A Card is rendered when its data changes, kept in R2, and served with `cache-control` of six hours. A request never waits on GitHub or the Builder; a stale Card is served and refreshed in the background.

## Consequences

- Satori's CSS subset limits Card layouts, and some fine typography won't come out the same as on the Site.
- Every Card has SVG and PNG snapshot tests.
- The Builder's existing resvg dependency moves to the Site, or Card rendering moves to the Builder. Phase 36 decides by measured render time.

## As built (Phase 36)

- **Cards render on the Site**, not the Builder: Satori and resvg together take 39 to 135 ms for each Card, warm, on this machine (57 ms for a cold first one in the production build), so there is no reason to move them. The Builder's own card step and its resvg are gone, and with them the repository table's `card_key`.
- **Animation without ids.** Satori keeps no ids or classes, and draws text as outlines. A Card marks an element to animate by giving it a colour no Card uses (`#01…` rises, `#02…` grows, `#03…` fills, numbered); the post-processing step swaps each back to its real colour with a class and a delay, and adds the keyframes, with `prefers-reduced-motion` honoured. Because text is outlines, numbers rise into place rather than count up.
- **Stored copies** in R2 under `cards/…-d<design>.svg|png`, with the time drawn beside them; under six hours old they are served as they are, older ones are served while a new one is drawn, and a person with no stored Profile gets a "Reading…" Card for a minute while their Profile is read in the background. Bumping `CARD_DESIGN` invalidates every stored Card.
- **Fonts**: Inter 400, 600 and 700 (WOFF, OFL), inlined into the server bundle, so a Card looks the same everywhere.
- **The gallery shows the served images** (`<img>` of the SVG), so people see exactly what an embed shows, animation included; the Card components are the source of those images.
