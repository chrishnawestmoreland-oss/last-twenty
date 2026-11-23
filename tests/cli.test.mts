import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { changedFilesSince } from "../dist/git.js";
import { collectFiles } from "../dist/scanner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLI = path.join(ROOT, "dist", "cli.js");

function runCli(args: string[]): {
  code: number | null;
  out: string;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return {
    code: r.status,
    out: (r.stdout ?? "") + (r.stderr ?? ""),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

test("CLI: bad fixtures fail with the expected rules; good fixtures pass", () => {
  const bad = runCli(["check", "fixtures/bad"]);
  assert.equal(bad.code, 1, bad.out);
  for (const rule of [
    "SEC-HARDCODED-SECRET",
    "ERR-EMPTY-CATCH",
    "ERR-EMPTY-EXCEPT",
    "ERR-BARE-EXCEPT",
    "SEC-SQL-CONCAT",
    "SEC-INNERHTML",
    "SEC-EVAL",
    "SEC-SHELL",
    "ERR-UNCAUGHT-PROMISE",
    "RES-NO-TIMEOUT",
    "OBS-NO-LOGGING",
  ]) {
    assert.ok(bad.out.includes(rule), `expected ${rule} in output:\n${bad.out}`);
  }
  // The secret value itself must never appear in the report.
  assert.ok(!bad.out.includes("4eC39HqLyjWDarjtT1zdp7dc"));

  const good = runCli(["check", "fixtures/good"]);
  assert.equal(good.code, 0, good.out);
  assert.ok(good.out.includes("No findings"));
});

test("CLI: --format json parses and --only filters", () => {
  const r = runCli(["check", "fixtures/bad", "--format", "json"]);
  assert.equal(r.code, 1);
  const report = JSON.parse(r.stdout) as {
    findings: Array<{ ruleId: string }>;
    scannedFiles: number;
  };
  assert.equal(report.scannedFiles, 2);
  assert.ok(report.findings.length > 10);

  const only = runCli([
    "check",
    "fixtures/bad",
    "--format",
    "json",
    "--only",
    "SEC-HARDCODED-SECRET",
  ]);
  const onlyReport = JSON.parse(only.stdout) as {
    findings: Array<{ ruleId: string }>;
  };
  assert.ok(onlyReport.findings.length > 0);
  assert.ok(
    onlyReport.findings.every((f) => f.ruleId === "SEC-HARDCODED-SECRET"),
  );
});

test("CLI: --fail-on none exits 0 even with findings; bad usage exits 2", () => {
  const r = runCli(["check", "fixtures/bad", "--fail-on", "none"]);
  assert.equal(r.code, 0);
  const badUsage = runCli(["check", "fixtures/bad", "--format", "yaml"]);
  assert.equal(badUsage.code, 2);
  const missing = runCli(["check", "fixtures/nope"]);
  assert.equal(missing.code, 2);
});

test("CLI: checks command lists the rules", () => {
  const r = runCli(["checks"]);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("ERR-EMPTY-CATCH"));
  assert.ok(r.out.includes("RES-NO-TIMEOUT"));
  const j = runCli(["checks", "--json"]);
  assert.equal(j.code, 0);
  assert.ok(Array.isArray(JSON.parse(j.stdout)));
});

test("scanner: skips node_modules/dist and honours .gitignore", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lt-scan-"));
  try {
    fs.mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "dep", "x.js"), "const a = 1;");
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "const a = 1;");
    fs.writeFileSync(path.join(dir, "src", "b.min.js"), "const b = 1;");
    fs.writeFileSync(path.join(dir, ".gitignore"), "*.min.js\n");
    const files = collectFiles(dir, []);
    assert.deepEqual(files, ["src/a.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git: --since audits only the files the agent changed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lt-git-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t.t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(dir, "clean.ts"), "const a = 1;\n");
    fs.writeFileSync(
      path.join(dir, "agent.ts"),
      "export function f() {\n  try { work(); } catch (e) {}\n}\n",
    );
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "base"]);
    // Agent changes only agent.ts afterwards.
    fs.writeFileSync(
      path.join(dir, "agent.ts"),
      "export function f() {\n  try { work(); } catch (e) {}\n}\nconsole.log(1);\n",
    );
    const changed = changedFilesSince(dir, "HEAD");
    assert.deepEqual(changed, ["agent.ts"]);

    const r = runCli(["check", dir, "--since", "HEAD", "--format", "json"]);
    assert.equal(r.code, 1, r.out);
    const report = JSON.parse(r.stdout) as {
      scannedFiles: number;
      findings: Array<{ file: string; ruleId: string }>;
    };
    assert.equal(report.scannedFiles, 1);
    assert.ok(
      report.findings.some(
        (f) => f.file === "agent.ts" && f.ruleId === "ERR-EMPTY-CATCH",
      ),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
