import { getRule } from "./rules";
import type { AuditReport, Finding } from "./types";

function countBy<T extends string>(
  items: Finding[],
  key: (f: Finding) => T,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of items) {
    const k = key(f);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function summaryLines(report: AuditReport): string[] {
  const errors = report.findings.filter((f) => f.severity === "error").length;
  const warnings = report.findings.length - errors;
  const byCategory = countBy(report.findings, (f) => f.category);
  const clean = report.scannedFiles - report.filesWithFindings;
  return [
    `files scanned: ${report.scannedFiles} (${clean} clean, ${report.filesWithFindings} with findings)`,
    `findings: ${report.findings.length} (${errors} errors, ${warnings} warnings)`,
    `by category: ${Object.entries(byCategory)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "none"}`,
  ];
}

export function renderText(report: AuditReport): string {
  const out: string[] = [];
  out.push(`last-twenty — ${report.target}`);
  out.push("");
  if (report.findings.length === 0) {
    out.push("No findings. The last 20% is covered — at least as far as these checks can tell.");
  } else {
    const byFile = new Map<string, Finding[]>();
    for (const f of report.findings) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }
    for (const [file, findings] of [...byFile.entries()].sort()) {
      out.push(file);
      for (const f of findings) {
        const rule = getRule(f.ruleId);
        out.push(
          `  ${f.line}:${f.column} [${f.severity.toUpperCase()}] ${f.ruleId} — ${f.message}`,
        );
        if (f.snippet) out.push(`      ${f.snippet}`);
        if (rule) out.push(`      fix: ${rule.fix}`);
      }
      out.push("");
    }
  }
  out.push(...summaryLines(report));
  return out.join("\n");
}

export function renderJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderMarkdown(report: AuditReport): string {
  const out: string[] = [];
  out.push(`# last-twenty report — ${report.target}`);
  out.push("");
  out.push(...summaryLines(report).map((l) => `- ${l}`));
  out.push("");
  if (report.findings.length === 0) {
    out.push("No findings.");
    return out.join("\n");
  }
  out.push("| File | Line | Severity | Rule | Finding |");
  out.push("| --- | ---: | --- | --- | --- |");
  for (const f of [...report.findings].sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line
  )) {
    const snippet = f.snippet.replace(/\|/g, "\\|").replace(/\n/g, " ");
    out.push(
      `| ${f.file} | ${f.line} | ${f.severity} | ${f.ruleId} | ${f.message} — \`${snippet}\` |`,
    );
  }
  return out.join("\n");
}

export function renderReport(report: AuditReport, format: string): string {
  if (format === "json") return renderJson(report);
  if (format === "markdown") return renderMarkdown(report);
  return renderText(report);
}
