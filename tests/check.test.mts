import assert from "node:assert/strict";
import test from "node:test";
import { checkContent, redactSecrets } from "../dist/check.js";
import { listRules } from "../dist/rules.js";

function ids(file: string, content: string): string[] {
  return checkContent(file, content).findings.map((f) => f.ruleId);
}

test("rule catalogue covers the four 80%-problem categories", () => {
  const rules = listRules();
  assert.ok(rules.length >= 12);
  const cats = new Set(rules.map((r) => r.category));
  assert.deepEqual(
    [...cats].sort(),
    ["error-handling", "observability", "resilience", "security"],
  );
  // Every rule id is unique.
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
});

test("JS: empty catch is an error, silent catch is a warning", () => {
  const empty = ids(
    "a.ts",
    `try { doWork(); } catch (e) {}`,
  );
  assert.ok(empty.includes("ERR-EMPTY-CATCH"));

  const silent = ids(
    "a.ts",
    `try { doWork(); } catch (e) { fallback(); }`,
  );
  assert.ok(silent.includes("OBS-SILENT-CATCH"));
  assert.ok(!silent.includes("ERR-EMPTY-CATCH"));

  const good = ids(
    "a.ts",
    `try { doWork(); } catch (e) { console.error("failed", e); throw e; }`,
  );
  assert.deepEqual(good, []);
});

test("JS: catch on its own line (} catch (e) {) is read correctly", () => {
  // A well-handled catch written across lines must not be flagged.
  const good = ids(
    "a.ts",
    [
      "export async function f() {",
      "  try {",
      "    await work();",
      "  } catch (e) {",
      "    console.error('failed', e);",
      "    throw e;",
      "  }",
      "}",
    ].join("\n"),
  );
  assert.deepEqual(good, []);

  // An empty one in the same shape must still be caught.
  const empty = ids(
    "a.ts",
    [
      "export async function f() {",
      "  try {",
      "    await work();",
      "  } catch (e) {",
      "  }",
      "}",
    ].join("\n"),
  );
  assert.ok(empty.includes("ERR-EMPTY-CATCH"));
});

test("JS: comment-only catch counts as empty", () => {
  const found = ids(
    "a.ts",
    "try { doWork(); } catch (e) {\n  // TODO: handle this\n}",
  );
  assert.ok(found.includes("ERR-EMPTY-CATCH"));
});

test("JS: hardcoded secret is flagged and redacted in the snippet", () => {
  const result = checkContent(
    "a.ts",
    `const key = "sk-live-4eC39HqLyjWDarjtT1zdp7dc";`,
  );
  assert.ok(result.findings.some((f) => f.ruleId === "SEC-HARDCODED-SECRET"));
  const snippet = result.findings[0].snippet;
  assert.ok(!snippet.includes("4eC39HqLyjWDarjtT1zdp7dc"));
  assert.ok(snippet.includes("***"));

  // Env vars and placeholders are not secrets.
  assert.deepEqual(ids("a.ts", `const key = process.env.API_KEY;`), []);
  assert.deepEqual(
    ids("a.ts", `const key = "sk-test-your-key-here";`),
    [],
  );
});

test("JS: eval, innerHTML and SQL interpolation are flagged", () => {
  assert.ok(ids("a.ts", `const x = eval(userInput);`).includes("SEC-EVAL"));
  assert.ok(
    ids("a.ts", `el.innerHTML = userInput;`).includes("SEC-INNERHTML"),
  );
  assert.deepEqual(
    ids("a.ts", "el.innerHTML = `<b>fixed</b>`;"),
    [],
  );
  assert.ok(
    ids("a.ts", "const q = `SELECT * FROM users WHERE id = ${id}`;").includes(
      "SEC-SQL-CONCAT",
    ),
  );
  assert.deepEqual(
    ids("a.ts", `db.query("SELECT * FROM users WHERE id = $1", [id]);\nconsole.log("ok");`),
    [],
  );
});

test("JS: floating promise flagged; returned/awaited/caught chains are not", () => {
  assert.ok(
    ids("a.ts", `fetchUser(id).then((u) => save(u));`).includes(
      "ERR-UNCAUGHT-PROMISE",
    ),
  );
  assert.deepEqual(
    ids("a.ts", `return fetchUser(id).then((u) => save(u));`),
    [],
  );
  assert.deepEqual(
    ids("a.ts", `fetchUser(id).then((u) => save(u)).catch(log);`),
    [],
  );
  assert.deepEqual(
    ids("a.ts", `const user = await fetchUser(id).then((u) => u);`),
    [],
  );
});

