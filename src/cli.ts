#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { checkContent, languageForFile } from "./check";
import { changedFilesSince } from "./git";
import { renderReport } from "./report";
import { listRules } from "./rules";
import { collectFiles, globToRegExp, readSourceFile } from "./scanner";
import type { AuditOptions, AuditReport, Finding } from "./types";

const VERSION = "0.1.0";

const HELP = `last-twenty ${VERSION} — find the 20% your agent didn't ship.

Agents reliably deliver the visible 80% of a feature and systematically
omit error handling, security controls, observability and resilience.
last-twenty audits code for exactly those gaps, offline, with no
dependencies. Pattern-based heuristics: it will miss things and it will
false-positive. Every finding names its rule, so you can ignore by id.

USAGE
  last-twenty check [path] [options]   Audit a directory or a single file
  last-twenty checks [--json]          List the rules this version checks
  last-twenty --help | --version

OPTIONS (check)
  --since <ref>            Only audit files changed against a git ref
                           (plus untracked files) — the agent's diff
  --format text|json|markdown   Output format (default: text)
  --fail-on error|warning|none  Severity that fails the run (default: error)
  --only <id,...>          Only run these rule ids
  --ignore <glob,...>      Skip paths matching these globs
  --config <path>          Config file (default: .last-twenty.json in target)

CONFIG (.last-twenty.json)
  { "ignore": ["fixtures/**"], "failOn": "warning", "only": ["SEC-*"] }

EXIT CODES
  0  no findings at or above --fail-on
  1  findings at or above --fail-on (CI gate)
  2  usage or input error
`;

interface CliArgs {
  command: string;
  target: string;
  sinceRef?: string;
  format: string;
  failOn?: "error" | "warning" | "none";
  only?: string[];
  ignoreGlobs: string[];
  configPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs | { error: string } {
  const args: CliArgs = {
    command: "check",
    target: ".",
    format: "text",
    ignoreGlobs: [],
    json: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { error: "__help__" };
    if (a === "--version" || a === "-v") return { error: "__version__" };
    if (a === "--json") {
      args.json = true;
      continue;
    }
    if (a === "--since") {
      args.sinceRef = argv[++i];
      if (!args.sinceRef) return { error: "--since needs a git ref" };
      continue;
    }
    if (a === "--format") {
      args.format = argv[++i] ?? "";
      if (!["text", "json", "markdown"].includes(args.format)) {
        return { error: `--format must be text, json or markdown (got ${args.format})` };
      }
      continue;
    }
    if (a === "--fail-on") {
      const v = argv[++i] ?? "";
      if (!["error", "warning", "none"].includes(v)) {
        return { error: `--fail-on must be error, warning or none (got ${v})` };
      }
      args.failOn = v as CliArgs["failOn"];
      continue;
    }
    if (a === "--only") {
      const v = argv[++i];
      if (!v) return { error: "--only needs a comma-separated list of rule ids" };
      args.only = v.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (a === "--ignore") {
      const v = argv[++i];
      if (!v) return { error: "--ignore needs a comma-separated list of globs" };
      args.ignoreGlobs.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (a === "--config") {
      args.configPath = argv[++i];
      if (!args.configPath) return { error: "--config needs a path" };
      continue;
    }
    if (a.startsWith("-")) return { error: `unknown flag: ${a}` };
    positional.push(a);
  }
  if (positional[0] === "checks" || positional[0] === "check") {
    args.command = positional[0];
    if (positional[1]) args.target = positional[1];
  } else if (positional[0]) {
    args.command = "check";
    args.target = positional[0];
  }
  return args;
}

interface FileConfig {
  ignore?: string[];
  failOn?: "error" | "warning" | "none";
  only?: string[];
}

function loadConfig(targetDir: string, explicit?: string): FileConfig {
  const candidates = explicit
    ? [explicit]
    : [path.join(targetDir, ".last-twenty.json")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as FileConfig;
      return parsed;
    } catch (err) {
      throw new Error(
        `could not parse config ${candidate}: ${(err as Error).message}`,
      );
    }
  }
  return {};
}

function expandOnly(ids: string[] | undefined): Set<string> | null {
  if (!ids) return null;
  const out = new Set<string>();
  for (const id of ids) {
    if (id.endsWith("*")) {
      const prefix = id.slice(0, -1);
      for (const rule of listRules()) {
        if (rule.id.startsWith(prefix)) out.add(rule.id);
      }
    } else {
      out.add(id);
    }
  }
  return out;
}

function runAudit(opts: AuditOptions): AuditReport {
  const startedAt = new Date().toISOString();
  const targetAbs = path.resolve(opts.target);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetAbs);
  } catch {
    throw new Error(`target not found: ${opts.target}`);
  }

