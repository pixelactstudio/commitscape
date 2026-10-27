import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { memoryStorage, readEntry } from "@commitscape/server";
import { storeScreens } from "./screens";

test("a Build's standard screens are worked out from its pack and stored with its Report, one answer each", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screens-"));
  const storage = memoryStorage();
  const asked: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    asked.push([cmd, ...args]);
    await writeFile(args[3] ?? "", JSON.stringify({ "/api/overview?window=all": { commits: 3 }, "/api/stats?": { bus_factor: 1 } }));
    return { code: 0, stderr: "", timedOut: false };
  };
  const pack = join(dir, "pack.bin");
  const stored = await storeScreens(run, storage, { bin: "commitscape", pack, dir, prefix: "reports/gh/1/b1", env: {}, timeoutMs: 1000 });
  expect(stored).toBe(2);
  expect(asked).toEqual([["commitscape", "screens", pack, "--out", join(dir, "screens.json")]]);
  expect(await readEntry(storage, "reports/gh/1/b1", "/api/overview?window=all")).toEqual({ commits: 3 });
});

test("screens that fail say why and store nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screens-"));
  const storage = memoryStorage();
  const failing = async () => ({ code: 1, stderr: "not a commitscape pack\n", timedOut: false });
  await expect(storeScreens(failing, storage, { bin: "commitscape", pack: join(dir, "pack.bin"), dir, prefix: "reports/gh/1/b1", env: {}, timeoutMs: 1000 })).rejects.toThrow("working out the screens failed: not a commitscape pack");
  expect(storage.objects.size).toBe(0);
});
