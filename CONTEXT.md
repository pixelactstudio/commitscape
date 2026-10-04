# commitscape

A tool that shows a developer what they have built, how they stand next to the people they work with, and gives them something to share about it (ADR-0020). It reads git history, locally or on the Site, and GitHub's API. Every number says what it counts, and none is a guess.

## Language

### What we measure

**Churn**:
The number of commits touching a file within the active Window. Merge Commits and Bulk Commits are excluded.
_Avoid_: activity, edits, changes, revisions.

**Complexity Proxy**:
A language-agnostic stand-in for structural complexity, derived from the indentation structure of a file at HEAD. Never called "complexity" unqualified — the qualifier is the honesty.
_Avoid_: complexity, cyclomatic complexity, difficulty.

**Hotspot**:
A file that is both heavily changed and structurally complex, scored as the product of its Churn percentile and its Complexity Proxy percentile: where it ranks among the files that changed in the Window, times where it ranks among all the files people wrote. The central finding of the tool. Shown to people as Ranks, never as percentiles.
_Avoid_: problem file, risk file, tech debt.

**Rank**:
Where a file stands among the files it was compared with, counted from the top: the 2nd most changed of 40 files. Files that tie share the higher place.
_Avoid_: percentile, p90, score.

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
Someone who made at least three commits in the last 90 days: who keeps a project going now, as `health` counts them. Not a role anyone was given.
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

**Changeset**:
The set of files a single commit touched, along with how each was touched. The Index stores Changesets rather than aggregates, which is what makes the Window changeable without re-reading the repository. A Merge Commit's Changeset holds only the files it changed relative to every parent, such as a conflict resolution, never the branch it merged.
_Avoid_: diff, commit contents, file list.

**Lines Changed**:
The lines a change added and removed, counted as `git diff --numstat` counts them by a pass that runs after the first screen. A person's Lines Changed leave out Merge Commits, Bulk Commits, commits named in `.git-blame-ignore-revs`, lockfiles, and Generated Files. A change to a binary file, or to a file over a megabyte, is not counted, which is shown as such and never as zero. One of several views of what a person did; never combined with the others into a score.
_Avoid_: LOC, churn, impact, productivity.

**Merge Commit**:
A commit with more than one parent. Its Changeset is usually empty. Excluded from Churn, Change Coupling and Ownership.
_Avoid_: merge, pull request.

**Bulk Commit**:
A commit touching more than a configured number of files. Excluded from Churn, Change Coupling and Ownership because reformats, lockfile regenerations, and vendored drops would otherwise dominate every ranking.
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
A file a person wrote to be read rather than run: Markdown, reStructuredText, AsciiDoc, plain text. Counted in Churn, Ownership and Change Coupling, but never a Hotspot or among the largest files, since the Complexity Proxy and size measure code.
_Avoid_: docs, documentation file, text file.

**Generated File**:
A tracked file that no person wrote and nobody should be asked to look at — lockfiles, minified output, ORM snapshots, vendored trees. Excluded from every ranking.
_Avoid_: artifact, build output, ignored file.

### What we produce

**Panel**:
One screen of the interface, computed from the Index over the active Window. A Panel whose numbers cannot be entered should have been a command-line flag instead.
_Avoid_: view, screen, tab, page.

**Overview**:
The Panel the interface opens on: the repository's story at a glance, then what is worth a look. Its size, age and languages, how the Window's commits fell over time, who wrote them, facts worth sharing, and the findings that change what you do next: the directories one person holds, the top Hotspot, the files in different directories that change together, how much has gone untouched for a year, and the people who may be one person. Each finding can be entered.
_Avoid_: dashboard, home, summary.

**Map**:
The code at HEAD drawn as nested rectangles, each as large as its lines of code, coloured by Churn, by Staleness or by who holds it. Entered one directory at a time.
_Avoid_: treemap, tree view, file browser.

**Card**:
One of a set of images made for sharing, about a person, a person in a repository, a Versus, a Race, a Season or a repository: one React component, shown on the Site, embedded in a README as animated SVG, and used as a PNG link preview (ADR-0021). The tool's growth mechanism, treated as a product feature.
_Avoid_: summary image, badge, widget (and report, which is the Report).

**Embed**:
A Card placed in a README or elsewhere by its address, served from a stored copy that never waits on GitHub.
_Avoid_: badge, widget, stats image.