  let files: string[] = [];
  let root = targetAbs;
  if (stat.isFile()) {
    if (!languageForFile(targetAbs)) {
      throw new Error(`unsupported file type: ${opts.target}`);
    }
    root = path.dirname(targetAbs);
    files = [path.basename(targetAbs)];
  } else if (opts.sinceRef) {
    files = changedFilesSince(targetAbs, opts.sinceRef).filter((f) =>
      languageForFile(f),
    );
  } else {
    files = collectFiles(targetAbs, opts.ignoreGlobs ?? []);
  }

  const ignoreRes = (opts.ignoreGlobs ?? []).map(globToRegExp);
  const onlySet = expandOnly(opts.only);
  const findings: Finding[] = [];
  let scanned = 0;
  const filesWithFindings = new Set<string>();

  for (const rel of files) {
    if (ignoreRes.some((re) => re.test(rel) || re.test(path.basename(rel)))) {
      continue;
    }
    const content = readSourceFile(root, rel);
    if (content === null) continue;
    scanned++;
    const result = checkContent(rel, content);
    for (const f of result.findings) {
      if (onlySet && !onlySet.has(f.ruleId)) continue;
      findings.push(f);
      filesWithFindings.add(rel);
    }
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );

  return {
    target: opts.target,
    scannedFiles: scanned,
    filesWithFindings: filesWithFindings.size,
    findings,
    files,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function exitCodeFor(report: AuditReport, failOn: string): number {
  if (failOn === "none") return 0;
  if (failOn === "warning") return report.findings.length > 0 ? 1 : 0;
  return report.findings.some((f) => f.severity === "error") ? 1 : 0;
}

function printChecks(json: boolean): void {
  const rules = listRules();
  if (json) {
    console.log(JSON.stringify(rules, null, 2));
    return;
  }
  console.log("last-twenty rules — the four things agents omit:\n");
  for (const rule of rules) {
    console.log(
      `${rule.id} [${rule.severity}] (${rule.category})\n  ${rule.title}\n  ${rule.description}\n  fix: ${rule.fix}\n`,
    );
  }
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    if (parsed.error === "__help__") {
      console.log(HELP);
      return 0;
    }
    if (parsed.error === "__version__") {
      console.log(`last-twenty ${VERSION}`);
      return 0;
    }
    console.error(`error: ${parsed.error}\n`);
    console.error(HELP);
    return 2;
  }

  if (parsed.command === "checks") {
    printChecks(parsed.json);
    return 0;
  }

  try {
    const targetAbs = path.resolve(parsed.target);
    const targetDir = fs.existsSync(targetAbs) && fs.statSync(targetAbs).isFile()
      ? path.dirname(targetAbs)
      : targetAbs;
    const config = loadConfig(targetDir, parsed.configPath);
    // CLI flag wins; otherwise the config file; otherwise "error".
    const failOn = parsed.failOn ?? config.failOn ?? "error";
    const opts: AuditOptions = {
      target: parsed.target,
      sinceRef: parsed.sinceRef,
      only: parsed.only ?? config.only,
      ignoreGlobs: [...(config.ignore ?? []), ...parsed.ignoreGlobs],
      failOn,
    };
    const report = runAudit(opts);
    console.log(renderReport(report, parsed.format));
    return exitCodeFor(report, failOn);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 2;
  }
}

process.exit(main());
