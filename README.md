# last-twenty

**Find the 20% your agent didn't ship.**

Agents reliably deliver the visible 80% of a feature — and systematically omit
error handling, security controls, observability and resilience. SkillzBench
puts it bluntly: agents ship code "that works in a demo and does not survive
production". Oracle's November 2026 study of agents as forward-deployed
engineers found only 2 of 8 delivery runs met every acceptance criterion, with
40% of requirements missing or misrepresented after discovery. And the bill for
the missing 20% lands on a salaried engineer reviewing code the agent shipped
in ninety seconds.

`last-twenty` is a zero-dependency, offline CLI that audits a codebase for
exactly those four gaps — the ones agents omit, not the ones a general linter
already covers. Point it at a repo, or at just the files an agent changed, and
it reports what is missing before you review the diff.

## Quickstart

```bash
npm install -g last-twenty        # or: npx last-twenty
last-twenty check .                 # audit the current directory
last-twenty check --since main      # audit only what changed vs main
last-twenty check --format json     # machine-readable report
last-twenty checks                  # list every rule
```

Exit code `0` means nothing at or above `--fail-on` (default: `error`);
`1` means findings — use it as a CI gate on agent PRs. `2` is a usage error.

## What it checks

Four categories, 13 rules. Every finding names its rule id and a fix.

| Rule | Severity | What it catches |
| --- | --- | --- |
| `ERR-EMPTY-CATCH` | error | Empty `catch {}` — the error disappears |
| `ERR-EMPTY-EXCEPT` | error | Python `except: pass` |
| `ERR-BARE-EXCEPT` | warning | Bare `except:` — also catches `KeyboardInterrupt` |
| `ERR-UNCAUGHT-PROMISE` | warning | `.then()` chain that is never awaited, returned or `.catch()`ed |
| `SEC-HARDCODED-SECRET` | error | Provider-prefixed keys (`sk-…`, `AKIA…`, `ghp_…`) or long literals assigned to `api_key` / `secret` / `password` / `token` |
| `SEC-EVAL` | error | `eval()` / `exec()` / `new Function()` |
| `SEC-SHELL` | error | `os.system()` or `subprocess(..., shell=True)` |
| `SEC-SQL-CONCAT` | error | SQL assembled with interpolation / f-strings / `%` formatting |
| `SEC-INNERHTML` | error | `innerHTML` / `dangerouslySetInnerHTML` from a non-literal |
| `OBS-SILENT-CATCH` | warning | `catch` that neither logs nor rethrows |
| `OBS-SILENT-EXCEPT` | warning | `except` that neither logs nor re-raises |
| `OBS-NO-LOGGING` | warning | A file that does network/database I/O but never logs |
| `RES-NO-TIMEOUT` | warning | `fetch` / `axios` / `requests` / `urlopen` with no timeout |

Languages: TypeScript/JavaScript and Python. Files under `node_modules`,
`dist`, `.git` and other build/dependency directories are skipped, and your
`.gitignore` is honoured.

## Auditing just the agent's diff

```bash
# After an agent branch lands, audit only what it touched:
last-twenty check --since main

# Same, but fail on warnings too, and emit a Markdown report for the PR:
last-twenty check --since main --fail-on warning --format markdown
```

`--since` compares against a git ref and includes untracked files, so new
files the agent added are audited too.

## Options

```
last-twenty check [path] [--since <ref>] [--format text|json|markdown]
                         [--fail-on error|warning|none]
                         [--only <id,...>] [--ignore <glob,...>]
                         [--config <path>]
```

Config file (`.last-twenty.json` in the target directory, or `--config`):

```json
{ "ignore": ["fixtures/**"], "failOn": "warning", "only": ["SEC-*"] }
```

CLI flags win over the config file.

## Suppressions

Pattern checks false-positive — especially on code that *talks about* the
patterns (like this tool's own rule definitions). Suppress explicitly, in the
code, where the exception is visible in review:

```ts
const key = loadFromVault(); // last-twenty-ignore SEC-HARDCODED-SECRET
// last-twenty-ignore-next-line
eval(userScript);
// last-twenty-ignore-file OBS-NO-LOGGING
```

A bare `last-twenty-ignore` suppresses every rule on that line; naming a rule
suppresses only that rule.

## Secrets are never printed

Findings that match a credential pattern are redacted in every output format
(`sk-live-…` prints as `sk-***`). The tool reads your source locally and
sends nothing anywhere.

## Limitations — read before trusting it

- **Pattern-based, not a parser.** Checks run on raw text with regexes and
  brace counting. They miss things (a `try` built by a helper, a timeout set
  in a wrapper) and they false-positive (a SQL keyword inside a comment or a
  regex literal, a rule definition that mentions `eval()`).
- **It checks the four gaps, not everything.** It is not a linter, a type
  checker, or a security scanner. A clean run means "none of these 13
  patterns fired", not "this code is production-ready".
- **Heuristic severities.** An empty `catch` is an error because the failure
  vanishes; a missing timeout is a warning because it usually just hangs.
  Tune with `--only`, `--ignore` and suppressions rather than treating the
  defaults as gospel.

## Related work

- [Semgrep](https://semgrep.dev/) / ESLint / Bandit — general-purpose
  analysers; `last-twenty` is a small opinionated checklist for one specific
  failure mode, not a replacement.
- [AuditMe](https://auditme-six.vercel.app/) — LLM-based audits of
  vibe-coded repos; `last-twenty` is deterministic and offline, so its
  verdicts are reproducible.
- [Cloudflare's security-audit skill](https://github.com/cloudflare/security-audit-skill)
  — a multi-phase agent-driven audit; `last-twenty` is the five-second
  pre-check you run before that.

## Development

```bash
npm install
npm run build    # tsc -> dist/
npm test         # node --test, 20 tests
npm run demo     # audit fixtures/bad (16 findings) — fixtures/good is clean
```

## Sources

- SkillzBench, "Coding With Agents in Python 2026: Setup, Skills, Pitfalls" —
  the 80% problem and the four systematic omissions.
  https://skillzbench.com/insights/coding-with-agents-in-python-setup-skills-and-pitfalls-in-2026
- Zamora, "The 80% Problem: Three Years of Building Agents", Medium, Nov 2026 —
  the missing 20% used to cost an edit; on a write to a system of record it
  costs whatever the write did.
  https://medium.com/@zamoramm/the-80-problem-three-years-of-building-agents-e885ce9d0507
- Oracle AI, "Can LLM Agents Be Forward-Deployed Engineers?" (arXiv, 2 Nov
  2026) — only 25% of agent delivery runs met all acceptance criteria; 40%
  of requirements missing or misrepresented.
  https://nosov.ai/library/lib-2026-11-02-can-llm-agents-be-forward-deployed-engineers/

## License

MIT.
