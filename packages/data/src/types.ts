// Generated from crates/commitscape-report/src/api.rs by its tests. Do not edit.

export type Meta = { name: string, windows: Array<string>, window: string, anchor: number, history: string, lines: string, github: string, github_history: string, avatars: boolean, };

export type PersonRef = { id: number, name: string, colour: number | null, login: string | null, };

export type Overview = { window: string, totals: Totals, languages: Array<Language>, commits: number, active_days: number, first_day: number, days: Array<number>, people: Array<PersonCommits>, timeline: Array<TimelineMoment>, facts: Array<Fact>, worth: Array<Worth>, code_age: Array<QuarterLines>, };

export type Totals = { commits: number, merges: number, people: number, files: number, code_files: number, code_lines: number, prose_lines: number, first_commit: number | null, last_commit: number | null, };

export type Language = { name: string, lines: number, };

export type PersonCommits = { person: PersonRef, commits: number, };

export type TimelineMoment = { kind: string, time: number, person: PersonRef | null, name: string | null, count: number | null, until: number | null, from: string | null, to: string | null, };

export type Fact = { kind: string, value: number, other: number | null, subject: string | null, time: number | null, };

export type Worth = { kind: string, paths: Array<string>, person: PersonRef | null, value: number, of: number | null, };

export type QuarterLines = { year: number, quarter: number, lines: number, };

export type Activity = { window: string, first_day: number, people: Array<PersonRef>, days: Array<Array<number>>, releases: Array<Release>, week: Array<Array<number>>, kinds: Array<KindCount>, unclassified: number, github: GitHubWeeks | null, };

export type Release = { name: string, time: number, };

export type KindCount = { kind: string, commits: number, };

export type GitHubWeeks = { first_week: number, opened: Array<number>, merged: Array<number>, issues_opened: Array<number>, issues_closed: Array<number>, complete: boolean, };

export type People = { window: string, people: Array<PersonRow>, bots: Array<PersonCommits>, suspects: Array<Array<PersonRef>>, };

export type PersonRow = { person: PersonRef, commits: number, active_days: number, first: number, last: number, lines_added: number | null, lines_removed: number | null, areas: number, prs_merged: number | null, reviews: number | null, hours_to_merge: number | null, identities: number, };

export type Person = { person: PersonRef, email: string, row: PersonRow | null, addresses: Array<Address>, traits: Array<string>, mailmap: string, first_day: number, days: Array<number>, week: Array<Array<number>>, longest_streak: number | null, work: Array<PathCount>, areas: Array<Area>, };

export type Address = { email: string, commits: number, };

export type PathCount = { path: string, commits: number, };

export type Area = { folder: string, theirs: number, all: number, };

export type MapLevel = { path: string, children: Array<MapBlock>, };

export type MapBlock = { name: string, path: string, file: boolean, lines: number, files: number, churn: number, last_touched: number, owner: PersonRef | null, inside: Array<MapBlock>, };

export type Risk = { window: string, hotspots: Array<HotspotRow>, files: Array<FilePoint>, groups: Array<GroupRow>, silos: Array<SiloRow>, };

export type HotspotRow = { path: string, churn: number, nesting: number, churn_place: number, churn_of: number, nesting_place: number, nesting_of: number, score: number, };

export type FilePoint = { path: string, churn: number, nesting: number, };

export type GroupRow = { paths: Array<string>, together: number, cross_directory: boolean, };

export type SiloRow = { folder: string, holder: PersonRef, commits: number, successor: PersonCommits | null, };

export type File = { path: string, lines: number | null, class: string | null, churn: number, first_seen: number | null, last_touched: number | null, owners: Array<PersonCommits>, coupled: Array<Coupled>, commits: Array<CommitLine>, };

export type Coupled = { path: string, together: number, degree: number, };

export type CommitLine = { id: string, time: number, person: PersonRef | null, };

export type WrappedYear = { title: string, name: string, year: number, looked_in: number, commits: number, active_days: number, repositories: Array<RepoCommits>, lines_added: number | null, lines_removed: number | null, languages: Array<Language>, busiest_day: number | null, busiest_commits: number, streak_days: number, streak_from: number | null, night: number, hours: Array<number>, first_day: number, days: Array<number>, card: string, };

export type RepoCommits = { name: string, commits: number, };

export type CommitList = { link: string | null, lines: boolean, kinds: Array<string>, people: Array<CommitPerson>, ids: Array<string>, times: Array<number>, offsets: Array<number>, person: Array<number>, subjects: Array<string>, kind: Array<number>, merge: Array<boolean>, files: Array<number>, added: Array<number | null>, removed: Array<number | null>, };

export type CommitPerson = { person: PersonRef, emails: Array<string>, };

export type Stats = { commits: number, people: number, bus_factor: number | null, maintainers: number, commits_30d: number, people_30d: number, code_lines: number, untouched_5y: number, };
