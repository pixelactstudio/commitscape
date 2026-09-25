# The Site is TypeScript on Cloudflare's free plan; Rust never runs as a web server

The hosted Site is a TanStack Start app on Cloudflare Workers. It uses D1 for its database and R2 for stored Reports. It must run within Cloudflare's **free** Workers plan. Every page is a static asset. Only the Site's own API runs as Worker code, and each API request stays well inside the free plan's 10 ms of CPU. The Rust engine never becomes a web server. It runs as a batch command on the owner's server (ADR-0015) and on users' machines.

## Status

accepted (2026-09-25, Build Run 4 plan). Reverses IDEA.md's Build Run 3 "Not doing" lines on a hosted service and on TanStack Start. ADR-0010 still governs the local interface.

## Context

The owner wants commitscape to grow beyond a local tool:
- a landing page
- public repository lookup
- sharing from headless machines
- GitHub sign-in with "your repositories"
- leaderboards

The owner doesn't write Rust and doesn't want to run a Rust API server. They named TanStack Start, and said Cloudflare is acceptable **only on the free plan**. They also have a VPS.

Cloudflare's free-plan limits, from its docs on 2026-09-25:

| Service | Free limit |
|---|---|
| Workers | 100,000 requests a day; 10 ms CPU per request (waiting on network, D1 or R2 does not count); 128 MB memory; 50 subrequests per request |
| Static assets | free and unlimited, unless `run_worker_first` routes them through the Worker |
| D1 | 5 GB; 5 million rows read and 100,000 written a day |
| R2 | 10 GB-month; 1 million writes and 10 million reads a month; egress free |
| Durable Objects | free-plan SQLite only; not needed by this design |
| Containers | paid plan only, so the engine cannot run on Cloudflare for free |

## Decision

- **Pages are prerendered or served as a single-page app from static assets.** No page is server-rendered per request. Social previews (Open Graph tags and images) for repository pages are written when a Report is built, as static files in R2 served through the API. They are never rendered per request.
- **The Worker handles only `/api/*`:** auth, Report lookup, Share creation and deletion, the Builder's callbacks, GitHub webhooks, leaderboards. Each handler reads or writes D1 or R2 and returns. Anything CPU-heavy happens in the browser (decrypting a Shared Report, searching commits) or on the Builder (the analysis).
- **Reports travel as gzip.** The Worker streams them from R2 to the browser without parsing them.
- **Data:** D1 through Drizzle ORM, with migrations in the repository. Sessions come from an auth library with a D1 adapter (Better Auth is the first candidate).
- **The product name and the Site's origin live in one constant** each, in `packages/data`, because the name may change before launch. The CLI reads the origin from that value at build time, overridable with `COMMITSCAPE_SITE`.
- **`wrangler dev` runs the Site entirely on the developer's machine,** with local D1 and R2. Nothing is deployed by the build run. The owner deploys.

## Consequences

- **The daily budget is the Worker's 100,000 API requests.** Page views are static assets and free. A viral day is survivable, and Cloudflare's $5 plan (10 million requests a month) is the escape hatch.
- **No live connection between a user's machine and the Site.** This is why sharing uploads a Report (ADR-0016) rather than relaying one.
- **Per-IP limits** on Builds and Shares are needed from day one. Use Cloudflare's rate-limiting rule or binding if the free plan includes it, otherwise a counter in D1. Verify which before building.
- **Every handler's CPU time is measured** (`wrangler dev` and `wrangler tail` report it) and recorded in STATE.md.
