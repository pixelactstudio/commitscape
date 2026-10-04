# commitscape: the idea

Written 2026-10-04, after the owner used the live Site
(`commitscape.damnlabs.com`) on their own repositories and on facebook/react
and reviewed it. This is the product brief for Build Run 5. It says what
commitscape becomes, what changes, and in what order. `STATE.md` tracks
progress against it; `CONTEXT.md` is the glossary; `docs/adr/` holds the
decisions that are hard to reverse. Build Run 4's brief is in git history
(`git show e54e961:IDEA.md`).

---

## In one sentence

commitscape shows a developer what they have built, how they stand next to
the people they work with, and gives them something good to post about it.

## Why it changes

commitscape started from one question: how much work have I put into this
project? The answer grew into a Report about a repository, and the Report
answers questions an auditor asks (what is fragile, who holds which folder,
what changes together), not the ones a developer arrives with. The owner's
review of 2026-10-04 found:

- **Nothing on a repository page is about the person looking at it.** They
  look, think "neat", and leave, with nothing to come back for and nothing
  of theirs to share.
- **Git alone misses where the work is.** Most work is pull requests and
  reviews, and most repositories squash-merge, so commit counts say little.
  Kinds of work is empty wherever commits follow no convention, and the
  People table is mostly dashes.
- **Several panels mean nothing to a visitor:** the story so far (a list of
  first and last commits and releases), Did you know, Worth a look, Risk.
- **Repository analytics is already free elsewhere** (GitHub Insights, OSS
  Insight, Repobeats, star-history), often better presented.
- **The interface feels slow and unfinished:** pages load grey and then turn
  blue, skeletons replace whole pages instead of the missing part, the main
  chart draws twice, release lines bury the chart on large repositories,
  people have no avatars, and the logo is not the favicon or used anywhere
  on the Site.

Developer tools that reach tens of thousands of people share three things:
they are about *me*, they make something I post or embed (every embedded
README card is an advert), and they need nothing but a link. Build Run 5
turns commitscape around to the person.

## Who it is for

- **A developer proving their work:** a freelancer showing a client what
  they shipped this month, anyone writing a self-review, anyone posting on
  LinkedIn or X about what they built.
- **A developer on a team who likes to stay ahead:** they want to see how
  they stand among the 23 people on their project, fairly.
- **Friends who compete:** versus pages, races and crews.
- **Anyone with a GitHub profile README** who wants a better card on it.
- **A maintainer** who wants to thank contributors with a hall of fame.
- Still: **anyone curious about a repository**, through the trimmed
  repository page, and anyone using the CLI locally.

## What it must stay

- **Small.** One person maintains it. Every feature is about a person and
  makes something worth sharing, or it goes.
- **Honest.** No number the data cannot support. "Unknown" is never 0. A
  limitation is stated next to the number it affects.
- **Fair.** Standings rank by what is hard to inflate (Surviving Lines,
  merged pull requests, reviews) before what is easy (commits, raw lines).
  Bulk Commits, Generated Files and `.git-blame-ignore-revs` never count.
- **Private by default where it matters** (ADR-0020): private work is never
  named to someone who can't see it, and anyone can hide from comparisons.
- **Server-rendered and streamed.** Every page is drawn on the server with
  the data it has. Each slow part sits in its own Suspense boundary with a
  skeleton of its final size, so nothing moves when data arrives. GitHub's
  facts show at once; the engine's numbers stream in after.
- **Plain.** Every number in words a newcomer understands, with what it
  counts ("60 commits", never a bare "60").
- **Open source, all of it,** under MIT OR Apache-2.0.
- **Built openly with AI.** That is how the project is made, not a feature.
  The product shows nothing AI-related.

---

## What changed since Build Run 4

| Build Run 4 said | Build Run 5 says |
|---|---|
| A repository is the centre of everything | A person is the centre; the repository page is secondary (ADR-0020) |
| No scores or rankings of people; Leaderboards rank repositories | People are compared, within a repository and with each other, by several views shown side by side, never one combined score. Anyone can hide from comparisons (ADR-0020) |
| The Card is one composited image of a repository | Cards are a set of React components, rendered as animated SVG for READMEs and PNG for previews (ADR-0021) |
| Code Age is per file; blame-based surviving lines are "later" | Surviving Lines per person, from blame, are a headline number (ADR-0022) |
| Hosted Reports have no pull-request history | The Site reads pull requests and reviews from GitHub's API for profiles, and the Builder keeps each repository's pull requests (ADR-0020) |

Kept: the Rust engine, identity merging (ADR-0011), the Builder and its
queue, R2, Postgres, GitHub sign-in through the App (ADR-0017), Shared
Reports, the CLI, `npx commitscape`, and the MCP server. The terminal UI
stays frozen.

---

## The Site

