#!/usr/bin/env bun
/**
 * verify-docs.ts — permanent, dependency-free documentation verifier for RTWiki.
 *
 * Runs under Bun >= 1.3.14. Requires no `bun install`, no `node_modules`, and no
 * third-party packages. It uses only Bun APIs and standard JavaScript/TypeScript
 * APIs (node:fs, node:path, node:url, node:process).
 *
 * What it checks (all in a single pass; it reports every problem, then exits
 * non-zero if any failure is found):
 *   1. Markdown discovery (recursive, with a safe ignore list)
 *   2. Relative-link checking (inline links, images, reference definitions)
 *   3. Heading-anchor checking for `#fragment` links (same-file and cross-file)
 *   4. Markdown structure checks (fences, reference definitions)
 *   5. Root AGENTS.md protocol-section checks
 *   6. Required-file presence
 *   7. ADR consistency (status + index/README entries)
 *   8. Project-status checks (root README)
 *   9. Portable-layout checks (AGENTS.md + ADR-005)
 *  10. Requirement-ID integrity (R-NNN / AC-NNN)
 *
 * Limitation (documented on purpose): this tool validates identifier structure
 * and uniqueness only. It does NOT prove semantic requirement-to-acceptance
 * coverage. That would require an explicit mapping format, which is out of scope.
 *
 * Usage:
 *   bun scripts/verify-docs.ts
 * Run from anywhere inside the repository; the root is resolved by locating .git.
 */

import { readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, dirname, resolve, extname, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

// ---------------------------------------------------------------------------
// Centralized configuration (no scattered magic strings)
// ---------------------------------------------------------------------------

const REQUIRED_BUN = "1.3.14";

/** Directories skipped during Markdown discovery. */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "data",
  "logs",
  "dist",
  "build",
  "coverage",
  ".cache",
  "tmp",
  "temp",
  ".tmp",
]);

/** Temporary-file suffixes skipped during Markdown discovery. */
const TEMP_SUFFIXES: ReadonlyArray<string> = [".tmp", ".bak", ".swp", "~", ".orig"];

/** External link schemes that are never checked against the filesystem. */
const EXTERNAL_SCHEMES: ReadonlyArray<string> = ["http:", "https:", "mailto:", "tel:", "data:"];

/** Tracked files that must exist at the repository root. */
const REQUIRED_FILES: ReadonlyArray<string> = [
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "docs/PRODUCT_REQUIREMENTS.md",
  "docs/MVP_SCOPE.md",
  "docs/ARCHITECTURE.md",
  "docs/DATA_MODEL.md",
  "docs/DEVELOPMENT_STANDARDS.md",
  "docs/SECURITY.md",
  "docs/CI_CD.md",
  "docs/ROADMAP.md",
  "docs/ACCEPTANCE_CRITERIA.md",
  "docs/adr/README.md",
  "docs/adr/ADR-001-browser-first-local-application.md",
  "docs/adr/ADR-002-bun-hono-sqlite.md",
  "docs/adr/ADR-003-react-blocknote-mantine.md",
  "docs/adr/ADR-004-canonical-block-json-format.md",
  "docs/adr/ADR-005-portable-data-layout.md",
];

/** ADR metadata — single source of truth for names, paths and expected status. */
interface AdrMeta {
  readonly id: string;
  readonly path: string;
  readonly expectedStatus: "Accepted";
}
const ADRS: ReadonlyArray<AdrMeta> = [
  { id: "ADR-001", path: "docs/adr/ADR-001-browser-first-local-application.md", expectedStatus: "Accepted" },
  { id: "ADR-002", path: "docs/adr/ADR-002-bun-hono-sqlite.md", expectedStatus: "Accepted" },
  { id: "ADR-003", path: "docs/adr/ADR-003-react-blocknote-mantine.md", expectedStatus: "Accepted" },
  { id: "ADR-004", path: "docs/adr/ADR-004-canonical-block-json-format.md", expectedStatus: "Accepted" },
  { id: "ADR-005", path: "docs/adr/ADR-005-portable-data-layout.md", expectedStatus: "Accepted" },
];

