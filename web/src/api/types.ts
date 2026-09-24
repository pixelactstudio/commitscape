// Generated from crates/commitscape-web/src/api.rs by its tests. Do not edit.

export type Meta = { 
/**
 * The repository's name.
 */
name: string, 
/**
 * Every Window, shortest first: `30d`, `90d`, `1y`, `all`.
 */
windows: Array<string>, 
/**
 * The Window to open on.
 */
window: string, 
/**
 * Where the Windows end: now, when the server started.
 */
anchor: number, 
/**
 * Whether all of history is loaded: `loading`, `complete`, or
 * `unavailable`.
 */
history: string, 
/**
 * The line pass: `counting`, `counted`, or `off`.
 */
lines: string, 
/**
 * GitHub: `asking`, `ready`, or why there is nothing (`unavailable:
 * <reason>`).
 */
github: string, 
/**
 * GitHub's whole history: `off`, `reading N of M`, or `complete`.
 */
github_history: string, 
/**
 * Whether a merge of identities can be undone here.
 */
can_change_people: boolean, 
/**
 * Bumped whenever anything above, or the people, changes: data asked
 * for with an older one is out of date.
 */
generation: number, };

export type PersonRef = { 
/**
 * Stable while the people are: changes when a merge is undone.
 */
id: number, name: string, 
/**
 * One of eight categorical colours, fixed by all-time commits and the
 * same on every screen; `null` for everyone else, drawn grey.
 */
colour: number | null, };

export type Overview = { window: string, totals: Totals, 
/**
 * Lines of code by language at HEAD, largest first.
 */
languages: Array<Language>, 
/**
 * The Window's commits that are not merges.
 */
commits: number, 
/**
 * Days with at least one of them.
 */
active_days: number, 
/**
 * Commits per day, from `first_day`.
 */
first_day: number, days: Array<number>, 
/**
 * Who made them, most first. Bots are left out.
 */
people: Array<PersonCommits>, 
/**
 * The project's life, oldest first.
 */
timeline: Array<TimelineMoment>, 
/**
 * Only what is unusual for this repository.
 */
facts: Array<Fact>, 
/**
 * What deserves a look.
 */
worth: Array<Worth>, 
/**
 * Lines of code at HEAD by the quarter their file appeared.
 */
code_age: Array<QuarterLines>, };

export type Totals = { commits: number, merges: number, people: number, files: number, code_files: number, code_lines: number, prose_lines: number, first_commit: number | null, last_commit: number | null, };

export type Language = { name: string, lines: number, };

export type PersonCommits = { person: PersonRef, commits: number, };

export type TimelineMoment = { 
/**
 * `first_commit`, `release`, `joined`, `left`, `busiest_day`,
 * `cleanup`, `quiet` or `language_shift`.
 */
kind: string, time: number, person: PersonRef | null, 
/**
 * A release's name.
 */
name: string | null, 
/**
 * The busiest day's commits, or a clean-up's lines removed.
 */
count: number | null, 
/**
 * When a quiet stretch ended.
 */
until: number | null, 
/**
 * A language shift's languages.
 */
from: string | null, to: string | null, };

export type Fact = { 
/**
 * `night`, `weekend`, `busiest_day`, `streak`, `fixes`,
 * `hottest_file`, `biggest_file` or `untouched`.
 */
kind: string, 
/**
 * The main number: a share in percent, days, commits or lines.
 */
value: number, 
/**
 * A second number, where there is one: a usual day's commits, the
 * features beside the fixes, all commits.
 */
other: number | null, 
/**
 * A file or a day, where the fact is about one.
 */
subject: string | null, time: number | null, };

export type Worth = { 
/**
 * `held` (a folder one person holds), `hotspot`, `pair`, `untouched`
 * or `same_person`.
 */
kind: string, 
/**
 * The folder or file, or the two files of a pair.
 */
paths: Array<string>, person: PersonRef | null, 
/**
 * A share in percent, a count of commits, or of files.
 */
value: number, of: number | null, };

export type QuarterLines = { year: number, quarter: number, lines: number, };

export type Activity = { window: string, first_day: number, 
/**
 * The five who made the most commits; everyone else is one series.
 */
people: Array<PersonRef>, 
/**
 * For each day from `first_day`, each person's commits in `people`
 * order, then everyone else's.
 */
days: Array<Array<number>>, 
/**
 * Releases in the Window: version tags, and GitHub's releases.
 */
releases: Array<Release>, 
/**
 * Commits by weekday (Monday first) and hour, on each author's clock.
 */
week: Array<Array<number>>, 
/**
 * Kinds of work, judged from the files first; empty when most commits
 * could not be told.
 */
kinds: Array<KindCount>, 
/**
 * Commits neither their files nor their message could tell.
 */
unclassified: number, 
/**
 * Pull requests and issues a week, when GitHub's history is known.
 */
github: GitHubWeeks | null, };

