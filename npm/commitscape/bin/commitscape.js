#!/usr/bin/env node
// Starts the commitscape binary that npm installed for this platform
// (ADR-0003). It does nothing else: commitscape needs no Node to run.
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

// The packages that may hold this platform's binary, likeliest first.
function candidates() {
  const { platform, arch } = process;
  if (platform === "linux" && arch === "x64") {
    // npm picks by libc. A musl loader means Alpine, most likely; a glibc
    // system with musl installed has one too, so both are tried.
    const musl = fs.existsSync("/lib/ld-musl-x86_64.so.1");
    const gnu = "@commitscape/linux-x64-gnu";
    const alpine = "@commitscape/linux-x64-musl";
    return musl ? [alpine, gnu] : [gnu, alpine];
  }
  if (platform === "linux" && arch === "arm64") return ["@commitscape/linux-arm64"];
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return [`@commitscape/darwin-${arch}`];
  if (platform === "win32" && arch === "x64") return ["@commitscape/win32-x64"];
  return [];
}

const exe = process.platform === "win32" ? "commitscape.exe" : "commitscape";
const packages = candidates();
let binary = null;
for (const pkg of packages) {
  try {
    binary = require.resolve(`${pkg}/bin/${exe}`);
    break;
  } catch {
    // Not installed: try the next.
  }
}
if (!binary) {
  const where = `${process.platform}-${process.arch}`;
  process.stderr.write(
    packages.length > 0
      ? `commitscape: the package with its binary for ${where}, ${packages[0]}, was not installed.\n` +
          "npm installs it as an optional dependency: reinstall without --no-optional (or --omit=optional),\n" +
          `or install it yourself: npm install ${packages[0]}\n`
      : `commitscape: there is no build for ${where} yet; the README says how to build it from source.\n`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);

// Where Node can, become the binary (Node 22.15 and 23.11 on): no second
// process, and a start-up that costs Node's alone (ADR-0003). A failed
// execve cannot be caught, so it is tried only on a binary that can run.
// Its warning that execve is new would land in commitscape's output.
let runnable = true;
try {
  fs.accessSync(binary, fs.constants.X_OK);
} catch {
  runnable = false;
}
if (runnable && typeof process.execve === "function") {
  process.emitWarning = () => {};
  process.execve(binary, [binary, ...args], process.env);
}

// Otherwise it runs as a child. Ctrl-C reaches it too, and it decides when
// to stop: this process only waits and passes its status on.
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const ignore = () => {};
for (const signal of signals) process.on(signal, ignore);
const result = spawnSync(binary, args, { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`commitscape: could not start ${binary}: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  // Die of the same signal, so a script sees what happened.
  for (const signal of signals) process.removeListener(signal, ignore);
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