/** Portable-layout tokens that must be documented. */
const PORTABLE_TOKENS: ReadonlyArray<string> = [
  "RTWiki.exe",
  "data/",
  "rtwiki.sqlite",
  "attachments/",
  "backups/",
  "logs/",
  "rtwiki.log",
];

/** Prohibited portable-layout behaviours (documented as forbidden). */
interface PortableProhibition {
  readonly label: string;
  readonly pattern: RegExp;
}
const PORTABLE_PROHIBITIONS: ReadonlyArray<PortableProhibition> = [
  { label: "current-working-directory path derivation", pattern: /current working directory/i },
  { label: "silent storage fallback", pattern: /silent(?:ly)?\s+fall\s*back/i },
  { label: "environment-variable data-directory override", pattern: /environment[- ]variable.{0,40}data.{0,30}(?:override|directory)|RTWIKI_DATA_DIR/i },
];

/** Exact project-status line required in the root README. */
const REQUIRED_README_STATUS = "Planning approved — implementation not started";

/** Stale phrases that must not appear in the root README. */
const FORBIDDEN_STATUS_PHRASES: ReadonlyArray<string> = [
  "Planning phase complete — ready for implementation",
  "React 18",
  "RTWIKI_DATA_DIR",
  "rtwiki.db",
];

/** Requirement-ID patterns. */
const REQ_ID_RE: RegExp = /^R-\d{3}$/;
const AC_ID_RE: RegExp = /^AC-\d{3}$/;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface Failure {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly detail: string;
}
interface Warning {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly detail: string;
}

const failures: Failure[] = [];
const warnings: Warning[] = [];
let localLinksChecked = 0;

function fail(file: string, line: number, kind: string, detail: string): void {
  failures.push({ file, line, kind, detail });
}
function warn(file: string, line: number, kind: string, detail: string): void {
  warnings.push({ file, line, kind, detail });
}

// ---------------------------------------------------------------------------
// Small focused helpers
// ---------------------------------------------------------------------------

/** Locate the repository root by walking up to the first directory containing .git. */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate the repository root (.git not found). Run this script from inside the RTWiki repository.",
  );
}

