/**
 * The Builder (ADR-0015), run on the owner's server as a systemd service
 * (DEPLOY.md): `node dist/builder.mjs`, configured by its environment.
 * `node dist/builder.mjs seed`, with the same environment, asks the running
 * Builder for the Leaderboards' Builds now rather than at `SEED_HOUR`.
 */
import { SIGNATURE, sign } from "@commitscape/data";
import { config } from "./config";
import { run } from "./run";
import { askForSeeds, seedConfig, seedList, writeBoards } from "./seeds";
import { builder } from "./server";
import { site } from "./site";

const cfg = config();

if (process.argv[2] === "seed") {
  const asked = await fetch(`http://${cfg.host}:${cfg.port}/seed`, {
    method: "POST",
    headers: { [SIGNATURE]: await sign(cfg.secret, "POST", "/seed", "") },
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }));
  console.log(asked.ok ? "seeding: the Builder's log says how it goes" : `the Builder did not start seeding: ${asked.status} ${asked.statusText}`);
  process.exit(asked.ok ? 0 : 1);
}

/** The card as a PNG, for social previews, when resvg is installed. */
async function rasterizer(): Promise<(svg: string) => Uint8Array | null> {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    return (svg) => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
  } catch {
    console.log("no @resvg/resvg-js here: cards are uploaded as SVG");
    return () => null;
  }
}

let seeding = false;
/** The night's seeds: GitHub's search, the Site's budget, the Builds, then the boards. */
async function seed() {
  if (seeding) return;
  seeding = true;
  const started = Date.now();
  try {
    const s = seedConfig();
    const list = await seedList(s);
    const builds = await askForSeeds(cfg, s, list);
    console.log(`seeds: ${list.length} from GitHub's search, ${builds.length} to build tonight`);
    for (const b of builds) b1.enqueue(b);
    await b1.idle();
    await writeBoards(cfg);
    console.log(`seeds: done in ${((Date.now() - started) / 1000).toFixed(0)} s; the boards are written`);
  } catch (e) {
    console.log(`seeds: ${(e as Error).message}`);
  } finally {
    seeding = false;
  }
}

const b1 = builder(cfg, { run, site: site(cfg.site, cfg.secret), png: await rasterizer() }, console.log, () => void seed());
b1.server.listen(cfg.port, cfg.host, () => {
  console.log(`builder listening on http://${cfg.host}:${cfg.port}, one Build at a time${cfg.concurrency > 1 ? ` (${cfg.concurrency})` : ""}; clones in ${cfg.work}`);
});

// Once a night, at SEED_HOUR (UTC; 3 unless set, "off" for never).
const hour = process.env.SEED_HOUR ?? "3";
if (hour !== "off") {
  let last = "";
  setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === Number(hour) && last !== day) {
      last = day;
      void seed();
    }
  }, 60_000);
}
