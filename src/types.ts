export type Severity = "error" | "warning";
export type Category = "error-handling" | "security" | "observability" | "resilience";
export type Language = "js" | "py";

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  fix: string;
}

export interface Finding {
  file: string;
  line: number;
  column: number;
  ruleId: string;
  category: Category;
  severity: Severity;
  message: string;
  snippet: string;
}

export interface FileResult {
  file: string;
  language: Language;
  findings: Finding[];
}

export interface AuditReport {
  target: string;
  scannedFiles: number;
  filesWithFindings: number;
  findings: Finding[];
  /** Files scanned, for --since runs the list of changed files that were checked. */
  files: string[];
  startedAt: string;
  finishedAt: string;
}

export interface AuditOptions {
  target: string;
  sinceRef?: string;
  only?: string[];
  ignoreGlobs?: string[];
  failOn: "error" | "warning" | "none";
}