/** Compare two Bun/semver-ish version strings; return true if `have` >= `min`. */
function bunVersionSatisfies(have: string, min: string): boolean {
  const parse = (v: string): ReadonlyArray<number> =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(have);
  const b = parse(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** GitHub-style heading slug. */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build the set of valid heading slugs for a file (duplicates get -1, -2, ...). */
function buildHeadingSlugSet(headings: ReadonlyArray<string>): Set<string> {
  const counts = new Map<string, number>();
  const set = new Set<string>();
  for (const h of headings) {
    const base = slugify(h);
    const n = counts.get(base) ?? 0;
    set.add(n === 0 ? base : `${base}-${n}`);
    counts.set(base, n + 1);
  }
  return set;
}

/** True when `target` is the same as or nested inside `root`. */
function isInside(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

/** Safely decode URL-encoded characters in a path; returns the original on error. */
function safeDecode(input: string): string {
  if (!input.includes("%")) return input;
  try {
    return decodeURIComponent(input);
  } catch {
    warn("<path>", 0, "decode", `could not URL-decode "${input}"; using as-is`);
    return input;
  }
}

function isTempFile(name: string): boolean {
  return TEMP_SUFFIXES.some((s) => name.endsWith(s));
}

/** Parsed components of a Markdown link target. */
interface SplitTarget {
  /** Filesystem path portion (after stripping query string and fragment). */
  readonly path: string;
  /** Heading fragment (after `#`); everything after the first `#` per URL semantics. */
  readonly fragment: string;
  /** Query string (after `?`, before `#`); intentionally unused for local-file resolution. */
  readonly query: string;
}

/**
 * Split a raw link target into path / fragment / query.
 *
 * URL fragment semantics: the first `#` begins the fragment, and everything
 * after it belongs to the fragment (even a literal `?`). A `?` that appears
 * before any `#` begins the query string and is stripped from the path.
 * URL-encoded `%3F` / `%23` are NOT split here — they are decoded later by
 * `safeDecode` so an encoded delimiter stays part of the filename.
 */
function splitTarget(raw: string): SplitTarget {
  let s = raw.trim();
  // strip an optional "title" part:  path "title"
  const titleMatch = s.match(/^(\S+)(?:\s+"[^"]*")?\s*$/);
  if (titleMatch) s = titleMatch[1];

  let fragment = "";
  const hashIdx = s.indexOf("#");
  if (hashIdx !== -1) {
    fragment = s.slice(hashIdx + 1);
    s = s.slice(0, hashIdx);
  }
  let query = "";
  const qIdx = s.indexOf("?");
  if (qIdx !== -1) {
    query = s.slice(qIdx + 1);
    s = s.slice(0, qIdx);
  }
  return { path: s, fragment, query };
}

/**
 * Mask inline-code spans on a single line with spaces, preserving length so
 * that reported line numbers stay accurate and columns are not shifted.
 *
 * - Ordinary single-backtick spans and longer matching backtick runs are masked.
 * - Escaped backticks (`\``) are treated as literal text, not delimiters.
 * - An unmatched backtick leaves the rest of the line untouched (no crash).
 * - Tilde fences are intentionally ignored here (handled by fence analysis).
 *
 * The result is safe to run the link/reference regexes against: anything inside
 * a code span (including link-like text) is blanked out, while real links
 * outside the span are left intact.
 */
function maskInlineCode(line: string): string {
  if (!line.includes("`")) return line;
  const chars = line.split("");
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (line[i] === "\\" && i + 1 < n && line[i + 1] === "`") {
      i += 2; // escaped backtick -> literal, not a delimiter
      continue;
    }
    if (line[i] === "`") {
      let j = i;
      while (j < n && line[j] === "`") j++;
      const openLen = j - i;
      // find the first run of '`' whose length >= openLen (the closing delimiter)
      let k = j;
      let closeStart = -1;
      while (k < n) {
        if (line[k] === "\\") { k += 2; continue; }
        if (line[k] !== "`") { k += 1; continue; }
        let r = k;
        while (r < n && line[r] === "`") r++;
        if (r - k >= openLen) { closeStart = k; break; }
        k = r;
      }
      if (closeStart === -1) { i = j; continue; } // unmatched: leave as-is
      let r = closeStart;
      while (r < n && line[r] === "`") r++;
      for (let p = i; p < r; p++) chars[p] = " ";
      i = r;
      continue;
    }
    i++;
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Markdown discovery
// ---------------------------------------------------------------------------

interface MdFile {
  readonly abs: string;
  readonly rel: string;
  readonly text: string;
  readonly lines: ReadonlyArray<string>;
  readonly insideFence: ReadonlyArray<boolean>;
  readonly fenceBlocks: ReadonlyArray<FenceBlock>;
  readonly headingSlugs: Set<string>;
}

/** A detected fenced code block. `closeLine === -1` means unclosed at EOF. */
interface FenceBlock {
  readonly char: "`" | "~";
  readonly openLen: number;
  readonly openLine: number;
  readonly closeLine: number;
  readonly hasContent: boolean;
}

const FENCE_OPEN_RE: RegExp = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE: RegExp = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Parse fenced code blocks for a file. Returns:
 *  - `inside`: per-line flag (true for fence delimiter lines and their content),
 *  - `blocks`: every fence with its open/close lines and whether it has content.
 *
 * Implements CommonMark-ish fence rules: an opening run of >= 3 of one char
 * (` or ~) with up to 3 leading spaces; a closing fence uses the same char and
 * is at least as long as the opening; a different fence char never closes.
 */
function analyzeFences(lines: ReadonlyArray<string>): { inside: boolean[]; blocks: FenceBlock[] } {
  const inside: boolean[] = new Array(lines.length).fill(false);
  const blocks: FenceBlock[] = [];
  let cur: { char: "`" | "~"; openLen: number; openLine: number; hasContent: boolean } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!cur) {
      const m = line.match(FENCE_OPEN_RE);
      if (m) {
        const fence = m[1];
        cur = { char: fence[0] as "`" | "~", openLen: fence.length, openLine: i, hasContent: false };
        inside[i] = true; // opening delimiter line is skipped
      }
      continue;
    }
    const close = line.match(FENCE_CLOSE_RE);
    if (close && close[1][0] === cur.char && close[1].length >= cur.openLen) {
      inside[i] = true; // closing delimiter line is skipped
      blocks.push({ char: cur.char, openLen: cur.openLen, openLine: cur.openLine, closeLine: i, hasContent: cur.hasContent });
      cur = null;
      continue;
    }
    inside[i] = true; // content line
    if (line.trim().length > 0) cur.hasContent = true;
  }
  if (cur) {
    blocks.push({ char: cur.char, openLen: cur.openLen, openLine: cur.openLine, closeLine: -1, hasContent: cur.hasContent });
  }
  return { inside, blocks };
}

async function walkMarkdown(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      await walkMarkdown(p, out);
    } else if (e.isFile()) {
      if (extname(e.name).toLowerCase() === ".md" && !isTempFile(e.name)) out.push(p);
    }
  }
}

function analyzeFile(abs: string, rel: string, text: string): MdFile {
  const lines = text.split(/\r?\n/);
  const headingTexts: string[] = [];
  const fenceRes = analyzeFences(lines);
  for (let i = 0; i < lines.length; i++) {
    if (!fenceRes.inside[i]) {
      const hm = lines[i].match(/^#{1,6}\s+(.*)$/);
      if (hm) headingTexts.push(hm[1].trim());
    }
  }
  return {
    abs,
    rel,
    text,
    lines,
    insideFence: fenceRes.inside,
    fenceBlocks: fenceRes.blocks,
    headingSlugs: buildHeadingSlugSet(headingTexts),
  };
}

// ---------------------------------------------------------------------------
// Link + structure checking (per file)
// ---------------------------------------------------------------------------

const INLINE_LINK_RE: RegExp = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
const REF_DEF_RE: RegExp = /^(\s*)\[([^\]\s]+)\]:\s+(\S+)/;
const REF_USE_RE: RegExp = /\[([^\]]+)\]\[([^\]]*)\]/g;

