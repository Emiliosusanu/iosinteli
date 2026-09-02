#!/usr/bin/env node
/**
 * Vendors the InteliAds Chrome-extension KDP logic into the iOS app so the
 * in-app WebView helper runs BYTE-IDENTICAL parsing/rebuild code.
 *
 * It extracts, from the extension's `sw.js`, the transitive closure of the pure
 * (no chrome/network/state) functions the helper needs — the report parser
 * (`buildKdpFromJsons`, `buildTitlesRows`) and the per-date request rebuilders
 * (`updateUrlDates`, `updatePostData`, …) — plus the page-context capture/replay
 * hook (`pageHook.js`). The result is written to:
 *
 *   src/lib/kdp/vendor/kdpVendor.generated.js
 *
 * Run: node scripts/build-kdp-injected.mjs [path-to-extension-dir]
 * Default extension dir: ~/dev/inteliads/robo_ads-main/extension
 *
 * Commit the generated file; CI does not need the extension repo present.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, "..");

const EXT_DIR =
  process.argv[2] ||
  process.env.INTELIADS_EXT_DIR ||
  join(os.homedir(), "dev/inteliads/robo_ads-main/extension");

const OUT_DIR = join(FRONTEND, "src/lib/kdp/vendor");
const OUT_FILE = join(OUT_DIR, "kdpVendor.generated.js");

// Seeds: everything the WebView driver calls directly. Their transitive closure
// (referenced top-level functions) is pulled in automatically.
const SEEDS = [
  // Parsers
  "buildKdpFromJsons",
  "buildTitlesRows",
  // Per-date request rebuilders (non-ads report replay)
  "updateUrlDates",
  "updatePostData",
  "rangeIsoPreserveCapturedOffsets",
  "detectUsesYmdDates",
  "normalizeTemplateUrlForType",
  "findFirstRange",
  "tryParseJson",
  "looksLikeHtmlErrorPage",
  "pickTemplateTypeByUrl",
  "extractBooksObj",
  // Date helpers (function decls; isYmd/nowIso are const-arrows supplied by the driver prelude)
  "addDaysYmd",
  "eachYmd",
  "ymdParts",
  "ymdInTimeZone",
];

// Anything referencing these cannot run in a plain page context / must be
// supplied by the driver, so we refuse to vendor it (fail loudly instead of
// shipping broken code).
const FORBIDDEN = [
  /\bchrome\b/,
  /\bgetState\b/,
  /\bsetState/,
  /\bsetStatePatch\b/,
  /\bsupabase[A-Z]/,
  /\bimportScripts\b/,
  /\bDeno\b/,
];

// True if a `/` at this position begins a regex literal (vs. division), based
// on the previous significant character. Good enough for well-formed source.
function regexAllowed(prevSig) {
  if (prevSig === "") return true;
  return "(){[,;:=!&|?+-*%^~<>".includes(prevSig);
}

/** Return the index just past the balanced `{...}` body starting at `open`. */
function scanBody(src, open) {
  let depth = 0;
  let inS = null; // ' " `
  let inLine = false;
  let inBlock = false;
  let inRegex = false;
  let inClass = false; // inside [...] of a regex
  let prevSig = "";
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && src[j + 1] === "/") {
        inBlock = false;
        j++;
      }
      continue;
    }
    if (inRegex) {
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) inRegex = false;
      continue;
    }
    if (inS) {
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === inS) inS = null;
      continue;
    }
    if (c === "/" && src[j + 1] === "/") {
      inLine = true;
      j++;
      continue;
    }
    if (c === "/" && src[j + 1] === "*") {
      inBlock = true;
      j++;
      continue;
    }
    if (c === "/" && regexAllowed(prevSig)) {
      inRegex = true;
      inClass = false;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inS = c;
      prevSig = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
    if (c.trim() !== "") prevSig = c;
  }
  return src.length;
}

/** Skip a balanced `(...)` parameter list starting at `open` (`(`). */
function scanPair(src, open, openCh, closeCh) {
  if (src[open] !== openCh) return open;
  // Reuse the string/regex-aware scanner by temporarily mapping braces.
  // We walk with the same state machine as scanBody, but count openCh/closeCh.
  let depth = 0;
  let inS = null;
  let inLine = false;
  let inBlock = false;
  let inRegex = false;
  let inClass = false;
  let prevSig = "";
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && src[j + 1] === "/") {
        inBlock = false;
        j++;
      }
      continue;
    }
    if (inRegex) {
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) inRegex = false;
      continue;
    }
    if (inS) {
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === inS) inS = null;
      continue;
    }
    if (c === "/" && src[j + 1] === "/") {
      inLine = true;
      j++;
      continue;
    }
    if (c === "/" && src[j + 1] === "*") {
      inBlock = true;
      j++;
      continue;
    }
    if (c === "/" && regexAllowed(prevSig)) {
      inRegex = true;
      inClass = false;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inS = c;
      prevSig = c;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return j + 1;
    }
    if (c.trim() !== "") prevSig = c;
  }
  return src.length;
}

