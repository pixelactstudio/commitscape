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
 * Bumped whenever anything above, or the people, changes: data asked
 * for with an older one is out of date.
 */
generation: number, };

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
people: Array<PersonCommits>, };

export type Totals = { commits: number, merges: number, people: number, files: number, code_files: number, code_lines: number, prose_lines: number, first_commit: number | null, last_commit: number | null, };

export type Language = { name: string, lines: number, };

export type PersonCommits = { 
/**
 * Stable while the people are: changes when a merge is undone.
 */
id: number, name: string, commits: number, };
