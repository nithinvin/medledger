#!/usr/bin/env node
// check-doc-links.mjs — verify documentation cross-references resolve.
//
// Checks, from the repository root:
//   1. Every relative Markdown link [text](path#anchor) in *.md files
//      points to an existing file and, if given, an existing heading anchor.
//   2. Every `docs/<file>.md#anchor` mention in code/config comments points
//      to an existing heading.
//
// Anchors follow GitHub's rules: lowercase, punctuation stripped, spaces to
// hyphens, "-1", "-2", … suffixes for duplicates.
//
// Usage: node scripts/check-doc-links.mjs     (exit 1 if anything is broken)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", "bin", "builders", "config", "organizations", "channel-artifacts", "vendor"]);
const CODE_EXTENSIONS = new Set([".go", ".js", ".mjs", ".jsx", ".sh", ".yaml", ".yml", ".json"]);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

const anchorCache = new Map();

function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const anchors = new Set();
  const seen = new Map();
  const text = stripCodeBlocks(readFileSync(file, "utf8"));
  for (const line of text.split("\n")) {
    const match = /^#{1,6} (.*)$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\- _]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}

// baseDir: directory relative paths resolve against; source: file reported on failure.
function checkTarget(source, baseDir, target, problems) {
  const [path, anchor] = target.split("#");
  const targetFile = path ? resolve(baseDir, path) : source;
  const where = relative(ROOT, source);
  if (!existsSync(targetFile)) {
    problems.push(`${where}: missing file -> ${target}`);
    return;
  }
  if (anchor && statSync(targetFile).isFile() && !anchorsOf(targetFile).has(anchor)) {
    problems.push(`${where}: missing anchor -> ${target}`);
  }
}

const problems = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const ext = file.slice(file.lastIndexOf("."));
  if (ext === ".md") {
    const text = stripCodeBlocks(readFileSync(file, "utf8"));
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      checked += 1;
      checkTarget(file, dirname(file), target, problems);
    }
  } else if (CODE_EXTENSIONS.has(ext)) {
    const text = readFileSync(file, "utf8");
    for (const [, target] of text.matchAll(/\b(docs\/[\w/.-]+\.md#[\w-]+)/g)) {
      checked += 1;
      checkTarget(file, ROOT, target, problems);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${checked} links checked, ${problems.length} broken`);
  process.exit(1);
}
console.info(`${checked} links checked, 0 broken`);
