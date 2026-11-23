import { getRule } from "./rules";
import type { FileResult, Finding, Language } from "./types";

// last-twenty-ignore-file OBS-NO-LOGGING — this file's own I/O-detection
// patterns contain the words the file-level check looks for; it does no I/O.

// ---------------------------------------------------------------------------
// Small line-oriented helpers. The checks are deliberately heuristic:
// they run on raw text, not a parser, so they work on any file without a
// build step. That trades precision for zero dependencies; each rule's docs
// say so, and every finding names its rule so false positives can be
// ignored by id.
// ---------------------------------------------------------------------------

export function languageForFile(file: string): Language | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return "js";
  if (/\.py$/.test(file)) return "py";
  return null;
}

function isCommentLine(trimmed: string, lang: Language): boolean {
  if (lang === "js") {
    return (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    );
  }
  return trimmed.startsWith("#");
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Join lines from `start` until parentheses balance (or the file ends). */
function joinStatement(lines: string[], start: number): string {
  let depth = 0;
  let out = "";
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    out += (i === start ? "" : "\n") + line;
    depth += countChar(line, "(") - countChar(line, ")");
    if (depth <= 0 && /;\s*$/.test(line)) break;
    if (i - start > 12) break; // statement is implausibly long; stop
  }
  return out;
}

/**
 * Extract the `{ ... }` block whose opening brace is at `startCol` on line
 * `start`. Counting starts at that brace — not at the line start — because
 * catch lines are usually written `} catch (e) {` and the `try { ... }`
 * before it on the same line would otherwise corrupt the depth.
 */
function extractBraceBlock(
  lines: string[],
  start: number,
  startCol: number,
): { body: string[]; end: number } {
  let depth = 0;
  let seenOpen = false;
  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const from = i === start ? startCol : 0;
    for (let j = from; j < line.length; j++) {
      const ch = line[j];
      if (ch === "{") {
        depth++;
        seenOpen = true;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (i !== start) {
      if (seenOpen && depth === 0) return { body, end: i };
      body.push(line);
    } else if (seenOpen && depth === 0) {
      // Opened and closed on the same line: `catch (e) { fallback(); }`.
      // The body is whatever sits between the braces on that line.
      const close = line.lastIndexOf("}");
      const inline = close > startCol ? line.slice(startCol + 1, close) : "";
      return { body: inline.trim() ? [inline] : [], end: i };
    }
    if (i - start > 200) break;
  }
  return { body, end: lines.length - 1 };
}

/** Extract the indented block under a Python `except:` / `try:` line. */
function extractIndentBlock(
  lines: string[],
  start: number,
): { body: string[]; end: number } {
  const baseIndent = (lines[start].match(/^\s*/) ?? [""])[0].length;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push(line);
      continue;
    }
    const indent = (line.match(/^\s*/) ?? [""])[0].length;
    if (indent <= baseIndent) return { body, end: i - 1 };
    body.push(line);
  }
  return { body, end: lines.length - 1 };
}

function meaningfulLines(body: string[], lang: Language): string[] {
  return body.filter((l) => {
    const t = l.trim();
    return t !== "" && !isCommentLine(t, lang);
  });
}

