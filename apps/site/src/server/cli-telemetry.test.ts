import { describe, expect, test } from "vitest";
import { cliRunOf } from "./cli-telemetry";

const RUN = { id: "0123456789abcdef0123456789abcdef", command: "share", version: "0.4.0", os: "linux", arch: "x86_64", outcome: "ok", seconds: 12.345, ci: false, terminal: true, first: true };

describe("the command's usage counts", () => {
  test("take one run with only the fields the command sends, rounded", () => {
    expect(cliRunOf(RUN)).toEqual({ ...RUN, seconds: 12.3 });
    expect(cliRunOf({ ...RUN, version: "0.5.0-rc.1" })?.version).toBe("0.5.0-rc.1");
  });

  test("refuse anything else: another command, an id that could be something else, extra or missing fields", () => {
    expect(cliRunOf({ ...RUN, command: "build" })).toBeNull();
    expect(cliRunOf({ ...RUN, id: "alice@example.com" })).toBeNull();
    expect(cliRunOf({ ...RUN, version: "v1" })).toBeNull();
    expect(cliRunOf({ ...RUN, seconds: -1 })).toBeNull();
    const { outcome: _, ...missing } = RUN;
    expect(cliRunOf(missing)).toBeNull();
    expect(cliRunOf(null)).toBeNull();
    expect(cliRunOf({ ...RUN, repo: "acme/rocket" })).toEqual({ ...RUN, seconds: 12.3 });
  });
});
