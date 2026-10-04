import { PgBoss } from "pg-boss";

export const BUILD_QUEUE = "build";
export const SURVIVAL_QUEUE = "survival";
export const PULLS_QUEUE = "pulls";

export type BuildJob = { buildId: string };

export type SurvivalJob = { repoId: string; reportKey: string; personIds: number[] };

export type PullsJob = { repoId: string };

export const PRIORITY = { person: 10, seed: 0 } as const;

export type Queue = { send(job: BuildJob, priority: number): Promise<void>; count?(job: SurvivalJob): Promise<void> };

/** Starts pg-boss and creates the Build queue; a worker also runs its maintenance. */
export async function startQueue(url: string, options: { worker: boolean; expireInSeconds?: number }): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: url,
    max: options.worker ? 4 : 2,
    supervise: options.worker,
    schedule: false,
  });
  boss.on("error", (e) => console.error("queue:", e));
  await boss.start();
  await boss.createQueue(BUILD_QUEUE, { retryLimit: 0, expireInSeconds: options.expireInSeconds ?? 1200, retentionSeconds: 7 * 24 * 3600 });
  await boss.createQueue(PULLS_QUEUE, { retryLimit: 0, expireInSeconds: 3600, retentionSeconds: 24 * 3600 });
  await boss.createQueue(SURVIVAL_QUEUE, { retryLimit: 0, expireInSeconds: options.expireInSeconds ?? 1200, retentionSeconds: 24 * 3600 });
  return boss;
}

/** The Build queue as the Site and the seeds send to it. */
export function bossQueue(boss: PgBoss): Queue {
  return {
    async send(job, priority) {
      await boss.send(BUILD_QUEUE, job, { priority });
    },
    async count(job) {
      await boss.send(SURVIVAL_QUEUE, job, { singletonKey: `${job.repoId}:${job.reportKey}:${job.personIds.join(",")}` });
    },
  };
}
