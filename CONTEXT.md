# commitscape

A tool that shows a developer what they have built, how they stand next to the people they work with, and gives them something to share about it (ADR-0020). It reads git history, locally or on the Site, and GitHub's API. Every number says what it counts, and none is a guess.

## Language

### What we measure

**Churn**:
The number of commits touching a file within the active Window. Merge Commits and Bulk Commits are excluded.
_Avoid_: activity, edits, changes, revisions.

**Change Coupling**:
The tendency of two files to appear in the same commit. Reported symmetrically as a Jaccard degree, and directionally as the probability that one changes given the other did.
_Avoid_: logical coupling, dependency, correlation, co-change.

**Ownership**:
The distribution of commit counts by Author across a directory within the Window, counting commits that touched a file people wrote under that directory. Merge Commits and Bulk Commits are excluded. Commit-weighted, never line-weighted — a distinction the tool states rather than hides.
_Avoid_: authorship, contribution, blame.

**Bus Factor**:
The smallest number of Authors who together hold more than 80% of a directory's Ownership. A directory where one Author holds more than 80% of commits has a Bus Factor of 1; one split 60/30/10 has a Bus Factor of 2.
_Avoid_: truck factor, key person risk.

**Maintainer**:
Someone who made at least three commits in the last 90 days: who keeps a project going now. Not a role anyone was given.
_Avoid_: owner, core team, admin.

**Staleness**:
Time since the last commit touching a file, reported in buckets. Unlike Churn, it counts Bulk Commits — a file that was touched was touched.
_Avoid_: age, freshness, last modified.

**Code Age**:
The distribution of surviving code by the quarter in which it was introduced. Until line-level history exists it is measured per file: each file's lines count toward the quarter the file first appeared. Distinct from Staleness, which is per-file and backward-looking from now.
_Avoid_: code lifetime, Surviving Lines (a different, line-level measure).

### What we measure it over

**Window**:
The active time range that every panel is computed over. One of a fixed set of spans, changeable globally at any moment. The difference between two Windows is itself a finding. A Window ends at its anchor: the present moment when someone is looking, or the newest commit when the output must come out the same every time it is produced.
_Avoid_: range, period, timeframe, filter.

**Index**:
The complete set of facts extracted from a repository by walking its history once and reading its HEAD tree once. Everything the tool displays is derived from the Index alone.
_Avoid_: database, cache, model, store.

**Stored Index**:
A repository's Index as the Site keeps it, in Postgres: every commit with its Changeset and its Mainline, its files and folders, its people, and its HEAD. A Build appends the commits it has not seen and fills in the Lines Changed counted since; a rebuilt engine cache starts a new one. The Site looks rows up in it (the Commit List, a person's commits on a day, branches, pull requests); every screen's answer comes from its Pack.
_Avoid_: index tables, commit store.

**Pack**:
A repository's Index at one head as the engine service reads it, with its people already resolved to their GitHub logins and colours, its Mainline, and no email address. Each publish of a Build writes a new one, which never changes; the Stored Index names the current one.
_Avoid_: snapshot, bundle, cache, export.

**Mainline**:
The commits of a Stored Index that the default branch holds: every commit reachable from HEAD, and among them the first-parent line, the commits HEAD itself went through. The Stored Index also holds commits only other branches and tags reach, which never reached the default branch; the Mainline tells them apart. A Build brings it up to date from the commits added since, walking only the new part of the first-parent line, and works it out again whole when that line no longer runs through the head it was last worked out for, since a merge can bring older commits into it.
_Avoid_: main branch, trunk, reachable commits.

**Main Arrival**:
When a commit of the Mainline reached the default branch: the committer time of the first-parent commit that brought it there. A commit on the first-parent line arrives by itself; a commit made on a branch arrives with the merge that first brought it in, however long before it was written.
_Avoid_: merge date, landing, integration time.

**Changeset**:
The set of files a single commit touched, along with how each was touched. The Index stores Changesets rather than aggregates, which is what makes the Window changeable without re-reading the repository. A Merge Commit's Changeset holds only the files it changed relative to every parent, such as a conflict resolution, never the branch it merged.
_Avoid_: diff, commit contents, file list.

**Lines Changed**:
The lines a change added and removed, counted as `git diff --numstat` counts them by a pass that runs after the first screen: the Mainline first, newest first, then the commits only other branches and tags reach. The pass never counts Bulk Commits, lockfiles or Generated Files, nor a change to a binary file or to a file over a megabyte: each is not counted, which is shown as such and never as zero. A pass given a time budget stops when it runs out; the commits it did not reach are its lines left, not counted until a later pass counts them. The Site shows a repository's Lines Changed once the Mainline's are all counted. A person's Lines Changed also leave out Merge Commits and commits named in `.git-blame-ignore-revs`. One of several views of what a person did; never combined with the others into a score.
_Avoid_: LOC, churn, impact, productivity.