| Page | What it is |
|---|---|
| `/` | One line on what commitscape is, a box that takes a GitHub username or a repository link, "See your own" with sign-in, example profiles and cards, install commands |
| `/u/<login>` | **The Profile.** GitHub identity and avatar; totals (pull requests opened, merged and closed, reviews given, median time to merge, commits, lines added and removed, Surviving Lines, active days, longest streak); the Archetype and Achievements; the per-project breakdown; activity over time; languages over the years; the people they work with most |
| `/u/<login>/<owner>/<repo>` | **You in this repository.** Your numbers first, then your Standing, then the Standings of everyone in it, each with avatar, pull requests, reviews, lines and Surviving Lines, and what each person works on |
| `/u/<login>/cards` | **The card gallery.** Every Card for this person, in light and dark, with the README Markdown to copy, a PNG to download, and share to LinkedIn and X |
| `/u/<login>/work` | **Proof of Work.** Everything shipped in a chosen period, grouped by repository and month, with links; a link to share and Markdown and PDF to download |
| `/vs/<a>/<b>` | **Versus.** Two Profiles side by side, a winner per view, with its own Card |
| `/races/<id>` | **A Race.** A fixed window, two or more people who agreed to it, live Standings, a finish Card |
| `/crews/<id>` | **A Crew.** A group that compares itself every Season |
| `/gh/<owner>/<repo>` | **The repository page,** trimmed (below), with contributors shown as people with avatars |
| `/leaderboards` | Repositories as before, plus people: top contributors this month, per repository, with a time filter. Only people who haven't hidden |
| `/me` | Settings: Connected Repositories, Rivals, Crews, what is shown and hidden, "Delete my data" |
| `/s/<id>#<key>` | A Shared Report, unchanged |
| `/privacy` | Rewritten for Profiles, comparisons and Cards |

### Two speeds

A Profile has two sources (ADR-0020):
1. **GitHub's API, at once:** identity, avatar, repositories, pull requests
   with their additions and deletions, reviews, issues, contribution
   calendar. Read with the signed-in viewer's own token; anonymous views
   use the Site's token and a stored copy.
2. **The engine, streamed in:** for each repository the person works on that
   the Site has built, their Lines Changed and Surviving Lines, under every
   address they commit with. Each section shows "counting…" in its own
   skeleton until its Build finishes, then fills in.

### The repository page, trimmed

- **Kept:** the stat tiles; one chart of commits over time with releases
  drawn only where they fit (the story so far merges into it); contributors
  with avatars, pull requests and +/− lines; Languages; Commits with
  avatars; the Map, as something fun to explore.
- **Removed from the Site:** the story so far as a list, Did you know, Worth
  a look, Risk. Risk stays in the CLI and the MCP server, where an agent or
  a lead asks for it.
- **Hidden when empty:** Kinds of work in a repository with no commit
  convention, and any column that would be all dashes.
- **Search** across the page: people, files, commits.

## Cards

A Card is one React component rendered three ways (ADR-0021): on the Site
as itself, as **SVG** for README embeds (animated: numbers count up, bars
grow, the calendar fills), and as **PNG** for link previews and downloads.
Every page has a dynamic preview image, like GitHub's, from a Card.

The set, each in light and dark:
- **Totals:** pull requests, reviews, lines, Surviving Lines.
- **Top repositories:** where the person's work is, with their Standing in
  each.
- **Survival:** "41k of the 120k lines I wrote still run."
- **Calendar:** the contribution calendar, animated.
- **Languages over the years.**
- **Archetype** and **Achievements.**
- **Person in a repository:** "Top 3% of facebook/react contributors."
- **Versus**, **Race finish**, **Season recap**.
- **Hall of fame** for maintainers: a repository's contributors with avatars
  and their numbers.
- **Proof of Work:** a period's summary.

Embeds are served from a stored copy, refreshed in the background at most
every six hours, so a popular README never reaches GitHub's API.

## The fun side