interface LinkRef {
  readonly target: string;
  readonly line: number;
}

function checkFile(file: MdFile, root: string, byRel: ReadonlyMap<string, MdFile>): void {
  const refDefs = new Map<string, LinkRef>();

  // --- fence structure: unclosed or empty fenced code blocks ---
  for (const b of file.fenceBlocks) {
    if (b.closeLine === -1) {
      fail(file.rel, b.openLine + 1, "fence-unclosed", `fenced code block opened at line ${b.openLine + 1} is not closed before end of file`);
    } else if (!b.hasContent) {
      fail(file.rel, b.openLine + 1, "fence-empty", `fenced code block opened at line ${b.openLine + 1} contains no non-whitespace content`);
    }
  }

  // --- reference definitions: collect + detect duplicates ---
  for (let i = 0; i < file.lines.length; i++) {
    if (file.insideFence[i]) continue;
    const m = maskInlineCode(file.lines[i]).match(REF_DEF_RE);
    if (m) {
      const label = m[2].toLowerCase();
      if (refDefs.has(label)) {
        fail(file.rel, i + 1, "duplicate-reference-def", `reference definition "[${m[2]}]" defined more than once`);
      } else {
        refDefs.set(label, { target: m[3], line: i + 1 });
      }
    }
  }

  // --- inline links, images, reference usages ---
  for (let i = 0; i < file.lines.length; i++) {
    if (file.insideFence[i]) continue;
    const line = maskInlineCode(file.lines[i]);

    for (const m of line.matchAll(INLINE_LINK_RE)) {
      processTarget(file, root, byRel, m[3], i + 1);
    }
    for (const m of line.matchAll(REF_USE_RE)) {
      const text = m[1];
      const refLabel = m[2].length === 0 ? text : m[2];
      const def = refDefs.get(refLabel.toLowerCase());
      if (!def) {
        fail(file.rel, i + 1, "undefined-reference", `link "[${text}][${refLabel}]" references an undefined definition`);
        continue;
      }
      processTarget(file, root, byRel, def.target, i + 1);
    }
  }
}

