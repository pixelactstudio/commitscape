import { sql } from "drizzle-orm";
import { bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, serial, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { BuildStats, Meta } from "@commitscape/data";

const seconds = (name: string) => bigint(name, { mode: "number" });

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  login: text("login"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_user_id").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);

export const repositories = pgTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    githubId: bigint("github_id", { mode: "number" }),
    isPrivate: boolean("private").notNull().default(false),
    status: text("status").notNull().default("ok"),
    facts: text("facts"),
    factsAt: seconds("facts_at"),
    sizeKb: integer("size_kb"),
    reportKey: text("report_key"),
    reportAt: seconds("report_at"),
    reportBytes: integer("report_bytes"),
    reportLines: boolean("report_lines"),
    viewedAt: seconds("viewed_at"),
    checkedAt: seconds("checked_at"),
    installationId: bigint("installation_id", { mode: "number" }),
    connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
    seed: boolean("seed").notNull().default(false),
    language: text("language"),
    stars: integer("stars"),
    busFactor: integer("bus_factor"),
    maintainers: integer("maintainers"),
    commits30d: integer("commits_30d"),
    codeLines: integer("code_lines"),
    pullsAt: text("pulls_at"),
    pullsReadAt: seconds("pulls_read_at"),
    pullsCursor: text("pulls_cursor"),
    pullsMark: text("pulls_mark"),
    pullsVersion: integer("pulls_version").notNull().default(0),
    indexId: integer("index_id"),
    reportMeta: jsonb("report_meta").$type<Meta>(),
    reportStats: jsonb("report_stats").$type<BuildStats>(),
  },
  (t) => [index("repositories_installation").on(t.installationId), index("repositories_seed").on(t.seed, t.reportAt), index("repositories_github_id").on(t.githubId)],
);

export const repoNames = pgTable(
  "repo_names",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    at: seconds("at").notNull(),
  },
  (t) => [index("repo_names_repo").on(t.repoId)],
);

export const builds = pgTable(
  "builds",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    step: text("step"),
    reason: text("reason"),
    detail: text("detail"),
    seconds: integer("seconds"),
    partial: boolean("partial"),
    requestedAt: seconds("requested_at").notNull(),
    startedAt: seconds("started_at"),
    finishedAt: seconds("finished_at"),
  },
  (t) => [index("builds_repo_requested").on(t.repoId, t.requestedAt), index("builds_state").on(t.state)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  until: seconds("until").notNull(),
});

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    bytes: integer("bytes").notNull(),
    createdAt: seconds("created_at").notNull(),
    expiresAt: seconds("expires_at").notNull(),
    deleteHash: text("delete_hash").notNull(),
    uploadHash: text("upload_hash"),
    uploaded: boolean("uploaded").notNull().default(false),
  },
  (t) => [index("shares_expires").on(t.expiresAt)],
);

export const access = pgTable(
  "access",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    repoId: text("repo_id").notNull(),
    allowed: boolean("allowed").notNull(),
    until: seconds("until").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.repoId] })],
);

export const repoPeople = pgTable(
  "repo_people",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    personId: integer("person_id").notNull(),
    name: text("name").notNull(),
    login: text("login"),
    commits: integer("commits").notNull(),
    linesAdded: integer("lines_added"),
    linesRemoved: integer("lines_removed"),
    first: seconds("first"),
    last: seconds("last"),
    reportKey: text("report_key").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.personId] }), index("repo_people_lower_login").on(sql`lower(${t.login})`)],
);

export const githubCache = pgTable(
  "github_cache",
  {
    key: text("key").primaryKey(),
    etag: text("etag"),
    status: integer("status").notNull(),
    body: text("body"),
    fetchedAt: seconds("fetched_at").notNull(),
    until: seconds("until").notNull(),
  },
  (t) => [index("github_cache_until").on(t.until)],
);

export const profiles = pgTable(
  "profiles",
  {
    login: text("login").notNull(),
    scope: text("scope").notNull(),
    githubId: bigint("github_id", { mode: "number" }),
    identity: text("identity").notNull(),
    identityAt: seconds("identity_at").notNull(),
    data: text("data"),
    raw: text("raw"),
    fetchedAt: seconds("fetched_at"),
  },
  (t) => [primaryKey({ columns: [t.login, t.scope] }), index("profiles_github_id").on(t.githubId)],
);

export const surviving = pgTable(
  "surviving",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    personId: integer("person_id").notNull(),
    status: text("status").notNull(),
    lines: integer("lines"),
    added: integer("added"),
    files: integer("files"),
    seconds: real("seconds"),
    head: text("head"),
    oldest: seconds("oldest"),
    askedAt: seconds("asked_at").notNull(),
    countedAt: seconds("counted_at"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.reportKey, t.personId] }), index("surviving_status").on(t.status, t.askedAt)],
);

export type PullLabel = { name: string; colour: string };