function parseTopLevelFunctions(src) {
  // sw.js top-level functions always start at column 0. Slice from one
  // `^function name` to the next so destructured params / regex quantifiers
  // cannot truncate or swallow a neighbor.
  const map = new Map();
  const lines = src.split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(lines[i]);
    if (m) starts.push({ line: i, name: m[2] });
  }
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s].line;
    const to = s + 1 < starts.length ? starts[s + 1].line : lines.length;
    let chunk = lines.slice(from, to);
    while (chunk.length && chunk[chunk.length - 1].trim() === "") chunk.pop();
    map.set(starts[s].name, { text: chunk.join("\n") });
  }
  return map;
}

function identifiersIn(text) {
  const ids = new Set();
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m;
  while ((m = re.exec(text))) ids.add(m[0]);
  return ids;
}

function closure(map, seeds) {
  const included = new Set();
  const stack = [...seeds];
  const missing = new Set();
  while (stack.length) {
    const name = stack.pop();
    if (included.has(name)) continue;
    const fn = map.get(name);
    if (!fn) {
      missing.add(name);
      continue;
    }
    included.add(name);
    for (const id of identifiersIn(fn.text)) {
      if (id === name) continue;
      if (map.has(id) && !included.has(id)) stack.push(id);
    }
  }
  return { included, missing };
}

function main() {
  if (!existsSync(EXT_DIR)) {
    console.error(`[build-kdp-injected] extension dir not found: ${EXT_DIR}`);
    console.error("Pass the path as arg1 or set INTELIADS_EXT_DIR.");
    process.exit(2);
  }
  const swPath = join(EXT_DIR, "sw.js");
  const hookPath = join(EXT_DIR, "pageHook.js");
  const sw = readFileSync(swPath, "utf8");
  const pageHook = readFileSync(hookPath, "utf8");

  const fns = parseTopLevelFunctions(sw);
  const missingSeeds = SEEDS.filter((s) => !fns.has(s));
  if (missingSeeds.length) {
    console.error(`[build-kdp-injected] seeds not found in sw.js: ${missingSeeds.join(", ")}`);
    process.exit(3);
  }

  const { included, missing } = closure(fns, SEEDS);

  // Refuse to vendor impure functions.
  const impure = [];
  for (const name of included) {
    const text = fns.get(name).text;
    for (const rx of FORBIDDEN) {
      if (rx.test(text)) {
        impure.push({ name, rx: String(rx) });
        break;
      }
    }
  }
  if (impure.length) {
    console.error("[build-kdp-injected] impure functions in closure (cannot vendor):");
    for (const it of impure) console.error(`  - ${it.name} matches ${it.rx}`);
    process.exit(4);
  }

  const ordered = [...included].sort();
  const body = ordered.map((n) => fns.get(n).text).join("\n\n");
  const buildText = fns.get("buildKdpFromJsons")?.text || "";
  if (buildText.length < 2000 || !buildText.includes("extractBooksObj")) {
    console.error(
      `[build-kdp-injected] buildKdpFromJsons looks truncated (${buildText.length} chars). Refusing to write.`,
    );
    process.exit(5);
  }

  const header = `/* eslint-disable */
// @ts-nocheck
/**
 * AUTO-GENERATED by scripts/build-kdp-injected.mjs — DO NOT EDIT BY HAND.
 * Source: InteliAds Chrome extension (sw.js + pageHook.js).
 * Vendored pure functions: ${ordered.length}. Extension version noted in STORE_LISTING.
 * Regenerate: node scripts/build-kdp-injected.mjs
 */
`;

  const prelude = `const isYmd = (s) => /^\\d{4}-\\d{2}-\\d{2}$/.test(String(s || "").trim());
const nowIso = () => new Date().toISOString();
`;

  const exportsList = ordered.filter((n) =>
    [
      "buildKdpFromJsons",
      "buildTitlesRows",
      "updateUrlDates",
      "updatePostData",
      "findFirstRange",
      "detectUsesYmdDates",
      "rangeIsoPreserveCapturedOffsets",
      "tryParseJson",
      "looksLikeHtmlErrorPage",
      "normalizeTemplateUrlForType",
      "pickTemplateTypeByUrl",
      "extractBooksObj",
      "addDaysYmd",
      "eachYmd",
    ].includes(n),
  );

  const module = `${header}
${prelude}
${body}

export const KDP_PAGE_HOOK_JS = ${JSON.stringify(pageHook)};

export const KDP_VENDOR_FUNCTIONS = ${JSON.stringify(ordered)};

export {
  ${exportsList.join(",\n  ")}
};
`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, module, "utf8");

  console.log(`[build-kdp-injected] wrote ${OUT_FILE}`);
  console.log(`  vendored ${ordered.length} functions, pageHook ${pageHook.length} bytes, buildKdpFromJsons ${buildText.length} chars`);
  if (missing.size) {
    console.log(`  (external identifiers, expected: ${[...missing].slice(0, 20).join(", ")}${missing.size > 20 ? "…" : ""})`);
  }
}

main();