function processTarget(
  file: MdFile,
  root: string,
  byRel: ReadonlyMap<string, MdFile>,
  raw: string,
  line: number,
): void {
  const lower = raw.trim().toLowerCase();
  if (EXTERNAL_SCHEMES.some((s) => lower.startsWith(s))) return; // external: no filesystem check

  const { path, fragment } = splitTarget(raw);
  localLinksChecked++;

  // pure same-document fragment
  if (path.length === 0) {
    if (fragment.length > 0) checkAnchor(file.rel, file, fragment, line, raw);
    return;
  }

  const decoded = safeDecode(path);
  const base = dirname(file.abs);
  const resolvedAbs = resolve(base, decoded);

  if (!isInside(root, resolvedAbs)) {
    fail(file.rel, line, "link-escapes-root", `link "${raw}" resolves outside the repository root`);
    return;
  }

  const targetRel = relative(root, resolvedAbs).split(sep).join("/");
  const kind = pathKind(resolvedAbs);
  if (kind === "missing") {
    fail(file.rel, line, "link-target-missing", `relative link "${raw}" does not resolve to a file or directory (resolved: ${targetRel || "."})`);
    return;
  }

  if (fragment.length > 0) {
    const tgt = byRel.get(targetRel);
    if (tgt) checkAnchor(file.rel, tgt, fragment, line, raw);
    else warn(file.rel, line, "anchor-unresolved", `cannot read target "${targetRel}" to verify anchor "${fragment}"`);
  }
}

/** Classify a filesystem path as a file, directory, or missing (best-effort). */
function pathKind(p: string): "file" | "dir" | "missing" {
  try {
    const s = statSync(p);
    return s.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}

function checkAnchor(
  sourceRel: string,
  target: MdFile,
  fragment: string,
  line: number,
  raw: string,
): void {
  if (!target.headingSlugs.has(fragment)) {
    fail(sourceRel, line, "anchor-missing", `fragment "#${fragment}" not found in ${target.rel} (link: ${raw})`);
  }
}

// ---------------------------------------------------------------------------
// Root AGENTS.md specific checks
// ---------------------------------------------------------------------------

function checkAgentsSpecial(agents: MdFile): void {
  const text = agents.text;
  const lines = agents.lines;

  // 14 numbered `## N.` protocol headings
  const seen = new Set<number>();
  for (const l of lines) {
    const m = l.match(/^##\s+(\d+)\.\s/);
    if (m) seen.add(Number.parseInt(m[1], 10));
  }
  for (let n = 1; n <= 14; n++) {
    if (!seen.has(n)) fail(agents.rel, 0, "agents-heading-missing", `required protocol heading "## ${n}." is missing`);
  }

  // no more than 300 lines
  if (lines.length > 300) fail(agents.rel, 0, "agents-too-long", `AGENTS.md is ${lines.length} lines (limit 300)`);

  // no malformed ordered markers "1)"
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\d+\)\s/.test(lines[i])) fail(agents.rel, i + 1, "malformed-ordered", `ordered list uses "1)" style marker: ${lines[i].trim()}`);
  }

  // no unordered list beginning with "* "
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\*\s+\S/.test(lines[i])) fail(agents.rel, i + 1, "star-bullet", `unordered list uses "* " instead of "-": ${lines[i].trim()}`);
  }

  // portable filesystem tree tokens present
  for (const tok of PORTABLE_TOKENS) {
    if (!text.includes(tok)) fail(agents.rel, 0, "portable-token-missing", `portable-layout token "${tok}" not found in AGENTS.md`);
  }

  // no invalid shorthand "docs/ADR-001"
  for (let i = 0; i < lines.length; i++) {
    if (/docs\/ADR-\d/.test(lines[i])) fail(agents.rel, i + 1, "shorthand-adr", `invalid shorthand ADR reference "docs/ADR-...": ${lines[i].trim()}`);
  }
}

// ---------------------------------------------------------------------------
// Required-file checks
// ---------------------------------------------------------------------------

function checkRequiredFiles(root: string): void {
  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(root, f))) fail("<repo>", 0, "required-file-missing", `required tracked file not found: ${f}`);
  }
}