export const pullRequests = pgTable(
  "pull_requests",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    author: text("author"),
    state: text("state").notNull(),
    title: text("title").notNull(),
    createdAt: seconds("created_at").notNull(),
    mergedAt: seconds("merged_at"),
    updatedAt: seconds("updated_at").notNull(),
    additions: integer("additions").notNull(),
    deletions: integer("deletions").notNull(),
    headRef: text("head_ref"),
    closedAt: seconds("closed_at"),
    mergedBy: text("merged_by"),
    baseRef: text("base_ref"),
    draft: boolean("draft"),
    changedFiles: integer("changed_files"),
    commits: integer("commits"),
    headOwner: text("head_owner"),
    fromFork: boolean("from_fork"),
    labels: jsonb("labels").$type<PullLabel[]>(),
    reviewDecision: text("review_decision"),
    mergeCommit: text("merge_commit"),
    comments: integer("comments"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] }), index("pull_requests_head").on(t.repoId, t.headRef)],
);

export const pullReviews = pgTable(
  "pull_reviews",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    reviewer: text("reviewer").notNull(),
    reviews: integer("reviews").notNull(),
    firstAt: seconds("first_at").notNull(),
    lastAt: seconds("last_at"),
    state: text("state"),
    approvedAt: seconds("approved_at"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number, t.reviewer] })],
);

export const people = pgTable(
  "people",
  {
    login: text("login").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    hidden: boolean("hidden").notNull().default(false),
    namePrivate: boolean("name_private").notNull().default(false),
    updatedAt: seconds("updated_at").notNull(),
  },
  (t) => [index("people_user").on(t.userId)],
);

export const proofs = pgTable(
  "proofs",
  {
    id: text("id").primaryKey(),
    login: text("login").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    data: text("data").notNull(),
    createdAt: seconds("created_at").notNull(),
  },
  (t) => [index("proofs_login").on(t.login)],
);

export const lentTokens = pgTable("lent_tokens", {
  repoId: text("repo_id")
    .primaryKey()
    .references(() => repositories.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  until: seconds("until").notNull(),
});

export const repoEvents = pgTable(
  "repo_events",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    actor: text("actor"),
    title: text("title"),
    url: text("url"),
    count: integer("count"),
    at: seconds("at").notNull(),
  },
  (t) => [index("repo_events_repo_at").on(t.repoId, t.at)],
);

export const privateWork = pgTable(
  "private_work",
  {
    login: text("login").notNull(),
    repo: text("repo").notNull(),
    show: text("show").notNull(),
    updatedAt: seconds("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.login, t.repo] })],
);

export const repoGit = pgTable("repo_git", {
  repoId: text("repo_id")
    .primaryKey()
    .references(() => repositories.id, { onDelete: "cascade" }),
  prefix: text("prefix").notNull(),
  buildId: text("build_id").notNull(),
  builtAt: seconds("built_at").notNull(),
  head: text("head").notNull(),
  branch: text("branch").notNull(),
  branches: integer("branches").notNull().default(0),
  tags: integer("tags").notNull().default(0),
  files: integer("files").notNull().default(0),
  stored: integer("stored").notNull().default(0),
  pulls: integer("pulls").notNull().default(0),
  bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  logged: integer("logged").notNull().default(0),
  complete: boolean("complete").notNull().default(false),
  seconds: real("seconds").notNull().default(0),
  steps: text("steps").notNull().default("[]"),
  branchesTotal: integer("branches_total").notNull().default(0),
  tagsTotal: integer("tags_total").notNull().default(0),
  inferred: boolean("inferred").notNull().default(false),
});

const repoRef = () =>
  text("repo_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" });

export const repoBlobs = pgTable(
  "repo_blobs",
  {
    repoId: repoRef(),
    sha: text("sha").notNull(),
    lines: integer("lines").notNull(),
    binary: boolean("binary").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.sha] })],
);

export const repoBranches = pgTable(
  "repo_branches",
  {
    repoId: repoRef(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    sha: text("sha").notNull(),
    at: seconds("at").notNull(),
    author: text("author").notNull(),
    login: text("login"),
    subject: text("subject").notNull(),
    ahead: integer("ahead").notNull(),
    behind: integer("behind").notNull(),
    base: text("base").notNull(),
    baseAt: seconds("base_at").notNull(),
    merged: boolean("merged").notNull(),
    squashed: boolean("squashed").notNull().default(false),
    parent: text("parent"),
    shared: integer("shared").notNull(),
    bot: boolean("bot").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.position] })],
);

export const repoBranchDetails = pgTable(
  "repo_branch_details",
  {
    repoId: repoRef(),
    position: integer("position").notNull(),
    against: text("against").notNull(),
    commits: jsonb("commits").$type<{ sha: string; subject: string; author: string; at: number }[]>().notNull(),
    commitsTotal: integer("commits_total").notNull(),
    files: jsonb("files").$type<{ path: string; added: number | null; removed: number | null }[]>().notNull(),
    filesTotal: integer("files_total").notNull(),
    added: integer("added").notNull(),
    removed: integer("removed").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.position] })],
);

