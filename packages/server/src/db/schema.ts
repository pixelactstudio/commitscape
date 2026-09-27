import { bigint, boolean, index, integer, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

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
    cardKey: text("card_key"),
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
  },
  (t) => [index("repositories_installation").on(t.installationId), index("repositories_seed").on(t.seed, t.reportAt)],
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
