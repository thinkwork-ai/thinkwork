import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  SkillSpectorReportSummary,
  SkillTrustFinding,
  SkillTrustInputFile,
} from "./catalog-report.js";

export interface SkillSpectorRunResult {
  scanner: SkillSpectorReportSummary;
  findings: SkillTrustFinding[];
}

export async function runSkillSpectorForFiles(input: {
  slug: string;
  files: SkillTrustInputFile[];
}): Promise<SkillSpectorRunResult> {
  const bin = process.env.SKILLSPECTOR_BIN?.trim();
  if (!bin) {
    return {
      scanner: { status: "not_configured" },
      findings: [],
    };
  }

  const root = await mkdtemp(path.join(tmpdir(), "thinkwork-skill-trust-"));
  try {
    const skillDir = path.join(root, input.slug);
    await mkdir(skillDir, { recursive: true });
    for (const file of input.files) {
      const target = path.join(skillDir, file.path);
      if (!target.startsWith(`${skillDir}${path.sep}`)) {
        throw new Error(`unsafe SkillSpector path: ${file.path}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }

    const reportPath = path.join(root, "skillspector-report.json");
    const args = [
      "scan",
      skillDir,
      "--no-llm",
      "--format",
      "json",
      "--output",
      reportPath,
    ];
    const completed = await runProcess(bin, args);
    let raw = "";
    try {
      raw = await readFile(reportPath, "utf8");
    } catch {
      raw = "";
    }

    if (raw.trim()) {
      return parseSkillSpectorJson(raw);
    }

    if (completed.exitCode !== 0) {
      return {
        scanner: {
          status: "failed",
          error:
            completed.stderr ||
            completed.stdout ||
            `SkillSpector exited ${completed.exitCode}`,
        },
        findings: [],
      };
    }
    return {
      scanner: {
        status: "failed",
        error: "SkillSpector did not produce a JSON report.",
      },
      findings: [],
    };
  } catch (error) {
    return {
      scanner: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      findings: [],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function parseSkillSpectorJson(raw: string): SkillSpectorRunResult {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const rawFindings = Array.isArray(parsed.issues)
    ? parsed.issues
    : Array.isArray(parsed.filtered_findings)
      ? parsed.filtered_findings
      : [];
  const findings = rawFindings
    .map((finding, index) =>
      coerceSkillSpectorFinding(finding, `skillspector-${index + 1}`),
    )
    .filter((finding): finding is SkillTrustFinding => finding !== null);
  const riskAssessment =
    parsed.risk_assessment && typeof parsed.risk_assessment === "object"
      ? (parsed.risk_assessment as Record<string, unknown>)
      : {};
  const metadata =
    parsed.metadata && typeof parsed.metadata === "object"
      ? (parsed.metadata as Record<string, unknown>)
      : {};

  return {
    scanner: {
      status: "completed",
      version:
        stringValue(metadata.skillspector_version) ??
        stringValue(parsed.version),
      riskScore:
        numberValue(riskAssessment.score) ?? numberValue(parsed.risk_score),
      riskSeverity:
        stringValue(riskAssessment.severity) ??
        stringValue(parsed.risk_severity),
      recommendation:
        stringValue(riskAssessment.recommendation) ??
        stringValue(parsed.risk_recommendation),
    },
    findings,
  };
}

function coerceSkillSpectorFinding(
  raw: unknown,
  fallbackId: string,
): SkillTrustFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const severity = normalizeSeverity(stringValue(record.severity));
  const location =
    record.location && typeof record.location === "object"
      ? (record.location as Record<string, unknown>)
      : {};
  return {
    id: stringValue(record.id) ?? stringValue(record.rule_id) ?? fallbackId,
    severity,
    category: stringValue(record.category) ?? "SkillSpector",
    message:
      stringValue(record.explanation) ??
      stringValue(record.message) ??
      stringValue(record.title) ??
      stringValue(record.finding) ??
      "SkillSpector finding",
    ...((stringValue(location.file) ?? stringValue(record.path))
      ? { path: stringValue(location.file) ?? stringValue(record.path) }
      : {}),
  };
}

function normalizeSeverity(
  raw: string | undefined,
): SkillTrustFinding["severity"] {
  const value = raw?.toLowerCase();
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "info"
  ) {
    return value;
  }
  return "info";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function runProcess(
  command: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