export type Release = { name: string, time: number, };

export type KindCount = { kind: string, commits: number, };

export type GitHubWeeks = { 
/**
 * The Monday each week starts on, as a day.
 */
first_week: number, opened: Array<number>, merged: Array<number>, issues_opened: Array<number>, issues_closed: Array<number>, 
/**
 * Whether every page of GitHub's history has been read yet.
 */
complete: boolean, };

export type People = { window: string, people: Array<PersonRow>, bots: Array<PersonCommits>, 
/**
 * Groups that may be one person, not merged.
 */
suspects: Array<Array<PersonRef>>, };

export type PersonRow = { person: PersonRef, commits: number, active_days: number, first: number, last: number, 
/**
 * `null` until lines are counted.
 */
lines_added: number | null, lines_removed: number | null, 
/**
 * Folders that depend on them alone.
 */
areas: number, 
/**
 * `null` until GitHub's history is known, or when their GitHub account
 * is not.
 */
prs_merged: number | null, reviews: number | null, 
/**
 * Hours from opening to merging, the median of their merged pull
 * requests.
 */
hours_to_merge: number | null, 
/**
 * Addresses joined into this person, 1 when none were.
 */
identities: number, };

export type Person = { person: PersonRef, email: string, row: PersonRow | null, addresses: Array<Address>, 
/**
 * `same_name`, `same_account`, `kept_apart`, `bot`.
 */
traits: Array<string>, 
/**
 * `.mailmap` lines that would make a merge permanent.
 */
mailmap: string, first_day: number, days: Array<number>, week: Array<Array<number>>, longest_streak: number | null, 
/**
 * The files they changed most.
 */
work: Array<PathCount>, 
/**
 * The folders that depend on them: their commits there, and all.
 */
areas: Array<Area>, };

export type Address = { email: string, commits: number, };

export type PathCount = { path: string, commits: number, };

export type Area = { folder: string, theirs: number, all: number, };

export type MapLevel = { path: string, children: Array<MapBlock>, };

export type MapBlock = { name: string, path: string, file: boolean, lines: number, files: number, churn: number, last_touched: number, owner: PersonRef | null, 
/**
 * Its own children, one level down, for a folder drawn nested.
 */
inside: Array<MapBlock>, };

export type Risk = { window: string, hotspots: Array<HotspotRow>, 
/**
 * Files that change often, for the scatter behind the hotspots.
 */
files: Array<FilePoint>, groups: Array<GroupRow>, silos: Array<SiloRow>, };

export type HotspotRow = { path: string, churn: number, 
/**
 * The Complexity Proxy: every line's indentation level, added up.
 */
nesting: number, churn_place: number, churn_of: number, nesting_place: number, nesting_of: number, score: number, };

export type FilePoint = { path: string, churn: number, nesting: number, };

export type GroupRow = { paths: Array<string>, together: number, cross_directory: boolean, };

export type SiloRow = { folder: string, holder: PersonRef, commits: number, successor: PersonCommits | null, };

export type File = { path: string, lines: number | null, 
/**
 * `source`, `prose`, `generated`, `vendored`, `binary`, `symlink`, or
 * `null` when it is no longer at HEAD.
 */
class: string | null, churn: number, first_seen: number | null, last_touched: number | null, owners: Array<PersonCommits>, 
/**
 * Files that change with it, most strongly coupled first.
 */
coupled: Array<Coupled>, commits: Array<CommitLine>, };

export type Coupled = { path: string, together: number, 
/**
 * Of the commits that changed either, the share that changed both.
 */
degree: number, };

export type CommitLine = { id: string, time: number, person: PersonRef | null, };

export type WrappedYear = { 
/**
 * "Dev Talan's 2026 in code", or "Your 2026 in code" when git has no
 * name for them.
 */
title: string, 
/**
 * The person, as git's configuration names them; empty when it does
 * not.
 */
name: string, year: number, 
/**
 * Repositories looked in, with a commit of theirs this year or not.
 */
looked_in: number, commits: number, active_days: number, 
/**
 * Most commits first.
 */
repositories: Array<RepoCommits>, 
/**
 * `null` when lines were not counted.
 */
lines_added: number | null, lines_removed: number | null, 
/**
 * Lines added by language, most first.
 */
languages: Array<Language>, 
/**
 * The busiest day and its commits.
 */
busiest_day: number | null, busiest_commits: number, 
/**
 * The longest streak of days with a commit, and its first day.
 */
streak_days: number, streak_from: number | null, 
/**
 * Commits between 22:00 and 05:00 on their clock.
 */
night: number, 
/**
 * Commits by hour on their clock, midnight first.
 */
hours: Array<number>, 
/**
 * Commits a day from 1 January, to the last day of the year or today.
 */
first_day: number, days: Array<number>, 
/**
 * The card, as SVG.
 */
card: string, };

export type RepoCommits = { name: string, commits: number, };
