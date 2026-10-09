import { bigint, boolean, index, integer, pgTable, primaryKey, real, smallint, text, timestamp } from "drizzle-orm/pg-core";

const seconds = (name: string) => bigint(name, { mode: "number" });

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
    installationId: bigint("installation_id", { mode: "number" }),
    connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
    seed: boolean("seed").notNull().default(false),
    language: text("language"),
    stars: integer("stars"),
    busFactor: integer("bus_factor"),
    maintainers: integer("maintainers"),
    commits30d: integer("commits_30d"),
    people30d: integer("people_30d"),
    codeLines: integer("code_lines"),
    untouched5y: integer("untouched_5y"),
    answered: integer("answered"),
    answerHours: real("answer_hours"),
    pullsAt: text("pulls_at"),
    pullsReadAt: seconds("pulls_read_at"),
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
  (t) => [primaryKey({ columns: [t.repoId, t.personId] }), index("repo_people_login").on(t.login)],
);

export const commits = pgTable(
  "commits",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    seq: integer("seq").notNull(),
    sha: text("sha").notNull(),
    at: seconds("at").notNull(),
    offset: smallint("offset").notNull(),
    personId: integer("person_id").notNull(),
    subject: text("subject").notNull(),
    kind: smallint("kind").notNull(),
    merge: boolean("merge").notNull(),
    files: integer("files").notNull(),
    added: integer("added"),
    removed: integer("removed"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.reportKey, t.seq] }), index("commits_person").on(t.repoId, t.reportKey, t.personId, t.seq), index("commits_at").on(t.repoId, t.reportKey, t.at)],
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
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] }), index("pull_requests_author").on(t.author, t.mergedAt)],
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
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number, t.reviewer] }), index("pull_reviews_reviewer").on(t.reviewer, t.firstAt)],
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

export const rivals = pgTable(
  "rivals",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rival: text("rival").notNull(),
    createdAt: seconds("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.rival] })],
);

const membership = {
  login: text("login").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  state: text("state").notNull(),
  invitedBy: text("invited_by").notNull(),
  invitedAt: seconds("invited_at").notNull(),
  answeredAt: seconds("answered_at"),
};

export const races = pgTable("races", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  from: text("from").notNull(),
  to: text("to").notNull(),
  createdAt: seconds("created_at").notNull(),
  standings: text("standings"),
  standingsAt: seconds("standings_at"),
});

export const raceMembers = pgTable(
  "race_members",
  {
    raceId: text("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    ...membership,
  },
  (t) => [primaryKey({ columns: [t.raceId, t.login] }), index("race_members_login").on(t.login)],
);

export const crews = pgTable("crews", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: seconds("created_at").notNull(),
});

export const crewMembers = pgTable(
  "crew_members",
  {
    crewId: text("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    ...membership,
  },
  (t) => [primaryKey({ columns: [t.crewId, t.login] }), index("crew_members_login").on(t.login)],
);

export const seasonStandings = pgTable(
  "season_standings",
  {
    crewId: text("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    season: text("season").notNull(),
    data: text("data").notNull(),
    at: seconds("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.season] })],
);