export const repoTags = pgTable(
  "repo_tags",
  {
    repoId: repoRef(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    sha: text("sha").notNull(),
    at: seconds("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.position] })],
);

export type IndexOptions = { max_changeset_size: number; coupling_support: number; ownership_min_commits: number };

export type IndexSnapshot = {
  commits: number;
  merges: number;
  oldest: number | null;
  newest: number | null;
  languages: { name: string; lines: number }[];
  code_age: { year: number; quarter: number; lines: number }[];
  suspects: number[][];
  releases: [string, number][];
  release_shas?: Record<string, string>;
};

export const repoStates = pgTable(
  "repo_states",
  {
    repoId: text("repo_id").primaryKey(),
    savedAt: seconds("saved_at").notNull(),
    usedAt: seconds("used_at").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
  },
  (t) => [index("repo_states_used").on(t.usedAt)],
);

export const storedIndexes = pgTable(
  "stored_indexes",
  {
    id: serial("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    lineage: text("lineage").notNull(),
    kept: boolean("kept").notNull(),
    state: text("state").notNull(),
    head: text("head"),
    frontier: text("frontier").array().notNull().default([]),
    lines: boolean("lines").notNull(),
    linesLeft: integer("lines_left"),
    commits: integer("commits").notNull().default(0),
    builtAt: seconds("built_at").notNull(),
    loadedAt: seconds("loaded_at"),
    anchor: seconds("anchor").notNull().default(0),
    options: jsonb("options").$type<IndexOptions>().notNull().default({ max_changeset_size: 50, coupling_support: 5, ownership_min_commits: 10 }),
    snapshot: jsonb("snapshot").$type<IndexSnapshot>(),
    pack: text("pack"),
    mark: text("mark"),
    buildFormat: integer("build_format"),
  },
  (t) => [index("stored_indexes_repo").on(t.repoId)],
);

const si = () => integer("si").notNull();

export const indexCommits = pgTable(
  "index_commits",
  {
    si: si(),
    sha: bytea("sha").notNull(),
    at: seconds("at").notNull(),
    offset: smallint("offset").notNull(),
    authorDelta: integer("author_delta").notNull(),
    signature: integer("signature").notNull(),
    kind: smallint("kind").notNull(),
    flags: smallint("flags").notNull(),
    arrival: seconds("arrival"),
    subject: text("subject").notNull(),
    files: integer("files").array().notNull(),
    changes: smallint("changes").array().notNull(),
    added: integer("added").array(),
    removed: integer("removed").array(),
  },
  (t) => [primaryKey({ columns: [t.si, t.sha] }), index("index_commits_at").on(t.si, t.at), index("index_commits_signature").on(t.si, t.signature, t.at)],
);

export const indexCommitLines = pgTable(
  "index_commit_lines",
  {
    si: si(),
    sha: bytea("sha").notNull(),
    added: integer("added").notNull(),
    removed: integer("removed").notNull(),
  },
  (t) => [primaryKey({ columns: [t.si, t.sha] })],
);

export const indexFiles = pgTable(
  "index_files",
  {
    si: si(),
    file: integer("file").notNull(),
    path: text("path").notNull(),
    folder: integer("folder").notNull(),
    born: seconds("born").notNull(),
    last: seconds("last").notNull(),
    alive: boolean("alive").notNull(),
    role: smallint("role").notNull().default(0),
    language: text("language"),
    guessedGenerated: boolean("guessed_generated").notNull().default(false),
    lockfile: boolean("lockfile").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.si, t.file] }), index("index_files_folder").on(t.si, t.folder)],
);

export const indexFilePaths = pgTable(
  "index_file_paths",
  {
    si: si(),
    file: integer("file").notNull(),
    path: text("path").notNull(),
  },
  (t) => [primaryKey({ columns: [t.si, t.file, t.path] })],
);

export const indexFolders = pgTable(
  "index_folders",
  {
    si: si(),
    id: integer("id").notNull(),
    path: text("path").notNull(),
    parent: integer("parent"),
    depth: smallint("depth").notNull(),
  },
  (t) => [primaryKey({ columns: [t.si, t.id] }), uniqueIndex("index_folders_path").on(t.si, t.path), index("index_folders_parent").on(t.si, t.parent)],
);

export const indexPersons = pgTable(
  "index_persons",
  {
    si: si(),
    person: integer("person").notNull(),
    traits: smallint("traits").notNull(),
    identities: integer("identities").notNull(),
    commits: integer("commits").notNull(),
  },
  (t) => [primaryKey({ columns: [t.si, t.person] })],
);

export const indexPeople = pgTable(
  "index_people",
  {
    si: si(),
    signature: integer("signature").notNull(),
    name: text("name").notNull(),
    person: integer("person"),
    personName: text("person_name"),
    colour: smallint("colour"),
    login: text("login"),
    bot: boolean("bot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.si, t.signature] }), index("index_people_person").on(t.si, t.person)],
);

export const indexHeadFiles = pgTable(
  "index_head_files",
  {
    si: si(),
    file: integer("file").notNull(),
    blob: bytea("blob").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    lines: integer("lines").notNull(),
    class: text("class").notNull(),
    indentLevels: integer("indent_levels").notNull(),
    indentMean: real("indent_mean").notNull(),
    indentStddev: real("indent_stddev").notNull(),
  },
  (t) => [primaryKey({ columns: [t.si, t.file] })],
);