**Merge Commit**:
A commit with more than one parent. Its Changeset is usually empty. Excluded from Churn, Change Coupling and Ownership.
_Avoid_: merge, pull request.

**Bulk Commit**:
A commit touching more than a configured number of files. Excluded from Churn, Change Coupling and Ownership because reformats, lockfile regenerations, and vendored drops would otherwise dominate every ranking, and its Lines Changed are never counted.
_Avoid_: large commit, mega commit, noise.

**File Identity**:
The identity of a file across its history, preserved through exact renames so that moving a file does not sever its past. A file lives at one path at a time. A file created later at a path another file moved away from is a different file; a file deleted and re-added at the same path is the same file.
_Avoid_: path, filename, file key.

**Author Identity**:
A single person, resolved from the several Signatures they have committed under (ADR-0011): the repository's own mailmap, the same address in any case, GitHub's noreply addresses by account number, addresses GitHub links to one account, and the same full name. The last two are Merges, shown and undoable; anything less certain, such as a one-word name, is surfaced as a suspected duplicate rather than merged.
_Avoid_: author, committer, contributor, user.

**Merge** (of identities):
Joining two addresses into one Author Identity on evidence weaker than the address itself: the same GitHub account, or the same full name of two or more words that is not a placeholder. Every Merge is shown on the person ("merged 2 identities"), and the user can undo it; the undo is kept in the cache directory, never in the repository. Not to be confused with a Merge Commit.
_Avoid_: dedupe, alias, link.

**Bot**:
An automation account, recognised by a `[bot]` suffix or a short list of known accounts such as `github-actions`. Its commits count as activity, but a Bot is never ranked among people, never holds a folder and gets no colour.
_Avoid_: agent, automation, service account.

**Signature**:
One name-and-email pair exactly as it appears on commits. The Index records Signatures; which Author Identity each belongs to is resolved on top, so editing a mailmap never requires re-reading history.
_Avoid_: alias, raw identity, email.

**Local Time**:
When a commit's author made it, on the author's own clock and calendar: the time zone recorded on the commit, applied to the author time rather than the committer time. The rhythm of a team (its busiest hours and weekdays, its nights and weekends) is measured in Local Time.
_Avoid_: timestamp, commit date, time of day.

**Landing Day**:
The day a commit entered history, on its author's calendar. It is what places a commit in a Window, so calendars, active days and streaks count Landing Days. It differs from the day of its Local Time only for a commit rebased or amended after it was written.
_Avoid_: commit date, merge date.

**Commit Kind**:
What a commit says it is, read from a conventional commit subject (`feat:`, `fix:`, `docs:` and the rest) or from a revert. A commit whose message follows no convention is Other; the tool does not guess from prose.
_Avoid_: commit type, category, label.

**Prose File**:
A file a person wrote to be read rather than run: Markdown, reStructuredText, AsciiDoc, plain text. Counted in Churn, Ownership and Change Coupling, but never among the largest files, since size measures code.
_Avoid_: docs, documentation file, text file.

**Generated File**:
A tracked file that no person wrote and nobody should be asked to look at — lockfiles, minified output, ORM snapshots, vendored trees. Excluded from every ranking.
_Avoid_: artifact, build output, ignored file.

### What we produce

**Overview**:
The screen a Report opens on: the repository's story at a glance. Its size, age and languages, how the Window's commits fell over time, who wrote them, and facts worth sharing.
_Avoid_: dashboard, home, summary.

**Map**:
The code at HEAD drawn as nested rectangles, each as large as its lines of code, coloured by Churn, by Staleness or by who holds it. Entered one directory at a time.
_Avoid_: treemap, tree view, file browser.

**Card**:
One of a set of images made for sharing, about a person, a person in a repository, a Versus or a repository: one React component, shown on the Site, embedded in a README as animated SVG, and used as a PNG link preview (ADR-0021). The tool's growth mechanism, treated as a product feature.
_Avoid_: summary image, badge, widget (and report, which is the Report).

**Embed**:
A Card placed in a README or elsewhere by its address, served from a stored copy that never waits on GitHub.
_Avoid_: badge, widget, stats image.

