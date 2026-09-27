import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ts = createRequire(join(root, "packages/ui/package.json"))("typescript");
const write = process.argv.includes("--write");
const verbose = process.argv.includes("--verbose");

const SKIP = [/^fixtures\//, /\/node_modules\//, /^target\//, /routeTree\.gen\.ts$/, /^packages\/data\/src\/types\.ts$/, /\/drizzle\//, /^scripts\/strip-comments\.mjs$/];
const HASH_FILES = new Set([".gitignore", ".dockerignore", ".gitattributes", "Dockerfile"]);
const HASH_EXTENSIONS = new Set([".toml", ".yml", ".yaml", ".sh", ".nix"]);
const KEEP = [/^\/\/\/\s*<reference/, /^#\s*syntax=/, /@ts-(expect-error|ignore|nocheck)/, /eslint-disable/, /oxlint-disable/, /biome-ignore/, /@vite-ignore/, /[#@]__PURE__/, /prettier-ignore/];

function kindOf(path) {
  const ext = extname(path);
  if ([".ts", ".tsx", ".mts", ".mjs", ".js"].includes(ext)) return "ts";
  if (ext === ".rs") return "rust";
  if (ext === ".css") return "css";
  if (HASH_EXTENSIONS.has(ext) || HASH_FILES.has(basename(path))) return "hash";
  return null;
}

function tsComments(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ranges = new Map();
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) return;
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind === ts.SyntaxKind.JsxExpression && !node.expression) {
      const inner = text.slice(node.getStart(file) + 1, node.end - 1).trim();
      if (inner.startsWith("/*") && inner.endsWith("*/")) {
        ranges.set(node.getStart(file), { pos: node.getStart(file), end: node.end, text: inner });
        return;
      }
    }
    const children = node.getChildren(file);
    if (children.length === 0 || node.kind === ts.SyntaxKind.EndOfFileToken) {
      for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.set(r.pos, { pos: r.pos, end: r.end, text: text.slice(r.pos, r.end) });
    }
    for (const child of children) visit(child);
  };
  visit(file);
  return [...ranges.values()];
}

function rustComments(text) {
  const out = [];
  let i = 0;
  const at = (k) => text[k] ?? "";
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && at(i + 1) === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out.push({ pos: i, end: stop, text: text.slice(i, stop) });
      i = stop;
    } else if (c === "/" && at(i + 1) === "*") {
      let depth = 1;
      let k = i + 2;
      while (k < text.length && depth > 0) {
        if (text[k] === "/" && at(k + 1) === "*") {
          depth++;
          k += 2;
        } else if (text[k] === "*" && at(k + 1) === "/") {
          depth--;
          k += 2;
        } else k++;
      }
      out.push({ pos: i, end: k, text: text.slice(i, k) });
      i = k;
    } else if ((c === "r" || (c === "b" && at(i + 1) === "r")) && /[#"]/.test(at(c === "r" ? i + 1 : i + 2)) && !/[A-Za-z0-9_]/.test(at(i - 1))) {
      let k = c === "r" ? i + 1 : i + 2;
      let hashes = 0;
      while (text[k] === "#") {
        hashes++;
        k++;
      }
      if (text[k] !== '"') {
        i++;
        continue;
      }
      const close = `"${"#".repeat(hashes)}`;
      const end = text.indexOf(close, k + 1);
      i = end === -1 ? text.length : end + close.length;
    } else if (c === '"') {
      let k = i + 1;
      while (k < text.length && text[k] !== '"') k += text[k] === "\\" ? 2 : 1;
      i = k + 1;
    } else if (c === "'") {
      if (at(i + 1) === "\\") {
        let k = i + 2;
        while (k < text.length && text[k] !== "'") k++;
        i = k + 1;
      } else {
        const next = String.fromCodePoint(text.codePointAt(i + 1) ?? 32);
        i = at(i + 1 + next.length) === "'" ? i + 2 + next.length : i + 1;
      }
    } else i++;
  }
  return out;
}

function clapRegions(text) {
  const regions = [];
  const derive = /#\[derive\(([^)]*)\)\]/g;
  for (const m of text.matchAll(derive)) {
    if (!/\b(Parser|Args|Subcommand|ValueEnum)\b/.test(m[1])) continue;
    let start = text.lastIndexOf("\n", m.index - 1) + 1;
    while (start > 0) {
      const prev = text.lastIndexOf("\n", start - 2) + 1;
      const line = text.slice(prev, start - 1).trim();
      if (!line.startsWith("///") && !line.startsWith("#[")) break;
      start = prev;
    }
    const open = text.indexOf("{", m.index);
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    regions.push([start, end]);
  }
  return regions;
}

function cssComments(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out.push({ pos: i, end: stop, text: text.slice(i, stop) });
      i = stop;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < text.length && text[k] !== c) k += text[k] === "\\" ? 2 : 1;
      i = k + 1;
    } else i++;
  }
  return out;
}

function hashComments(text) {
  const out = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const shebang = pos === 0 && trimmed.startsWith("#!");
    if (trimmed.startsWith("#") && !shebang) out.push({ pos: pos + line.length - trimmed.length, end: pos + line.length, text: trimmed });
    pos += line.length + 1;
  }
  return out;
}

function strip(text, ranges) {
  let out = text;
  for (const r of [...ranges].sort((a, b) => b.pos - a.pos)) {
    const lineStart = out.lastIndexOf("\n", r.pos - 1) + 1;
    const lineEnd = out.indexOf("\n", r.end);
    const stop = lineEnd === -1 ? out.length : lineEnd;
    const before = out.slice(lineStart, r.pos);
    const after = out.slice(r.end, stop);
    if (before.trim() === "" && after.trim() === "") out = out.slice(0, lineStart) + out.slice(lineEnd === -1 ? out.length : lineEnd + 1);
    else out = out.slice(0, r.pos).replace(/[ \t]+$/, "") + out.slice(r.end);
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !SKIP.some((s) => s.test(f)) && kindOf(f));

let total = 0;
let changed = 0;
for (const file of files) {
  const path = join(root, file);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  const kind = kindOf(file);
  const found = kind === "ts" ? tsComments(file, text) : kind === "rust" ? rustComments(text) : kind === "css" ? cssComments(text) : hashComments(text);
  const help = kind === "rust" ? clapRegions(text) : [];
  const isHelp = (r) => r.text.startsWith("///") && help.some(([a, b]) => r.pos >= a && r.pos <= b);
  const isDoc = (r) => (kind === "ts" && r.text.startsWith("/**")) || (kind === "rust" && r.text.startsWith("///"));
  const ranges = found.filter((r) => !KEEP.some((k) => k.test(r.text)) && !isHelp(r) && !isDoc(r));
  if (ranges.length === 0) continue;
  total += ranges.length;
  changed++;
  console.log(`${String(ranges.length).padStart(5)}  ${file}`);
  if (verbose) for (const r of ranges.slice(0, 3)) console.log(`         ${r.text.split("\n")[0].slice(0, 100)}`);
  if (write) writeFileSync(path, strip(text, ranges));
}
console.log(`${total} comments in ${changed} files${write ? ", removed" : " (dry run: pass --write to remove them)"}`);
