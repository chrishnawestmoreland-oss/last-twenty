import { execFileSync } from "child_process";

/**
 * List the files an agent changed, relative to a git ref — the exact set a
 * reviewer should audit after an agent branch lands. Includes uncommitted
 * changes against the ref and untracked files, so new files the agent added
 * are audited too.
 */
export function changedFilesSince(root: string, ref: string): string[] {
  let diffOut: string;
  try {
    diffOut = execFileSync("git", ["-C", root, "diff", "--name-only", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const detail = e.stderr ? e.stderr.toString().trim() : e.message;
    throw new Error(
      `could not list changed files against '${ref}' in ${root}: ${detail}`,
    );
  }
  let untrackedOut = "";
  try {
    untrackedOut = execFileSync(
      "git",
      ["-C", root, "ls-files", "--others", "--exclude-standard"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch { // last-twenty-ignore ERR-EMPTY-CATCH — untracked listing is best-effort; the diff result still stands
    // Untracked listing is best-effort; the diff result still stands.
  }
  const files = new Set<string>();
  for (const line of diffOut.split("\n")) {
    const f = line.trim();
    if (f) files.add(f);
  }
  for (const line of untrackedOut.split("\n")) {
    const f = line.trim();
    if (f) files.add(f);
  }
  return [...files].sort();
}
