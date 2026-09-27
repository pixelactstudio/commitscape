/**
 * What the Site keeps in D1 (ADR-0014). Reports themselves are in R2; this
 * is what points at them, and what the API needs to answer quickly. Times
 * are seconds since the epoch.
 */
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A repository on GitHub the Site has been asked about. */
export const repositories = sqliteTable("repositories", {
  /** `owner/name`, lowercased: GitHub's names ignore case. */
  id: text("id").primaryKey(),
  /** As GitHub writes them. */
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  /**
   * GitHub's own number for the repository, which stays with it through a
   * rename, a transfer or a deletion: a name later given to another
   * repository does not inherit this one's Report.
   */
  githubId: integer("github_id"),
  isPrivate: integer("private", { mode: "boolean" }).notNull().default(false),
  /** What GitHub said when last asked: `ok`, `not_found` or `private`. */
  status: text("status").notNull().default("ok"),
  /** GitHub's instant facts, as JSON, and when they were read. */
  facts: text("facts"),
  factsAt: integer("facts_at"),
  /** GitHub's size, in KB, which picks the clone (ADR-0015). */
  sizeKb: integer("size_kb"),
  /** The latest Report, in R2, and when it was built. */
  reportKey: text("report_key"),
  reportAt: integer("report_at"),
  reportBytes: integer("report_bytes"),
  /** Whether its lines were counted: not for a partial clone. */
  reportLines: integer("report_lines", { mode: "boolean" }),
  /** Its card, for social previews, and the page that names it. */
  cardKey: text("card_key"),
  pageKey: text("page_key"),
  /** When someone last looked at it: retention counts from here. */
  viewedAt: integer("viewed_at"),
  /**
   * A Connected Repository's (ADR-0017): the installation that lets the
   * Site read it, and who connected it. Its Report is shown only to people
   * GitHub says can see it, and goes when the App is removed from it.
   */
  installationId: integer("installation_id"),
  connectedBy: text("connected_by"),
  /**
   * A Leaderboard seed (IDEA.md): among the most starred in its language on
   * GitHub, built nightly within a budget. Its numbers come from its last
   * Build (the Report's `stats`, and `health`'s issue answers).
   */
  seed: integer("seed", { mode: "boolean" }).notNull().default(false),
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
});

/** One run of the Builder for one repository (ADR-0015). */
export const builds = sqliteTable(
  "builds",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    /** `queued`, `running`, `done` or `failed`. */
    state: text("state").notNull(),
    /** Where a running Build is: `reading` or `uploading`. */
    step: text("step"),
    /** Why it failed, in the Site's words: `not_found`, `private`, `too_big`, `timed_out`, `error` or `paused`. */
    reason: text("reason"),
    /** A hash of the token its uploads must carry. */
    uploadHash: text("upload_hash"),
    /** What it uploaded, before it is done. */
    reportKey: text("report_key"),
    reportBytes: integer("report_bytes"),
    cardKey: text("card_key"),
    /** How long it took, in seconds, and whether it cloned partially. */
    seconds: integer("seconds"),
    partial: integer("partial", { mode: "boolean" }),
    requestedAt: integer("requested_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  // A repository's last Build, asked on every lookup and for each night's seeds.
  (t) => [index("builds_repo_requested").on(t.repoId, t.requestedAt)],
);

/**
 * Counters for rate limits (ADR-0014): one row per action, hashed address
 * and window. Rows past `until` are removed by the Cron Trigger.
 */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  until: integer("until").notNull(),
});

/**
 * Shared Reports (ADR-0016): locked bytes in R2 the Site cannot read, and
 * here only their size, when they expire, and hashes of the tokens that
 * upload and delete them.
 */
export const shares = sqliteTable("shares", {
  /** 128 random bits, base64url. It opens nothing without the key. */
  id: text("id").primaryKey(),
  bytes: integer("bytes").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  /** SHA-256 of the Delete Token, derived from the key the Site never sees. */
  deleteHash: text("delete_hash").notNull(),
  /** SHA-256 of the one-time upload token; cleared once used. */
  uploadHash: text("upload_hash"),
  uploaded: integer("uploaded", { mode: "boolean" }).notNull().default(false),
});

/** Someone signed in with GitHub (ADR-0017): their GitHub account. */
export const users = sqliteTable("users", {
  /** GitHub's account id, which never changes. */
  id: text("id").primaryKey(),
  login: text("login").notNull(),
  name: text("name"),
  avatar: text("avatar"),
  createdAt: integer("created_at").notNull(),
});

/**
 * A signed-in browser. The cookie holds a random token; only its SHA-256 is
 * kept. GitHub's user token, which checks access on every view, is kept
 * locked with the Site's own key (SESSION_KEY), never in the clear.
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  githubToken: text("github_token").notNull(),
  githubTokenExpiresAt: integer("github_token_expires_at"),
  githubRefresh: text("github_refresh"),
});

/** What GitHub said a session may see, for five minutes (ADR-0017). */
export const access = sqliteTable("access", {
  /** Session id and repository id. */
  key: text("key").primaryKey(),
  allowed: integer("allowed", { mode: "boolean" }).notNull(),
  until: integer("until").notNull(),
});
