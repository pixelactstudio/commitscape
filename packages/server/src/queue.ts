import { PgBoss } from "pg-boss";

export const BUILD_QUEUE = "build";

export type BuildJob = { buildId: string };

export const PRIORITY = { person: 10, seed: 0 } as const;

export type Queue = { send(job: BuildJob, priority: number): Promise<void> };

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
  return boss;
}

/** The Build queue as the Site and the seeds send to it. */
export function bossQueue(boss: PgBoss): Queue {
  return {
    async send(job, priority) {
      await boss.send(BUILD_QUEUE, job, { priority });
    },
  };
}