**Report**:
Every answer the browser interface needs, for every Window, written ahead of time: it needs no server and answers only what it was written with. Kept as one file, stored on the Site for a repository, or uploaded as a Shared Report.
_Avoid_: export, snapshot, dump.

**Shared Report**:
A Report someone uploaded from their own machine so another browser can open it, locked with a key that exists only in its link. The Site stores it without being able to read it; it expires after hours, and anyone with the link can delete it.
_Avoid_: session, tunnel, upload, snapshot.

**Commit List**:
One short row per commit (who, when, its subject line, its Commit Kind, how much it changed), searched in the browser. On the Site it names people but never shows their email addresses.
_Avoid_: log, history, search index.

**Wrapped**:
One person's year, told as a page and a set of Cards: across GitHub on the Site, or across every repository in a folder in the CLI, under every address they commit with.
_Avoid_: year in review, stats, recap.

**Moment**:
One event in the project's life, on the Overview's story line: the first commit, a release, someone who made a real share of the commits joining or leaving, the busiest day, the biggest clean-up, a quiet stretch, a change of main language.
_Avoid_: event, milestone.

### Where it runs

**Site**:
The hosted website: the landing page, any public GitHub repository's Report, Shared Reports, a signed-in person's Connected Repositories, and the Leaderboards. It shows the same screens as the local browser interface.
_Avoid_: dashboard, cloud, platform, web app.

**Builder**:
What reads a repository's history for the Site and writes its Report: the same engine the CLI runs, on the owner's server, one Build at a time.
_Avoid_: worker, backend, crawler.

**Build**:
One run of the Builder for one repository, from clone to stored Report. A repository's Report is rebuilt when someone asks for it and it is more than a day old.
_Avoid_: job, scan, analysis, refresh.

**Connected Repository**:
A repository someone let the Site read by choosing it in commitscape's GitHub App. Its Report is shown only to people who can see the repository on GitHub.
_Avoid_: linked repo, imported repo, private repo.

**Leaderboard**:
A ranking of repositories, or of people who haven't hidden, by one view at a time, such as Bus Factor or merged pull requests this Season. It says when it was built and from how many repositories.
_Avoid_: score, top developers.

### People

**Profile**:
Everything commitscape shows about one GitHub login: their totals, their Archetype and Achievements, and the per-project breakdown. GitHub's facts show at once; the engine's numbers stream in when their Builds finish. Private work appears only as totals unless its person opts in.
_Avoid_: account, user page, dashboard.

**Hidden**:
Said of a Profile whose person chose to stay out of comparisons: it appears in no Versus, Leaderboard, Race or other person's Standings.
_Avoid_: private profile, opted out.

**Surviving Lines**:
The lines at a repository's head that blame attributes to a person, passing through Bulk Commits and ignored revisions, leaving out Generated Files, Prose Files and files over a megabyte (ADR-0022). Passing through gives a changed line to the commit before only when the two are the same once whitespace is removed; any other line a reformat changed stays with the reformat. Counted per person on request; "not counted" when over its time budget, never an estimate.
_Avoid_: lines owned, code alive, impact.

**Survival**:
A person's Surviving Lines as a share of the lines they added in that repository (their Lines Changed). Shown only when both are known and it is at most 100%: an import left out of Lines Changed as a Bulk Commit can keep more lines than were counted as added.
_Avoid_: retention, survival rate, code quality.

**Standing**:
Where a person stands among a repository's people in one view, counted from the top, as Rank is for files. **Standings** are every person's Standing side by side, view by view, never combined into a score. A private repository's Standings are shown only to people who can see it.
_Avoid_: score, rating, leaderboard position.

**Proof of Work**:
What a person shipped in a chosen period, grouped by repository and month, with links: merged pull requests and commits. Shared as a link or downloaded as Markdown or PDF.
_Avoid_: report (that is the Report), timesheet, invoice.

**Versus**:
Two Profiles side by side, with a winner for each view and no overall winner.
_Avoid_: battle, duel, comparison score.

**Rival**:
A person someone chose to measure themselves against, whose gap shows on their own Profile.
_Avoid_: friend, follow.

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

**Season**:
One calendar month, after which Crew Standings and people Leaderboards start again.
_Avoid_: period, sprint.

**Race**:
A fixed window in which two or more people who accepted compare their Standings live, ending with a finish Card.
_Avoid_: challenge, competition, contest.

**Crew**:
A group of people who accepted an invitation to compare themselves every Season.
_Avoid_: team, group, organisation.
