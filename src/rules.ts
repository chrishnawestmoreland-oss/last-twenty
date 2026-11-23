import type { Rule } from "./types";

/**
 * The rule catalogue: the four things agents systematically omit, per the
 * "80% problem" — agents reliably ship the visible 80% of a feature and
 * systematically omit error handling, security controls, observability and
 * resilience (SkillzBench, "Coding With Agents in Python 2026"; Medium,
 * "The 80% Problem: Three Years of Building Agents", Nov 2026).
 *
 * Every rule is a deterministic, pattern-based heuristic. It will produce
 * false positives on unusual-but-fine code; that is why each finding carries
 * its rule id (for --only / ignore) and why the README documents the limits.
 */
export const RULES: Rule[] = [
  {
    id: "ERR-EMPTY-CATCH",
    category: "error-handling",
    severity: "error",
    title: "Empty catch block swallows the error",
    description:
      "A catch block with no statements at all. The failure disappears: no log, no rethrow, no fallback. The next person debugging this has nothing to work with.",
    fix: "Log the error with context, rethrow it, or return an explicit fallback — never leave the block empty.",
  },
  {
    id: "ERR-EMPTY-EXCEPT",
    category: "error-handling",
    severity: "error",
    title: "Empty except block swallows the error",
    description:
      "An except block whose only statement is `pass`. Same failure as an empty catch: the error is gone and nothing records that it happened.",
    fix: "Log the exception, re-raise it, or handle it explicitly.",
  },
  {
    id: "ERR-BARE-EXCEPT",
    category: "error-handling",
    severity: "warning",
    title: "Bare except catches everything, including KeyboardInterrupt",
    description:
      "A bare `except:` also catches KeyboardInterrupt and SystemExit, so the process can no longer be stopped cleanly and real bugs hide behind it.",
    fix: "Catch the specific exception type you expect, e.g. `except ValueError:`.",
  },
  {
    id: "ERR-UNCAUGHT-PROMISE",
    category: "error-handling",
    severity: "warning",
    title: "Promise chain without .catch()",
    description:
      "A `.then()` chain that is neither awaited, returned, nor given a `.catch()`. A rejection becomes an unhandled rejection — silent in some runtimes, a crash in others.",
    fix: "Add `.catch()` to the chain, or `await` it inside a try/catch.",
  },
  {
    id: "SEC-HARDCODED-SECRET",
    category: "security",
    severity: "error",
    title: "Hardcoded secret in source",
    description:
      "A value that looks like a live credential (provider-prefixed key, or a long literal assigned to a key/secret/password/token name) is written in source code, where it ships to every clone.",
    fix: "Read it from the environment (process.env / os.environ) or a secret store. Never commit a real credential.",
  },
  {
    id: "SEC-EVAL",
    category: "security",
    severity: "error",
    title: "eval()/exec() on dynamic input", // last-twenty-ignore SEC-EVAL — naming the rule, not calling eval
    description:
      "Dynamic code execution. If any part of the argument comes from outside the program, it is arbitrary code execution.",
    fix: "Parse the input instead (JSON.parse, ast.literal_eval, a real parser) or remove the dynamic execution.",
  },
  {
    id: "SEC-SHELL",
    category: "security",
    severity: "error",
    title: "Shell execution with a constructed command",
    description:
      "os.system() or a subprocess call with shell=True runs a shell on a constructed string — command injection if any part is user-controlled.",
    fix: "Use subprocess with an argument list and shell=False.",
  },
  {
    id: "SEC-SQL-CONCAT",
    category: "security",
    severity: "error",
    title: "SQL built by string interpolation",
    description:
      "A SQL statement assembled with interpolation or concatenation. Values are not escaped, so this is SQL injection waiting for an apostrophe.",
    fix: "Use parameterised queries / placeholders for every value.",
  },
  {
    id: "SEC-INNERHTML",
    category: "security",
    severity: "error",
    title: "innerHTML assigned from a non-literal",
    description:
      "HTML is injected from a variable. If the value contains markup from outside the program, it is cross-site scripting.",
    fix: "Use textContent / createElement, or sanitise the HTML before assigning it.",
  },
  {
    id: "OBS-SILENT-CATCH",
    category: "observability",
    severity: "warning",
    title: "Catch block neither logs nor rethrows",
    description:
      "The error is handled (or ignored) without any logging call and without rethrowing. In production the failure leaves no trace at all.",
    fix: "Log the error with enough context to reproduce it, or rethrow.",
  },
  {
    id: "OBS-SILENT-EXCEPT",
    category: "observability",
    severity: "warning",
    title: "Except block neither logs nor re-raises",
    description:
      "The exception is handled without logging it and without re-raising. In production the failure leaves no trace at all.",
    fix: "Log the exception (logging.exception keeps the traceback) or re-raise.",
  },
  {
    id: "OBS-NO-LOGGING",
    category: "observability",
    severity: "warning",
    title: "Module does I/O but never logs",
    description:
      "The file makes network or database calls but contains no logging call anywhere. When it fails in production there is nothing to read.",
    fix: "Add logging at the boundaries: on entry, on failure, and on unexpected results.",
  },
  {
    id: "RES-NO-TIMEOUT",
    category: "resilience",
    severity: "warning",
    title: "Network call without a timeout",
    description:
      "A network request with no timeout can hang forever on a stalled connection, holding up the process (and, in an agent loop, the whole run).",
    fix: "Pass an explicit timeout (fetch: AbortSignal.timeout / signal; axios/requests/urlopen: timeout=).",
  },
];

export function getRule(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}

export function listRules(): Rule[] {
  return [...RULES];
}
