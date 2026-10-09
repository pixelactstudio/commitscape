import { PgBoss } from "pg-boss";

export const BUILD_QUEUE = "builds";
export const BUILD_LARGE_QUEUE = "builds-large";
export const SURVIVAL_QUEUE = "surviving-by-people";
export const PULLS_QUEUE = "pulls-by-repo";

export type BuildJob = { buildId: string; repoId?: string; attempt?: number };

export type SurvivalJob = { repoId: string; reportKey: string; personIds: number[]; attempt?: number };

export type PullsJob = { repoId: string };

export const PRIORITY = { person: 10, seed: 0 } as const;

export const LONGEST_JOB_SECONDS = 24 * 3600;

export type Queue = { send(job: BuildJob, priority: number): Promise<void>; count?(job: SurvivalJob): Promise<void> };

export const buildKey = (job: BuildJob) => job.repoId ?? job.buildId;
export const survivalKey = (job: SurvivalJob) => `${job.repoId}:${job.reportKey}:${job.personIds.join(",")}`;

/** Starts pg-boss and creates the queues: a repository's Builds run one at a time, and a read of pull requests or a count of Surviving Lines waits at most once behind the same one running. A worker also runs maintenance and sets how long a Build may run. */
export async function startQueue(url: string, options: { worker: boolean; expireInSeconds?: number }): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: url,
    max: options.worker ? 4 : 2,
    supervise: options.worker,
    schedule: false,
  });
  boss.on("error", (e) => console.error("queue:", e));
  await boss.start();
  for (const name of [BUILD_QUEUE, BUILD_LARGE_QUEUE]) {
    await boss.createQueue(name, { policy: "singleton", retryLimit: 0, expireInSeconds: options.expireInSeconds ?? 3600, retentionSeconds: 7 * 24 * 3600 });
  }
  await boss.createQueue(PULLS_QUEUE, { policy: "stately", retryLimit: 0, expireInSeconds: 3600, retentionSeconds: 24 * 3600 });
  await boss.createQueue(SURVIVAL_QUEUE, { policy: "stately", retryLimit: 0, expireInSeconds: LONGEST_JOB_SECONDS, retentionSeconds: 24 * 3600 });
  if (options.worker && options.expireInSeconds) {
    for (const name of [BUILD_QUEUE, BUILD_LARGE_QUEUE]) await boss.updateQueue(name, { expireInSeconds: options.expireInSeconds });
  }
  return boss;
}

/** The Build queue as the Site and the seeds send to it. */
export function bossQueue(boss: PgBoss): Queue {
  return {
    async send(job, priority) {
      await boss.send(BUILD_QUEUE, job, { priority, singletonKey: buildKey(job) });
    },
    async count(job) {
      await boss.send(SURVIVAL_QUEUE, job, { singletonKey: survivalKey(job) });
    },
  };
}

/** The states of the queued jobs that carry a Build, in either lane. */
export async function buildJobStates(boss: PgBoss, buildId: string): Promise<string[]> {
  const found = await Promise.all([BUILD_QUEUE, BUILD_LARGE_QUEUE].map((name) => boss.findJobs<BuildJob>(name, { data: { buildId } })));
  return found.flat().map((j) => j.state);
}