// ---------------------------------------------------------------------------
// ADR consistency
// ---------------------------------------------------------------------------

function adrStatus(text: string): string | null {
  // Table form used by RTWiki ADRs: | **Status** | **Accepted** |
  const tableMatch = text.match(/\|\s*\*\*Status\*\*\s*\|(.*?)\|/i);
  if (tableMatch) {
    const val = tableMatch[1].replace(/\*/g, "").trim().toLowerCase();
    if (val.includes("accepted")) return "Accepted";
    if (val.includes("proposed")) return "Proposed";
    if (val.includes("deprecated")) return "Deprecated";
    if (val.includes("superseded")) return "Superseded";
    return val.length > 0 ? val : null;
  }
  // Heading form: a "## Status" section whose body names the status.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s*Status\b/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]); j++) {
        const s = lines[j].toLowerCase();
        if (s.includes("accepted")) return "Accepted";
        if (s.includes("proposed")) return "Proposed";
        if (s.includes("deprecated")) return "Deprecated";
        if (s.includes("superseded")) return "Superseded";
      }
      return null;
    }
  }
  return null;
}

function checkAdrConsistency(byRel: ReadonlyMap<string, MdFile>): void {
  for (const adr of ADRS) {
    const file = byRel.get(adr.path);
    if (!file) {
      fail("<repo>", 0, "adr-missing", `ADR document not found: ${adr.path}`);
      continue;
    }
    const status = adrStatus(file.text);
    if (status === null) fail(adr.path, 0, "adr-status-missing", `no Status / status found`);
    else if (status !== adr.expectedStatus) fail(adr.path, 0, "adr-status-wrong", `expected status "${adr.expectedStatus}", found "${status}"`);

    // ADR index and README reference ADRs by basename (index) or full path (README).
    const base = basename(adr.path);

    const index = byRel.get("docs/adr/README.md");
    if (index) {
      if (!index.text.includes(base) || !mentionsAcceptedNear(index.text, base))
        fail("docs/adr/README.md", 0, "adr-index-entry", `ADR index does not list "${adr.id}" as Accepted`);
    }
    const readme = byRel.get("README.md");
    if (readme) {
      if (!readme.text.includes(adr.path) || !mentionsAcceptedNear(readme.text, adr.path))
        fail("README.md", 0, "adr-readme-entry", `README does not list "${adr.id}" as Accepted`);
    }
  }
}

