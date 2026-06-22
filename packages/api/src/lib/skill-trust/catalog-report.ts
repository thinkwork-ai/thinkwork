import { createHash } from "node:crypto";
import { parseSkillMd } from "../skill-md-parser.js";

export type SkillTrustStatus = "passed" | "review" | "blocked" | "failed";

export interface SkillTrustFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  message: string;
  path?: string;
}

export interface SkillSpectorReportSummary {
  status: "completed" | "not_configured" | "failed";
  version?: string;
  riskScore?: number | null;
  riskSeverity?: string | null;
  recommendation?: string | null;
  error?: string;
}

export interface SkillTrustPipelineReport {
  slug: string;
  contentHash: string;
  generatedAt: string;
  status: SkillTrustStatus;
  summary: string;
  spec: {
    status: "passed" | "failed";
    name?: string;
    description?: string;
    allowedTools: string[];
    errors: string[];
  };
  scanner: SkillSpectorReportSummary;
  severityCounts: Record<SkillTrustFinding["severity"], number>;
  findings: SkillTrustFinding[];
  evidence: {
    skillCard: "present" | "missing";
    evalDataset: "present" | "missing";
    benchmark: "present" | "missing";
    signature: "verified" | "present_unverified" | "missing";
  };
  artifactPaths: {
    skillCard?: string;
    evals: string[];
    benchmark?: string;
    signature?: string;
  };
}

export interface SkillTrustInputFile {
  path: string;
  content: Buffer;
}

export function buildCatalogSkillTrustReport(input: {
  slug: string;
  files: SkillTrustInputFile[];
  scanner?: SkillSpectorReportSummary;
  scannerFindings?: SkillTrustFinding[];
  now?: Date;
}): SkillTrustPipelineReport {
  const skillMd = input.files.find((file) => file.path === "SKILL.md");
  const specErrors: string[] = [];
  let specName: string | undefined;
  let specDescription: string | undefined;
  let allowedTools: string[] = [];

  if (!skillMd) {
    specErrors.push("SKILL.md is missing.");
  } else {
    const parsed = parseSkillMd(skillMd.content.toString("utf8"), "SKILL.md");
    if (parsed.valid) {
      specName = parsed.parsed.name;
      specDescription = parsed.parsed.description;
      allowedTools = parsed.parsed.allowedToolsDeclared;
      if (parsed.parsed.name !== input.slug) {
        specErrors.push(
          `SKILL.md name '${parsed.parsed.name}' does not match catalog slug '${input.slug}'.`,
        );
      }
    } else {
      specErrors.push(...parsed.errors.map((error) => error.message));
    }
  }

  const artifactPaths = detectArtifactPaths(input.files);
  const scanner = input.scanner ?? { status: "not_configured" as const };
  const findings = normalizeFindings(input.scannerFindings ?? []);
  const severityCounts = countFindings(findings);
  const hasBlockingFindings =
    severityCounts.critical > 0 || severityCounts.high > 0;

  const evidence = {
    skillCard: artifactPaths.skillCard
      ? ("present" as const)
      : ("missing" as const),
    evalDataset:
      artifactPaths.evals.length > 0
        ? ("present" as const)
        : ("missing" as const),
    benchmark: artifactPaths.benchmark
      ? ("present" as const)
      : ("missing" as const),
    signature: artifactPaths.signature
      ? ("present_unverified" as const)
      : ("missing" as const),
  };

  const status: SkillTrustStatus =
    specErrors.length > 0 || scanner.status === "failed"
      ? "failed"
      : hasBlockingFindings
        ? "blocked"
        : scanner.status === "completed"
          ? "passed"
          : "review";

  return {
    slug: input.slug,
    contentHash: hashFiles(input.files),
    generatedAt: (input.now ?? new Date()).toISOString(),
    status,
    summary: summarizeStatus(status, scanner, evidence, severityCounts),
    spec: {
      status: specErrors.length > 0 ? "failed" : "passed",
      ...(specName ? { name: specName } : {}),
      ...(specDescription ? { description: specDescription } : {}),
      allowedTools,
      errors: specErrors,
    },
    scanner,
    severityCounts,
    findings,
    evidence,
    artifactPaths,
  };
}

function detectArtifactPaths(files: SkillTrustInputFile[]) {
  const paths = files.map((file) => file.path);
  return {
    skillCard: paths.find((path) => /^skill[-_ ]card\.md$/iu.test(path)),
    evals: paths
      .filter((path) =>
        /^(evals\/.+\.json|eval\/.+\.json|benchmark\/evals\.json)$/iu.test(
          path,
        ),
      )
      .sort(),
    benchmark: paths.find((path) => path.toLowerCase() === "benchmark.md"),
    signature: paths.find((path) => path.toLowerCase() === "skill.oms.sig"),
  };
}

function hashFiles(files: SkillTrustInputFile[]): string {
  const hash = createHash("sha256");
  for (const file of files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function normalizeFindings(findings: SkillTrustFinding[]): SkillTrustFinding[] {
  return findings.map((finding, index) => ({
    ...finding,
    id: finding.id || `finding-${index + 1}`,
  }));
}

function countFindings(
  findings: SkillTrustFinding[],
): Record<SkillTrustFinding["severity"], number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function summarizeStatus(
  status: SkillTrustStatus,
  scanner: SkillSpectorReportSummary,
  evidence: SkillTrustPipelineReport["evidence"],
  counts: Record<SkillTrustFinding["severity"], number>,
): string {
  if (status === "failed") return "Trust pipeline could not complete.";
  if (status === "blocked") {
    return `Trust pipeline found ${counts.critical + counts.high} blocking finding${
      counts.critical + counts.high === 1 ? "" : "s"
    }.`;
  }
  if (scanner.status === "not_configured") {
    return "Static trust evidence is available; SkillSpector is not configured in this environment.";
  }
  const missing = Object.entries(evidence)
    .filter(([, value]) => value === "missing")
    .map(([key]) => key);
  if (missing.length > 0) {
    return `SkillSpector passed; missing release evidence: ${missing.join(", ")}.`;
  }
  return "SkillSpector passed and release evidence is present.";
}