**Report**:
A repository's story told screen by screen (the Overview, Activity, People, a person, the Map, a file) for a Window. On the Site the engine service answers each screen from the repository's Pack, for any Window, and its Commit List is rows in the Stored Index. A Shared Report carries every screen's answer for its Windows, written ahead of time on someone's machine, and answers only what it was written with.
_Avoid_: export, snapshot, dump.

**Shared Report**:
A Report someone uploaded from their own machine, with `commitscape share` or a bare `commitscape`, so another browser can open it, locked with a key that exists only in its link. The Site stores it without being able to read it; its Commit List stays inside it and is searched in the browser. It expires after hours, and anyone with the link can delete it.
_Avoid_: session, tunnel, upload, snapshot.

**Commit List**:
One short row per commit (who, when, its subject line, its Commit Kind, how much it changed), read a page at a time. On the Site the rows are kept in Postgres and searched there; in a Shared Report they are searched in the browser. It names people but never shows their email addresses.
_Avoid_: log, history, search index.

**Wrapped**:
One person's year across GitHub, told as a page on the Site and a set of Cards.
_Avoid_: year in review, stats, recap.

**Moment**:
One event in the project's life, on the Overview's story line: the first commit, a release, someone who made a real share of the commits joining or leaving, the busiest day, the biggest clean-up, a quiet stretch, a change of main language.
_Avoid_: event, milestone.

**Code window**:
A window that floats over any screen of a repository to read its files at the Build's head: a file tree, tabs, a file's story (born, commits, last change, Staleness, who holds it, its share of fixes), its History and Insights. It opens from any link to a file, and the address says when it is open.
_Avoid_: code tab, file viewer, explorer.

**Universe**:
The repository's whole default-branch history as a map to explore: one hex for every file the default branch ever had, laid out by folder, rising from the sea when a file is born and sinking when it is deleted, its foundations left under shallow water, replayed by Main Arrival and coloured by who holds it, by role, by Staleness or by language. It is made from the Atlas.
_Avoid_: galaxy, 3D view, city.

**Atlas**:
The compact binary history the Universe is made from: the files, folders and people of a Pack and every commit on the Mainline by when it arrived, Merge Commits left out. The Builder makes it once per Pack, from rows the Build writes beside it, and stores it before the Pack is published; the Site only sends it, and makes it itself only for a Pack the Builder did not.
_Avoid_: payload, snapshot, graph.

**Branch state**:
What a branch other than the default one is doing at the Build: In flight (an open pull request, or a commit within 30 days), Waiting (no open pull request, a commit 30 to 90 days old), Abandoned (older still), or Merged (the default branch already holds its work, by merge, squash or rebase, so it is safe to delete). A Bot's branches are left out of the open ones.
_Avoid_: stale branch, active branch, dead branch.

**Version line**:
The tags a repository named only by a version (`v19.1.0`, `15.2.0`) gathered by their major number: `v19.x`, `v15.x`, `v0.x`. Tags named by a prefix before the version (`ignore-0.4.3`) are a family of their own. A line's usual gap is the middle of the gaps between its newest days with a release, counting tags made on one day once.
_Avoid_: release train, release family.

**Size bucket**:
How large a pull request is by the lines it added and removed together: XS under 10, S under 50, M under 250, L under 1,000, XL beyond.
_Avoid_: T-shirt size, diff size.

**Idle**:
An open pull request with no update on GitHub for 90 days or more.
_Avoid_: stale pull request, abandoned.

### Where it runs

**Site**:
The hosted website, for people signed in: Profiles, any public GitHub repository's Report, a person's Connected Repositories, Versus and Wrapped. Cards, Shared Reports and shared Proof of Work open without signing in. The Landing page is not part of it.
_Avoid_: dashboard, cloud, platform, web app.

**Landing page**:
The public page that says what commitscape is and leads to signing in: a static page apart from the Site, holding no data. Its Cards are the Site's.
_Avoid_: home page, marketing site.

**Repo State**:
What the Builder keeps of a repository between its Builds so the next one reads only what is new: the engine cache, which holds its Index, the Lines Changed already counted and its HEAD's files. It lives on the Builder's disk for days and, sealed with a key only the Builder has, in R2 for months; a Build whose disk lost it brings it back from R2, and only one without either reads the whole history again.
_Avoid_: cache (the folder it lives in), snapshot, checkpoint.

**Builder**:
What reads a repository's history for the Site: it clones the repository, runs the same engine the CLI runs, loads the Stored Index into Postgres and stores the Pack in R2. The Site never runs git.
_Avoid_: worker, backend, crawler.