test("JS: network calls need a timeout", () => {
  assert.ok(
    ids("a.ts", `await fetch("https://api.example.com/x");`).includes(
      "RES-NO-TIMEOUT",
    ),
  );
  assert.deepEqual(
    ids(
      "a.ts",
      `await fetch("https://api.example.com/x", { signal: AbortSignal.timeout(5000) });\nconsole.log("done");`,
    ),
    [],
  );
  assert.ok(
    ids("a.ts", `const r = await axios.get("https://api.example.com/x");`).includes(
      "RES-NO-TIMEOUT",
    ),
  );
  assert.deepEqual(
    ids(
      "a.ts",
      `const r = await axios.get("https://api.example.com/x", { timeout: 5000 });\nconsole.log("done");`,
    ),
    [],
  );
});

test("JS: file doing I/O with no logging anywhere is flagged once", () => {
  const found = checkContent(
    "a.ts",
    `export async function load() {\n  const r = await fetch("/api/x", { signal: AbortSignal.timeout(1000) });\n  return r.json();\n}`,
  );
  assert.ok(found.findings.some((f) => f.ruleId === "OBS-NO-LOGGING"));
  assert.equal(
    found.findings.filter((f) => f.ruleId === "OBS-NO-LOGGING").length,
    1,
  );
});

test("Python: empty and bare except, silent except", () => {
  assert.ok(
    ids("a.py", "try:\n    work()\nexcept Exception:\n    pass").includes(
      "ERR-EMPTY-EXCEPT",
    ),
  );
  assert.ok(
    ids("a.py", "try:\n    work()\nexcept:\n    continue").includes(
      "ERR-BARE-EXCEPT",
    ),
  );
  assert.ok(
    ids("a.py", "try:\n    work()\nexcept ValueError:\n    fallback()").includes(
      "OBS-SILENT-EXCEPT",
    ),
  );
  assert.deepEqual(
    ids(
      "a.py",
      "try:\n    work()\nexcept ValueError:\n    logger.exception('failed')\n    raise",
    ),
    [],
  );
});

test("Python: eval, os.system, shell=True, SQL f-string, requests timeout", () => {
  assert.ok(ids("a.py", "x = eval(raw)").includes("SEC-EVAL"));
  assert.ok(ids("a.py", 'os.system("ls " + name)').includes("SEC-SHELL"));
  assert.ok(
    ids("a.py", "subprocess.run(cmd, shell=True)").includes("SEC-SHELL"),
  );
  assert.ok(
    ids("a.py", `q = f"SELECT * FROM t WHERE id = '{i}'"`).includes(
      "SEC-SQL-CONCAT",
    ),
  );
  // Parameterised placeholder form is fine.
  assert.deepEqual(
    ids("a.py", `db.execute("SELECT * FROM t WHERE id = %s", (i,))\nlogger.info("ok")`),
    [],
  );
  assert.ok(
    ids("a.py", "requests.get(url)").includes("RES-NO-TIMEOUT"),
  );
  assert.deepEqual(ids("a.py", "requests.get(url, timeout=10)\nlogger.info('ok')"), []);
  assert.deepEqual(ids("a.py", "requests.get(url, timeout=10)\nprint('ok')"), []);
});

test("redactSecrets never leaks a provider key", () => {
  const out = redactSecrets(`key = "sk-live-abcdefghij0123456789"`);
  assert.ok(!out.includes("abcdefghij"));
  assert.ok(out.includes("sk-***"));
});

test("suppressions: same-line, next-line and file-level comments", () => {
  assert.deepEqual(
    ids("a.ts", `const key = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"; // last-twenty-ignore`),
    [],
  );
  assert.deepEqual(
    ids(
      "a.ts",
      `const key = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"; // last-twenty-ignore SEC-HARDCODED-SECRET`,
    ),
    [],
  );
  // A rule-specific suppression does not hide other rules on the line.
  assert.ok(
    ids(
      "a.ts",
      `const key = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"; // last-twenty-ignore SEC-EVAL`,
    ).includes("SEC-HARDCODED-SECRET"),
  );
  assert.deepEqual(
    ids(
      "a.ts",
      `// last-twenty-ignore-next-line\nconst key = "sk-live-4eC39HqLyjWDarjtT1zdp7dc";`,
    ),
    [],
  );
  assert.deepEqual(
    ids(
      "a.ts",
      `// last-twenty-ignore-file SEC-HARDCODED-SECRET\nconst key = "sk-live-4eC39HqLyjWDarjtT1zdp7dc";`,
    ),
    [],
  );
});

test("unsupported file types throw", () => {
  assert.throws(() => checkContent("a.md", "# hi"), /unsupported file type/);
});