- **Versus:** any two public Profiles, a winner per view, no overall score.
- **Rivals:** pick a person; your Profile always shows the gap ("312
  Surviving Lines behind this month").
- **Archetypes:** a label from plain rules over the numbers, no AI: Builder,
  Reviewer, Janitor (removes more than adds), Night Owl, Firefighter (mostly
  fixes), Polyglot, and a few more, each with its rule shown.
- **Achievements:** "First pull request merged into a 10k-star repository",
  "100 reviews", "A line that has survived five years", "Removed 10k lines in
  one pull request". Each has a Card.
- **Seasons:** Standings in a Crew and on the people boards reset monthly so
  a newcomer can win; each Season ends with a recap Card.
- **Races:** a fixed window, two or more people who each accepted, live
  Standings, a finish Card.
- **Crews:** a group of friends or a team with shared Standings each Season.
  Joining is by invitation, accepted.

## Proof of Work

The original problem, answered directly: pick a period, optionally a
repository or a client's organisation, and get every merged pull request and
commit in it, grouped by repository and month, with sizes and links. Share it
as a link, or download Markdown or a PDF for a client or a self-review.
Private work appears only to the signed-in person, and in what they choose
to share.

## What to watch

- **Privacy** (ADR-0020). A private repository's Standings are shown only to
  people who can see it on GitHub. A Profile shows private work as totals,
  never by name, unless the person opts in. A signed-in person can hide
  their Profile from Versus, Leaderboards and other people's Standings.
  Races and Crews need each person's acceptance.
- **Cost of Surviving Lines** (ADR-0022). Blame is expensive on huge
  repositories, so it runs per person, only over the files they changed,
  when someone asks, and is kept per repository head. Over a time budget it
  says "not counted", never a guess.
- **GitHub's rate limits** (ADR-0020). The viewer's own token where there is
  one; stored copies everywhere else; embeds never call GitHub.
- **Gaming.** Standings lead with Surviving Lines and merged pull requests.
  Raw commits and raw lines are shown, never ranked first.
- **The name.** commitscape still fits. It is not changed in this run.

---

## Build Run 5: the plan

Phases continue from Build Run 4. Each phase ends with every check passing
(Rust on Linux, macOS and Windows; the TypeScript workspace; Playwright)
and `STATE.md` updated with its measured numbers and findings. **The agent
doing the work never commits, pushes, publishes or deploys; the owner
commits.**

| Phase | What | Gate |
|---|---|---|
| 32 | Foundation: server rendering with a Suspense boundary and sized skeleton per section; the theme applied on the server (no grey flash); the logo as favicon and in the header; the chart drawn once; releases thinned on dense charts; the repository page trimmed as above, with avatars and search | Playwright on every page; Cumulative Layout Shift under 0.05 on each, measured; screenshots in both themes; no request after hydration repeats one the server made |
| 33 | The Profile, first speed (ADR-0020): `/u/<login>` from GitHub's API, stored copies in Postgres, the viewer's token, the per-project breakdown, the new landing page | Tests against GitHub responses written by hand; the owner's Profile and two well-known ones rendered and screenshotted; GitHub API calls per view counted and recorded |
| 34 | The Profile, second speed (ADR-0022): Surviving Lines in the engine, per person and per repository head; the Builder computes them on request; Lines Changed per person; sections stream in | Hand-worked fixture values for Surviving Lines, Bulk Commits and ignored revisions; time measured on ripgrep, facebook/react and rust-lang/rust; over budget shows "not counted" |
| 35 | You in this repository: `/u/<login>/<owner>/<repo>`, Standings, the Builder keeping each repository's pull requests and reviews, privacy rules and hiding, `/privacy` rewritten, MCP tools for a Profile and Standings | Access tests: a private repository's Standings refused to someone without access; a hidden person absent everywhere; pull-request fetch time on facebook/react recorded |
| 36 | Cards (ADR-0021): the rendering pipeline, the set above, animation, light and dark, the gallery, embeds with stored copies, a preview image on every page | Every Card snapshotted as SVG and PNG; an embed shown in a real README on GitHub (owner's test repository); render time per Card under 200 ms, measured |
| 37 | Proof of Work: `/u/<login>/work`, filters, share link, Markdown and PDF | A month of the owner's work checked against GitHub by hand; private items absent from a shared link unless chosen |
| 38 | Versus and Rivals | Fixture Profiles give the winners worked out by hand; a hidden Profile refused |
| 39 | Archetypes and Achievements, each rule written in `CONTEXT.md` and on the page | Every rule tested at its edges on fixtures |
| 40 | Seasons, Races and Crews: invitations, acceptance, live Standings, recap and finish Cards | End to end with three test accounts; leaving a Crew removes the person from it at once |
| 41 | People on the Leaderboards: top contributors this month, per repository, with a time filter and Seasons | Boards built from the seed repositories and screenshotted; hidden people absent |
| 42 | Wrapped 2026: a person's year across GitHub, as a page and a set of Cards | The owner's Wrapped checked against GitHub by hand |

### Needs the owner

- Adding the "Read user profile" permission to the GitHub App if Phase 33
  finds it needed (it is read-only).
- A test repository on GitHub to show an embed in a real README (Phase 36).
- Two more GitHub accounts, or friends, to test Races and Crews (Phase 40).
- Deploying each phase when they choose.

## Later, not in this run

- Notifications for Rivals, Races and Crews (email, then maybe push).
- A paid plan for agencies: Proof of Work across a team, for clients.
- GitLab.

## Not doing

- One combined score for a person.
- Anything AI in the product.
- New features in the terminal UI.
- Email addresses on the Site.
- Renaming the project in this run.
- Publishing, deploying or buying anything during the build run.