**Build**:
One run of the Builder for one repository, from clone to published Pack, in two phases at once: a clone without old file contents gives a Report without Lines Changed, shown at once, while a full clone counts them, the Mainline first, and replaces it. Quiet Builds that follow count the lines left. A repository's Report is rebuilt when someone asks for it and it is more than a day old, or after a push where commitscape's GitHub App is installed. A Build whose Report is whole (every line counted, built within a week) ends at once when the default branch's head has not moved since, and the Report counts as current from then. A seed repository is built again when its head moved and someone viewed it since its last Build, and at least weekly.
_Avoid_: job, scan, analysis, refresh.

**Engine service**:
What answers the Site's questions about a repository from its Pack: every screen of its Report for any Window, the Code window, Commits under a folder and the Universe's rows. Only the Site asks it, over a private network, and like the Site it never reads git.
_Avoid_: API, backend, server, engine (the engine is the code that reads git, wherever it runs).

**Connected Repository**:
A repository someone let the Site read by choosing it in commitscape's GitHub App. Its Report is shown only to people who can see the repository on GitHub.
_Avoid_: linked repo, imported repo, private repo.

### People

**Profile**:
Everything commitscape shows about one GitHub login: their totals, their Archetype and Achievements, and the per-project breakdown. GitHub's facts show at once; the engine's numbers stream in when their Builds finish. Private work appears only as totals unless its person opts in.
_Avoid_: account, user page, dashboard.

**Hidden**:
Said of a Profile whose person chose to stay out of comparisons: it appears in no Versus or other person's Standings.
_Avoid_: private profile, opted out.

**Surviving Lines**:
The lines at a repository's head that blame attributes to a person, passing through Bulk Commits and ignored revisions, leaving out Generated Files, Prose Files and files over a megabyte (ADR-0022). Passing through gives a changed line to the commit before only when the two are the same once whitespace is removed; any other line a reformat changed stays with the reformat. Counted per person on request; "not counted" when over its time budget, never an estimate.
_Avoid_: lines owned, code alive, impact.

**Survival**:
A person's Surviving Lines as a share of the lines they added in that repository (their Lines Changed). Shown only when both are known and it is at most 100%: an import left out of Lines Changed as a Bulk Commit can keep more lines than were counted as added.
_Avoid_: retention, survival rate, code quality.

**Standing**:
Where a person stands among a repository's people in one view, counted from the top; people who tie share the higher place. **Standings** are every person's Standing side by side, view by view, never combined into a score. A private repository's Standings are shown only to people who can see it.
_Avoid_: score, rating, leaderboard position.

**Proof of Work**:
What a person shipped in a chosen period, grouped by repository and month, with links: merged pull requests and commits. Shared as a link or downloaded as Markdown or PDF.
_Avoid_: report (that is the Report), timesheet, invoice.

**Versus**:
Two Profiles side by side, with a winner for each view and no overall winner.
_Avoid_: battle, duel, comparison score.

**Archetype**:
A label for how a person works, from a written rule over their numbers, shown with its rule. Nobody under 50 contributions has one. The rules are tried in this order, and the first that fits is theirs (the others show as "also"):
- **Reviewer**: gave more reviews than they opened pull requests, and at least 20 reviews.
- **Janitor**: removed more lines than they added in their merged pull requests, and at least 1,000 lines.
- **Firefighter**: at least half of their merged pull requests, and 10 or more, are fixes: titled fix, hotfix or bugfix, or a conventional fix:.
- **Night Owl**: at least 40% of their newest 100 commits, 30 or more read, were made between 22:00 and 04:59 on the commit's own clock.
- **Polyglot**: committed in five or more languages, each at least 5% of their commits, by the main language of each repository.
- **Weekend Warrior**: at least 40% of their active days in the last year fell on a Saturday or Sunday, with 30 or more active days.
- **Marathoner**: a streak of 30 days or more in a row with a contribution.
- **Builder**: merged 25 or more pull requests, adding at least twice the lines they removed.
_Avoid_: personality, type, persona.

**Achievement**:
A milestone a person reached, from a written rule, shown with the day it was reached when that is known. Each has a Card. The set:
- **Merged into a 10k-star repository**: a pull request of theirs merged into a repository with 10,000 stars or more, as it has now.
- **100** and **1,000 pull requests merged**.
- **100** and **1,000 reviews** of others' pull requests.
- **Removed 10k lines in one pull request**: a merged pull request of theirs that removed 10,000 lines or more.
- **A 30-day** and **a 100-day streak** of contributions.
- **10,000 lines still running**: Surviving Lines at the heads of the repositories commitscape has read.
- **A line that has survived five years**: a line of theirs still at a repository's head, from a commit authored five years ago or more.
_Avoid_: badge, trophy.
