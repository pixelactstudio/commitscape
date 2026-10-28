import { expect, test } from "vitest";
import { remoteRefs } from "./clone";
import { repo } from "./gitdata/fixture";
import { run } from "./run";

const env = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "always" };

test("the remote's refs change with a new tag, a moved branch or a moved annotated tag, and not with a pull request's refs", async () => {
  const r = repo();
  const first = r.commit({ "a.rs": "1\n" }, "first");
  r.sh(r.origin, "tag", "-a", "-m", "one", "v1");
  const url = `file://${r.origin}`;
  const refs = async () => {
    const found = await remoteRefs(run, url, env, 30_000);
    if (!found) throw new Error("no refs");
    return found;
  };
  const before = await refs();
  expect(before.head).toBe(first);
  r.sh(r.origin, "update-ref", "refs/pull/1/head", first);
  expect(await refs()).toEqual(before);
  r.sh(r.origin, "tag", "v2", first);
  const tagged = await refs();
  expect(tagged.refs).not.toBe(before.refs);
  expect(tagged.head).toBe(first);
  r.sh(r.origin, "branch", "next", first);
  const branched = await refs();
  expect(branched.refs).not.toBe(tagged.refs);
  r.sh(r.origin, "tag", "-f", "-a", "-m", "moved", "v1", first);
  expect((await refs()).refs).not.toBe(branched.refs);
});
