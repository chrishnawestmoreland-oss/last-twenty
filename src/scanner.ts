import * as fs from "fs";
import * as path from "path";
import { languageForFile } from "./check";

const SKIP_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  "vendor",
  "target",
]);

const MAX_FILE_BYTES = 512 * 1024;

export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(out + "$");
}

function matchesAny(rel: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(rel) || re.test(path.basename(rel)));
}

/** Read a .gitignore in `dir` and turn its patterns into ignore regexes. */
export function readGitignore(dir: string): RegExp[] {
  const out: RegExp[] = [];
  const file = path.join(dir, ".gitignore");
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const pattern = line.endsWith("/") ? line.slice(0, -1) : line;
    out.push(globToRegExp(pattern));
    // A bare directory pattern should also match everything under it.
    if (!pattern.includes("*")) out.push(globToRegExp(pattern + "/**"));
  }
  return out;
}

export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8192).includes(0);
}

/**
 * Walk `root` and return the relative paths of scannable source files
 * (TypeScript/JavaScript/Python), skipping build output, dependencies and
 * ignored paths. Returns paths relative to `root`, POSIX-style.
 */
export function collectFiles(root: string, ignoreGlobs: string[]): string[] {
  const ignoreRes = ignoreGlobs.map(globToRegExp);
  const gitignoreRes = readGitignore(root);
  const all = [...ignoreRes, ...gitignoreRes];
  const found: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { // last-twenty-ignore OBS-SILENT-CATCH — unreadable directory: skip it by design
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== ".") continue;
        if (matchesAny(rel, all)) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (!languageForFile(entry.name)) continue;
        if (matchesAny(rel, all)) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch { // last-twenty-ignore OBS-SILENT-CATCH — file vanished between listing and stat: skip it
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) continue;
        found.push(rel);
      }
    }
  }

  walk(root);
  return found.sort();
}

/** Read a file under `root`; returns null for binary or unreadable files. */
export function readSourceFile(root: string, rel: string): string | null {
  const full = path.join(root, rel);
  let buf: Buffer;
  try {
    buf = fs.readFileSync(full);
  } catch { // last-twenty-ignore OBS-SILENT-CATCH — unreadable file: caller treats null as "skip it"
    return null;
  }
  if (isBinary(buf)) return null;
  return buf.toString("utf8");
}
