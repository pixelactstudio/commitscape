import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { memoryStorage, screensKey } from "@commitscape/server";
import { storeScreens } from "./screens";

test("a Build's standard screens are worked out from its pack and stored beside the pack as one object the engine service reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screens-"));
  const storage = memoryStorage();
  const asked: string[][] = [];
  const answers = { "/api/overview?window=all": { commits: 3 }, "/api/stats?": { bus_factor: 1 } };
  const run = async (cmd: string, args: string[]) => {
    asked.push([cmd, ...args]);
    await writeFile(args[3] ?? "", JSON.stringify(answers));
    return { code: 0, stderr: "", timedOut: false };
  };
  const pack = join(dir, "pack.bin");
  const key = screensKey("packs/acme/rocket/1/a-b1-lines.pack");
  expect(await storeScreens(run, storage, { bin: "commitscape", pack, dir, key, env: {}, timeoutMs: 1000 })).toBe(2);
  expect(asked).toEqual([["commitscape", "screens", pack, "--out", join(dir, "screens.json")]]);
  expect(key).toBe("packs/acme/rocket/1/a-b1-lines.pack.screens");
  expect(JSON.parse(gunzipSync(storage.objects.get(key)?.body ?? new Uint8Array()).toString())).toEqual(answers);
});

test("screens that fail say why and store nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "screens-"));
  const storage = memoryStorage();
  const failing = async () => ({ code: 1, stderr: "not a commitscape pack\n", timedOut: false });
  await expect(storeScreens(failing, storage, { bin: "commitscape", pack: join(dir, "pack.bin"), dir, key: "p.screens", env: {}, timeoutMs: 1000 })).rejects.toThrow("working out the screens failed: not a commitscape pack");
  expect(storage.objects.size).toBe(0);
});
