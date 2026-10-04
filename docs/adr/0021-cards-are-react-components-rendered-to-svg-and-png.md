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