function mentionsAcceptedNear(text: string, pathFragment: string): boolean {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pathFragment)) {
      // check this line and the next for "Accepted"
      const window = [lines[i], lines[i + 1] ?? ""].join(" ");
      if (/accepted/i.test(window)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Project-status checks (root README only)
// ---------------------------------------------------------------------------

function checkProjectStatus(readme: MdFile | undefined): void {
  if (!readme) return;
  if (!readme.text.includes(REQUIRED_README_STATUS))
    fail("README.md", 0, "status-line-missing", `root README must contain exactly: "${REQUIRED_README_STATUS}"`);
  for (const phrase of FORBIDDEN_STATUS_PHRASES) {
    if (readme.text.includes(phrase))
      fail("README.md", 0, "status-stale-phrase", `forbidden stale phrase found in README: "${phrase}"`);
  }
}

// ---------------------------------------------------------------------------
// Portable-layout checks
// ---------------------------------------------------------------------------

function checkPortableLayout(byRel: ReadonlyMap<string, MdFile>): void {
  const agents = byRel.get("AGENTS.md");
  const adr5 = byRel.get("docs/adr/ADR-005-portable-data-layout.md");
  const sources = [agents, adr5].filter((x): x is MdFile => x !== undefined);

  for (const tok of PORTABLE_TOKENS) {
    if (!sources.some((s) => s.text.includes(tok)))
      fail("<repo>", 0, "portable-token-missing", `portable-layout token "${tok}" not documented in AGENTS.md or ADR-005`);
  }
  for (const p of PORTABLE_PROHIBITIONS) {
    if (!sources.some((s) => p.pattern.test(s.text)))
      fail("<repo>", 0, "portable-prohibition-missing", `portable-layout prohibition not documented: ${p.label}`);
  }
}

// ---------------------------------------------------------------------------
// Requirement-ID integrity
// ---------------------------------------------------------------------------

function checkRequirementIds(byRel: ReadonlyMap<string, MdFile>): void {
  checkIdDoc(byRel.get("docs/PRODUCT_REQUIREMENTS.md"), REQ_ID_RE, "R-");
  checkIdDoc(byRel.get("docs/ACCEPTANCE_CRITERIA.md"), AC_ID_RE, "AC-");
}

function checkIdDoc(file: MdFile | undefined, re: RegExp, prefix: string): void {
  if (!file) return;
  const ids: string[] = [];
  for (const line of file.lines) {
    const m = line.match(/\b(R-\d{3}|AC-\d{3})\b/g);
    if (m) ids.push(...m.filter((x) => re.test(x)));
  }
  // uniqueness
  const seen = new Map<string, number>();
  for (const id of ids) {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) fail(file.rel, 0, "id-duplicate", `requirement ID "${id}" appears ${n} times (must be unique)`);
  }
  // numbering gaps -> warning (not failure)
  const numbers = ids.map((x) => Number.parseInt(x.slice(prefix.length), 10)).sort((a, b) => a - b);
  const max = numbers.length ? numbers[numbers.length - 1] : 0;
  for (let n = 1; n < max; n++) {
    if (!numbers.includes(n)) warn(file.rel, 0, "id-gap", `no ${prefix}${String(n).padStart(3, "0")} in sequence (gap, not a failure)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!bunVersionSatisfies(Bun.version, REQUIRED_BUN)) {
    console.error(
      `This script requires Bun >= ${REQUIRED_BUN}. Detected Bun ${Bun.version}.\n` +
        `Install Bun ${REQUIRED_BUN} or later, then run: bun scripts/verify-docs.ts`,
    );
    exit(1);
  }

  const root = findRepoRoot();
  const found: string[] = [];
  await walkMarkdown(root, found);
  found.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));

  const byRel = new Map<string, MdFile>();
  for (const abs of found) {
    const rel = relative(root, abs).split(sep).join("/");
    const text = await Bun.file(abs).text();
    byRel.set(rel, analyzeFile(abs, rel, text));
  }

  // per-file structure + links
  for (const file of byRel.values()) checkFile(file, root, byRel);

  // root AGENTS.md special checks
  const agents = byRel.get("AGENTS.md");
  if (agents) checkAgentsSpecial(agents);

  // global categories
  checkRequiredFiles(root);
  checkAdrConsistency(byRel);
  const readme = byRel.get("README.md");
  checkProjectStatus(readme);
  checkPortableLayout(byRel);
  checkRequirementIds(byRel);

  // ---- reporting ----
  const filesScanned = byRel.size;
  const structuralCategories = 5; // required-files, ADR consistency, project status, portable layout, requirement-ids (per-file structure counted via filesScanned)
  const structuralChecks = filesScanned + structuralCategories;

  if (failures.length > 0) {
    console.error(`\nFAILURES (${failures.length}):`);
    for (const f of failures) {
      console.error(`  [${f.kind}] ${f.file}:${f.line} — ${f.detail}`);
    }
  }
  if (warnings.length > 0) {
    console.error(`\nWARNINGS (${warnings.length}):`);
    for (const w of warnings) {
      console.error(`  [${w.kind}] ${w.file}:${w.line} — ${w.detail}`);
    }
  }

  const overall = failures.length === 0 ? "PASS" : "FAIL";
  console.log("──────── Documentation verification ────────");
  console.log(`Markdown files scanned : ${filesScanned}`);
  console.log(`Local links checked    : ${localLinksChecked}`);
  console.log(`Structural checks      : ${structuralChecks}`);
  console.log(`Failures               : ${failures.length}`);
  console.log(`Warnings               : ${warnings.length}`);
  console.log(`Overall                : ${overall}`);
  console.log("───────────────────────────────────────────");

  exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`verify-docs: unexpected error: ${msg}`);
  exit(1);
});