const JS_LOG = /\b(console|logger|log)\s*\./;
const PY_LOG = /\b(logging|logger)\s*\.|\bprint\s*\(/;

function hasLogging(text: string, lang: Language): boolean {
  return lang === "js" ? JS_LOG.test(text) : PY_LOG.test(text);
}

/** Redact anything that looks like a credential before it lands in output. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9-]{20,}/g, "sk-***")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA***")
    .replace(/ghp_[A-Za-z0-9]{20,}/g, "ghp_***")
    .replace(/gho_[A-Za-z0-9]{20,}/g, "gho_***")
    .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, "xox***")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "-----BEGIN PRIVATE KEY-----") // last-twenty-ignore SEC-HARDCODED-SECRET — the redaction pattern itself, not a credential
    .replace(
      /((?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'`])[^"'`]{4,}(["'`])/gi,
      "$1***$2",
    );
}

const PLACEHOLDER_VALUE =
  /example|placeholder|changeme|your[-_ ]|dummy|test123|xxx+|<\w+>/i;

function makeFinding(
  file: string,
  line: number,
  column: number,
  ruleId: string,
  snippet: string,
): Finding {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`unknown rule ${ruleId}`);
  return {
    file,
    line,
    column,
    ruleId,
    category: rule.category,
    severity: rule.severity,
    message: rule.title,
    snippet: redactSecrets(snippet.trim()),
  };
}

// ---------------------------------------------------------------------------
// Shared checks (both languages)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgho_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_-]?key|secret|password|passwd|auth[_-]?token)\b\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,
  // A bare `key` name with a long literal is suspicious too; the bar is
  // higher (16 chars) because short values are usually config, not secrets.
  /\bkey\b\s*[:=]\s*["'`][^"'`]{16,}["'`]/i,
];

function checkSecrets(
  file: string,
  lines: string[],
  lang: Language,
  findings: Finding[],
): void {
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (isCommentLine(trimmed, lang)) return;
    if (/process\.env|os\.environ|getenv\s*\(|os\.getenv/.test(line)) return;
    if (PLACEHOLDER_VALUE.test(line)) return;
    for (const re of SECRET_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        findings.push(
          makeFinding(file, i + 1, m.index + 1, "SEC-HARDCODED-SECRET", line),
        );
        break;
      }
    }
  });
}

const SQL_KEYWORD = /\b(SELECT\b.*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i; // last-twenty-ignore SEC-SQL-CONCAT — the detection pattern itself, not a query

function checkSqlConcat(
  file: string,
  lines: string[],
  lang: Language,
  findings: Finding[],
): void {
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (isCommentLine(trimmed, lang)) return;
    if (!SQL_KEYWORD.test(line)) return;
    const interpolated =
      lang === "js"
        ? /\$\{/.test(line) || /["'`]\s*\+/.test(line) || /\+\s*[A-Za-z_$]/.test(line)
        : /f["']/.test(line) ||
          // "%s" inside the query string is a parameter placeholder (the
          // correct form). Only flag % when it is the formatting operator:
          // a string literal followed by %.
          /["']\s*%\s*(\(|[A-Za-z_0-9])/.test(line) ||
          /\.format\s*\(/.test(line) ||
          /["']\s*\+/.test(line);
    if (interpolated) {
      findings.push(
        makeFinding(file, i + 1, line.indexOf("SELECT") >= 0 ? line.indexOf("SELECT") + 1 : 1, "SEC-SQL-CONCAT", line),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript checks
// ---------------------------------------------------------------------------

function checkJs(file: string, lines: string[], findings: Finding[]): void {
  // Catch blocks: empty, or silent (no logging, no rethrow).
  lines.forEach((line, i) => {
    const m = /\bcatch\s*(\([^)]*\))?\s*\{/.exec(line);
    if (!m || isCommentLine(line.trim(), "js")) return;
    const openBrace = line.indexOf("{", m.index);
    const { body } = extractBraceBlock(lines, i, openBrace);
    const meaningful = meaningfulLines(body, "js");
    const col = (m.index ?? 0) + 1;
    if (meaningful.length === 0) {
      findings.push(
        makeFinding(file, i + 1, col, "ERR-EMPTY-CATCH", line),
      );
      return;
    }
    const joined = meaningful.join("\n");
    if (!hasLogging(joined, "js") && !/\bthrow\b/.test(joined)) {
      findings.push(
        makeFinding(file, i + 1, col, "OBS-SILENT-CATCH", line),
      );
    }
  });

  // eval / Function constructor.
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "js")) return;
    const m = /\beval\s*\(|new\s+Function\s*\(/.exec(line);
    if (m) {
      findings.push(makeFinding(file, i + 1, m.index + 1, "SEC-EVAL", line));
    }
  });

  // innerHTML from a non-literal, and dangerouslySetInnerHTML.
  // NOTE: a negative lookahead after \s* does NOT work here — \s* can
  // backtrack so the lookahead sees the space, not the quote. Require the
  // first non-space character after `=` to be something other than a quote.
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "js")) return;
    const m = /\.innerHTML\s*=\s*[^"'`\s]/.exec(line);
    if (m) {
      findings.push(
        makeFinding(file, i + 1, m.index + 1, "SEC-INNERHTML", line),
      );
      return;
    }
    const d = /dangerouslySetInnerHTML/.exec(line); // last-twenty-ignore SEC-INNERHTML — matching the pattern, not using it
    if (d) {
      findings.push(
        makeFinding(file, i + 1, d.index + 1, "SEC-INNERHTML", line),
      );
    }
  });

  // Floating promises: .then() with no .catch(), not awaited or returned.
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "js")) return;
    const idx = line.indexOf(".then(");
    if (idx === -1) return;
    const stmt = joinStatement(lines, i);
    if (/\.catch\s*\(/.test(stmt)) return;
    const trimmed = stmt.trim();
    if (/^(return|await)\b/.test(trimmed)) return;
    if (/^\s*(const|let|var)\s+\w+\s*=/.test(trimmed)) return;
    findings.push(
      makeFinding(file, i + 1, idx + 1, "ERR-UNCAUGHT-PROMISE", line),
    );
  });

  // Network calls without a timeout.
  const NETWORK_CALLS: Array<{ re: RegExp; needs: RegExp }> = [
    { re: /\bfetch\s*\(/, needs: /\bsignal\s*[:=]|AbortSignal\.timeout|timeout\s*[:=]/ },
    {
      re: /\baxios\.(get|post|put|patch|delete|head|request)\s*\(/,
      needs: /\btimeout\s*[:=]/,
    },
  ];
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "js")) return;
    for (const { re, needs } of NETWORK_CALLS) {
      const m = re.exec(line);
      if (!m) continue;
      const stmt = joinStatement(lines, i);
      if (!needs.test(stmt)) {
        findings.push(
          makeFinding(file, i + 1, m.index + 1, "RES-NO-TIMEOUT", line),
        );
      }
      break;
    }
  });
}

// ---------------------------------------------------------------------------
// Python checks
// ---------------------------------------------------------------------------

function checkPy(file: string, lines: string[], findings: Finding[]): void {
  // Except blocks: empty (pass only), bare, or silent.
  lines.forEach((line, i) => {
    const m = /^(\s*)except\b(.*):\s*(#.*)?$/.exec(line);
    if (!m) return;
    const bare = m[2].trim() === "";
    const { body } = extractIndentBlock(lines, i);
    const meaningful = meaningfulLines(body, "py");
    const col = line.indexOf("except") + 1;
    if (meaningful.length === 0 || (meaningful.length === 1 && meaningful[0].trim() === "pass")) {
      findings.push(
        makeFinding(file, i + 1, col, "ERR-EMPTY-EXCEPT", line),
      );
    } else {
      const joined = meaningful.join("\n");
      if (!hasLogging(joined, "py") && !/\braise\b/.test(joined)) {
        findings.push(
          makeFinding(file, i + 1, col, "OBS-SILENT-EXCEPT", line),
        );
      }
    }
    if (bare) {
      findings.push(
        makeFinding(file, i + 1, col, "ERR-BARE-EXCEPT", line),
      );
    }
  });

  // eval / exec.
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "py")) return;
    const m = /\beval\s*\(|\bexec\s*\(/.exec(line);
    if (m) {
      findings.push(makeFinding(file, i + 1, m.index + 1, "SEC-EVAL", line));
    }
  });

  // Shell execution.
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "py")) return;
    const m = /\bos\.system\s*\(|shell\s*=\s*True/.exec(line);
    if (m) {
      findings.push(makeFinding(file, i + 1, m.index + 1, "SEC-SHELL", line));
    }
  });

  // Network calls without a timeout.
  const NETWORK_CALLS: Array<{ re: RegExp; needs: RegExp }> = [
    {
      re: /\brequests\.(get|post|put|patch|delete|head|request)\s*\(/,
      needs: /\btimeout\s*=/,
    },
    { re: /\burlopen\s*\(/, needs: /\btimeout\s*=/ },
  ];
  lines.forEach((line, i) => {
    if (isCommentLine(line.trim(), "py")) return;
    for (const { re, needs } of NETWORK_CALLS) {
      const m = re.exec(line);
      if (!m) continue;
      const stmt = joinStatement(lines, i);
      if (!needs.test(stmt)) {
        findings.push(
          makeFinding(file, i + 1, m.index + 1, "RES-NO-TIMEOUT", line),
        );
      }
      break;
    }
  });
}

// ---------------------------------------------------------------------------
// File-level observability check (both languages)
// ---------------------------------------------------------------------------

const JS_IO = /\bfetch\s*\(|axios\.|\.query\s*\(|pool\.|createConnection|http\.(get|request)\s*\(|\.listen\s*\(/;
const PY_IO = /\brequests\.|urlopen\s*\(|\.connect\s*\(|cursor\s*\.|\.execute\s*\(|socket\./;

function checkFileLogging(
  file: string,
  content: string,
  lang: Language,
  findings: Finding[],
): void {
  const io = lang === "js" ? JS_IO.test(content) : PY_IO.test(content);
  if (!io) return;
  if (hasLogging(content, lang)) return;
  findings.push(
    makeFinding(
      file,
      1,
      1,
      "OBS-NO-LOGGING",
      "file performs network/database I/O but contains no logging call",
    ),
  );
}

// ---------------------------------------------------------------------------
// Suppressions — the escape hatch every pattern-based checker needs.
// A comment on a line suppresses findings on that line; a comment naming a
// rule suppresses only that rule; a file-level comment suppresses a rule
// for the whole file. Suppressions are explicit and reviewable in the diff,
// which is the point: the exception is visible, not silent.
//
//   // last-twenty-ignore                  — all rules, this line
//   // last-twenty-ignore SEC-EVAL         — one rule, this line
//   // last-twenty-ignore-next-line        — all rules, next line
//   // last-twenty-ignore-file OBS-NO-LOGGING — one rule, whole file
// ---------------------------------------------------------------------------

interface Suppressions {
  fileRules: Set<string>; // "*" means every rule
  lineRules: Map<number, Set<string>>; // 1-based line -> rules ("*" = all)
}

function ruleIdsFromComment(text: string): Set<string> {
  const ids = new Set<string>();
  for (const token of text.split(/\s+/)) {
    if (/^[A-Z]{2,}-[A-Z-]+$/.test(token)) ids.add(token);
  }
  return ids;
}

function collectSuppressions(lines: string[]): Suppressions {
  const out: Suppressions = { fileRules: new Set(), lineRules: new Map() };
  const add = (lineNo: number, ids: Set<string>) => {
    const existing = out.lineRules.get(lineNo) ?? new Set<string>();
    for (const id of ids.size ? ids : ["*"]) existing.add(id);
    out.lineRules.set(lineNo, existing);
  };
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.includes("last-twenty-ignore-file")) {
      const ids = ruleIdsFromComment(line.split("last-twenty-ignore-file")[1]);
      for (const id of ids.size ? ids : ["*"]) out.fileRules.add(id);
    } else if (line.includes("last-twenty-ignore-next-line")) {
      add(
        lineNo + 1,
        ruleIdsFromComment(line.split("last-twenty-ignore-next-line")[1]),
      );
    } else if (line.includes("last-twenty-ignore")) {
      add(
        lineNo,
        ruleIdsFromComment(line.split("last-twenty-ignore")[1]),
      );
    }
  });
  return out;
}

function isSuppressed(s: Suppressions, f: Finding): boolean {
  if (s.fileRules.has("*") || s.fileRules.has(f.ruleId)) return true;
  const line = s.lineRules.get(f.line);
  return !!line && (line.has("*") || line.has(f.ruleId));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function checkContent(file: string, content: string): FileResult {
  const lang = languageForFile(file);
  if (!lang) throw new Error(`unsupported file type: ${file}`);
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];

  checkSecrets(file, lines, lang, findings);
  checkSqlConcat(file, lines, lang, findings);
  if (lang === "js") checkJs(file, lines, findings);
  else checkPy(file, lines, findings);
  checkFileLogging(file, content, lang, findings);

  const suppressions = collectSuppressions(lines);
  const kept = findings.filter((f) => !isSuppressed(suppressions, f));
  kept.sort((a, b) => a.line - b.line || a.column - b.column);
  return { file, language: lang, findings: kept };
}
