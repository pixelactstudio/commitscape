#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function candidates() {
  const { platform, arch } = process;
  if (platform === "linux" && arch === "x64") {
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

const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
const ignore = () => {};
for (const signal of signals) process.on(signal, ignore);
const result = spawnSync(binary, args, { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`commitscape: could not start ${binary}: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  for (const signal of signals) process.removeListener(signal, ignore);
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
