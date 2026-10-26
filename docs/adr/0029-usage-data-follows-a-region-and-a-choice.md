# Usage data follows a region and a choice

The Site, its server and the command collect as much usage data as each visitor's region and choice allow, from one config file. Every visitor is counted at a basic level without cookies; a visitor who allows all is also recorded, heatmapped and tied to their account.

## Status

accepted (2026-10-26). Replaces the rule that PostHog is never told who someone is and that a browser sending Do Not Track is not counted at all.

## Context

The Site counted page views and four server moments, under a keyed hash, and nothing for a browser that sends Do Not Track. That told us almost nothing: the owner's own visits were most of the counts, and there was no way to see why someone left a page or what a Build cost them. The owner wants every PostHog feature that helps make the Site better, with the EU's rules met where they apply.

## Decision

- **One config file** (`apps/site/src/lib/analytics-config.ts`) lists every feature with what it collects, and every region of countries with what runs before the visitor chooses, at Only basic and at Allow all. The browser, the `/ingest` proxy, the server's events and the privacy page all read it.
- **Two levels.** Basic is cookieless (PostHog's server hash): pages, time on a page, Web Vitals, the Site's moments and the country from the address with its last part removed. Allow all adds autocapture, rage and dead clicks, heatmaps, session replay with console, network timings and the Universe's canvas, identify with the GitHub login, name and picture, and the city from the whole address.
- **Two regions to start.** The EU, the EEA, the UK, Switzerland and India start at basic and ask; everywhere else starts at all and tells. A visitor whose country is unknown is in the region that asks. Do Not Track or Global Privacy Control start a visitor at basic; a choice made in the corner box, Settings or the privacy page always wins.
- **Never recorded:** what is typed into a field, source code and diffs (masked), request and response bodies, cookies and sign-in headers, Shared Report pages and their keys.
- **The server's events** follow the same level: at all they join the browser's PostHog session through its tracing headers and carry the whole address; the Builder's join the person the Site identified.
- **The command counts its runs** of `share`, `health`, `surviving` and `report`: the command, its duration and outcome, the version and the platform, under a random install id, through the Site's `/api/telemetry`. It says so on its first run and stops for `COMMITSCAPE_TELEMETRY=0` or `DO_NOT_TRACK=1`.
- **Errors stay in Sentry.** PostHog's exception capture is off.
- **Deleting your data** also asks PostHog to delete the person, their events and recordings, when the Site has a personal API key.

## Consequences

- The privacy page and the READMEs say what is collected; changing the config changes the privacy page with it.
- PostHog's project needs cookieless server hash mode, replay, heatmaps and a 30-day recording retention set to match.
- Session replay and canvas recording cost the browser some work at Allow all.
- The command is no longer silent: it sends one small request after each counted run, and waits at most 1.5 seconds for it.
