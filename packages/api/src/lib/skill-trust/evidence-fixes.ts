import { createHash } from "node:crypto";
import { parseSkillMd, type SkillMdParsed } from "../skill-md-parser.js";
import { validateSkillCaseInput } from "../evals/skill-dataset.js";
import {
  buildCatalogSkillTrustReport,
  type SkillSpectorReportSummary,
  type SkillTrustFinding,
  type SkillTrustInputFile,
  type SkillTrustPipelineReport,
} from "./catalog-report.js";

export type SkillTrustEvidenceFixStepId =
  | "skillCard"
  | "evalDataset"
  | "benchmark"
  | "signature";

export type SkillTrustEvidenceFixStatus =
  | "generated"
  | "existing_artifact"
  | "prerequisite_missing"
  | "invalid_skill";

export interface GeneratedSkillTrustArtifact {
  path: string;
  content: Buffer;
  contentType: string;
}

export interface SkillTrustEvidenceFixResult {
  step: SkillTrustEvidenceFixStepId;
  status: SkillTrustEvidenceFixStatus;
  trustReport: SkillTrustPipelineReport;
  artifactPath?: string;
  artifact?: GeneratedSkillTrustArtifact;
  prerequisite?: string;
  signedPayloadHash?: string;
  message: string;
}

export interface SkillTrustSigner {
  sign(input: {
    slug: string;
    signedPayloadHash: string;
    files: SkillTrustInputFile[];
  }): Promise<Buffer | string>;
  verify(input: {
    slug: string;
    signedPayloadHash: string;
    signature: Buffer;
    files: SkillTrustInputFile[];
  }): Promise<boolean>;
}

export interface SkillCardSummaryGenerator {
  generate(input: {
    slug: string;
    displayName: string;
    description: string;
    body: string;
    allowedTools: string[];
  }): Promise<string>;
}

export interface FixSkillTrustEvidenceInput {
  slug: string;
  files: SkillTrustInputFile[];
  step: SkillTrustEvidenceFixStepId;
  scanner?: SkillSpectorReportSummary;
  scannerFindings?: SkillTrustFinding[];
  signer?: SkillTrustSigner | null;
  summaryGenerator?: SkillCardSummaryGenerator | null;
  now?: Date;
}

export async function fixSkillTrustEvidence(
  input: FixSkillTrustEvidenceInput,
): Promise<SkillTrustEvidenceFixResult> {
  const baseReport = buildCatalogSkillTrustReport({
    slug: input.slug,
    files: input.files,
    scanner: input.scanner,
    scannerFindings: input.scannerFindings,
    now: input.now,
  });

  const existingPath = existingArtifactPath(baseReport, input.step);
  if (existingPath) {
    return {
      step: input.step,
      status: "existing_artifact",
      trustReport: baseReport,
      artifactPath: existingPath,
      message: `${labelForStep(input.step)} already exists at ${existingPath}.`,
    };
  }

  const parsed = parseSourceSkill(input);
  if (!parsed.ok) {
    return {
      step: input.step,
      status: "invalid_skill",
      trustReport: baseReport,
      prerequisite: "valid_skill_md",
      message:
        "Cannot generate trust evidence until SKILL.md is present and valid.",
    };
  }

  if (input.step === "signature") {
    return signSkill(input, baseReport);
  }

  const artifact = await generateArtifactForStep(input, parsed.skill);
  const refreshedFiles = appendArtifact(input.files, artifact);
  const refreshedReport = buildCatalogSkillTrustReport({
    slug: input.slug,
    files: refreshedFiles,
    scanner: input.scanner,
    scannerFindings: input.scannerFindings,
    signature: staleExistingSignature(input.files, refreshedFiles),
    now: input.now,
  });

  return {
    step: input.step,
    status: "generated",
    trustReport: refreshedReport,
    artifactPath: artifact.path,
    artifact,
    message: `Generated ${artifact.path}.`,
  };
}

export function computeSignedPayloadHash(files: SkillTrustInputFile[]): string {
  const hash = createHash("sha256");
  for (const file of files
    .filter((item) => item.path.toLowerCase() !== "skill.oms.sig")
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function existingArtifactPath(
  report: SkillTrustPipelineReport,
  step: SkillTrustEvidenceFixStepId,
): string | null {
  switch (step) {
    case "skillCard":
      return report.artifactPaths.skillCard ?? null;
    case "evalDataset":
      return report.artifactPaths.evals[0] ?? null;
    case "benchmark":
      return report.artifactPaths.benchmark ?? null;
    case "signature":
      return report.artifactPaths.signature ?? null;
  }
}

function parseSourceSkill(
  input: FixSkillTrustEvidenceInput,
): { ok: true; skill: SkillMdParsed } | { ok: false } {
  const skillFile = input.files.find((file) => file.path === "SKILL.md");
  if (!skillFile) return { ok: false };
  const parsed = parseSkillMd(skillFile.content.toString("utf8"), "SKILL.md");
  if (!parsed.valid) return { ok: false };
  if (parsed.parsed.name !== input.slug) return { ok: false };
  return { ok: true, skill: parsed.parsed };
}

async function generateArtifactForStep(
  input: FixSkillTrustEvidenceInput,
  skill: SkillMdParsed,
): Promise<GeneratedSkillTrustArtifact> {
  switch (input.step) {
    case "skillCard":
      return {
        path: "skill-card.md",
        content: Buffer.from(await renderSkillCard(input, skill), "utf8"),
        contentType: "text/markdown; charset=utf-8",
      };
    case "evalDataset": {
      const content = renderSmokeEval(input.slug, skill);
      const valid = validateSkillCaseInput(
        { fileName: "smoke.json", content },
        input.slug,
      );
      if ("skip" in valid) {
        throw new Error(`Generated smoke eval did not validate: ${valid.skip}`);
      }
      return {
        path: "evals/smoke.json",
        content: Buffer.from(content, "utf8"),
        contentType: "application/json; charset=utf-8",
      };
    }
    case "benchmark":
      return {
        path: "BENCHMARK.md",
        content: Buffer.from(renderBenchmark(input, skill), "utf8"),
        contentType: "text/markdown; charset=utf-8",
      };
    case "signature":
      throw new Error("signature generation is handled separately");
  }
}

async function renderSkillCard(
  input: FixSkillTrustEvidenceInput,
  skill: SkillMdParsed,
): Promise<string> {
  const displayName = displayNameForSkill(skill);
  const summary = await generateSummary(input, skill, displayName);
  const tools =
    skill.allowedToolsDeclared.length > 0
      ? skill.allowedToolsDeclared.map((tool) => `- \`${tool}\``).join("\n")
      : "- No tools declared.";
  const license =
    typeof skill.internal?.license === "string" && skill.internal.license.trim()
      ? skill.internal.license.trim()
      : "Not specified";
  const author =
    typeof skill.internal?.metadata === "object" &&
    skill.internal.metadata !== null &&
    typeof (skill.internal.metadata as Record<string, unknown>).author ===
      "string"
      ? ((skill.internal.metadata as Record<string, unknown>).author as string)
      : "Not specified";

  return [
    `# ${displayName} Skill Card`,
    "",
    "> Generated by ThinkWork from the catalog skill source for operator review. Review and replace this starter card before relying on it as externally audited evidence.",
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Skill Identity",
    "",
    `- Name: \`${skill.name}\``,
    `- Description: ${skill.description}`,
    `- License: ${license}`,
    `- Owner: ${author}`,
    "",
    "## Intended Use",
    "",
    `Use this skill when an operator or agent needs the behavior described by \`${skill.name}\`. The skill should be invoked only for requests that match its description and documented body.`,
    "",
    "## Declared Tools",
    "",
    tools,
    "",
    "## Output Expectations",
    "",
    "The skill should produce task-specific assistance consistent with its SKILL.md instructions. Generated outputs should remain reviewable by the requester or operator.",
    "",
    "## Risk Notes",
    "",
    "- This card is starter release evidence generated from allowlisted SKILL.md metadata and prose.",
    "- It does not certify runtime behavior, external data access, or benchmark performance.",
    "- Run SkillSpector, review bundled evals, and complete signing before treating the release as fully trusted.",
    "",
    "## Provenance",
    "",
    "- Generated by ThinkWork.",
    `- Source content hash: \`${buildCatalogSkillTrustReport({ slug: input.slug, files: input.files, scanner: input.scanner, scannerFindings: input.scannerFindings, now: input.now }).contentHash}\``,
  ].join("\n");
}

async function generateSummary(
  input: FixSkillTrustEvidenceInput,
  skill: SkillMdParsed,
  displayName: string,
): Promise<string> {
  if (input.summaryGenerator) {
    try {
      const generated = await input.summaryGenerator.generate({
        slug: skill.name,
        displayName,
        description: skill.description,
        body: skill.body,
        allowedTools: skill.allowedToolsDeclared,
      });
      if (generated.trim()) return generated.trim();
    } catch {
      // Fall through to a deterministic summary. Evidence generation should not
      // fail solely because the optional model path is unavailable.
    }
  }

  const toolPhrase =
    skill.allowedToolsDeclared.length > 0
      ? ` It declares ${skill.allowedToolsDeclared.length} tool${skill.allowedToolsDeclared.length === 1 ? "" : "s"}: ${skill.allowedToolsDeclared.join(", ")}.`
      : "";
  return `${displayName} helps agents ${skill.description.trim()}${toolPhrase}`;
}

function renderSmokeEval(slug: string, skill: SkillMdParsed): string {
  return `${JSON.stringify(
    {
      case_id: "smoke",
      name: `${displayNameForSkill(skill)} smoke test`,
      query: `Use the ${slug} skill for a representative request and describe the expected deliverable.`,
      expected_behavior:
        "The response should follow the skill instructions, stay within the declared scope, and produce the deliverable described by SKILL.md.",
      rubric:
        "Pass if the response follows the skill instructions, addresses the representative request, avoids unsupported claims, and keeps the output reviewable by an operator.",
      tags: ["origin:thinkwork-generated", `skill:${slug}`, "trust:starter"],
      provenance: "Generated by ThinkWork",
    },
    null,
    2,
  )}\n`;
}

function renderBenchmark(
  input: FixSkillTrustEvidenceInput,
  skill: SkillMdParsed,
): string {
  const sourceHash = buildCatalogSkillTrustReport({
    slug: input.slug,
    files: input.files,
    scanner: input.scanner,
    scannerFindings: input.scannerFindings,
    now: input.now,
  }).contentHash;

  return [
    `# ${displayNameForSkill(skill)} Benchmark`,
    "",
    "> Generated by ThinkWork as starter benchmark evidence. This file records benchmark readiness; it does not claim a measured pass rate.",
    "",
    "## Scope",
    "",
    `- Skill: \`${skill.name}\``,
    `- Source content hash: \`${sourceHash}\``,
    "- Eval dataset path: `evals/smoke.json`",
    "",
    "## Current State",
    "",
    "- Measured benchmark run: not recorded.",
    "- Comparative uplift: not measured.",
    "- Pass rate: not measured.",
    "",
    "## Recommended Measurement",
    "",
    "Run the bundled smoke eval and any operator-curated cases in an isolated skill eval environment before claiming benchmark performance.",
    "",
    "## Provenance",
    "",
    "- Generated by ThinkWork.",
  ].join("\n");
}

async function signSkill(
  input: FixSkillTrustEvidenceInput,
  baseReport: SkillTrustPipelineReport,
): Promise<SkillTrustEvidenceFixResult> {
  if (!input.signer) {
    return {
      step: "signature",
      status: "prerequisite_missing",
      trustReport: buildCatalogSkillTrustReport({
        slug: input.slug,
        files: input.files,
        scanner: input.scanner,
        scannerFindings: input.scannerFindings,
        signature: { status: "missing_signing_config" },
        now: input.now,
      }),
      prerequisite: "signing_config",
      message:
        "Signing is not configured; no skill.oms.sig file was generated.",
    };
  }

  const signedPayloadHash = computeSignedPayloadHash(input.files);
  const signature = Buffer.from(
    await input.signer.sign({
      slug: input.slug,
      signedPayloadHash,
      files: input.files,
    }),
  );
  const verified =
    signature.byteLength > 0 &&
    (await input.signer.verify({
      slug: input.slug,
      signedPayloadHash,
      signature,
      files: input.files,
    }));

  if (!verified) {
    return {
      step: "signature",
      status: "prerequisite_missing",
      trustReport: buildCatalogSkillTrustReport({
        slug: input.slug,
        files: input.files,
        scanner: input.scanner,
        scannerFindings: input.scannerFindings,
        signature: { status: "invalid", signedPayloadHash },
        now: input.now,
      }),
      prerequisite: "valid_signature",
      signedPayloadHash,
      message:
        "The configured signer produced a signature that did not verify.",
    };
  }

  const artifact = {
    path: "skill.oms.sig",
    content: signature,
    contentType: "application/octet-stream",
  };
  return {
    step: "signature",
    status: "generated",
    trustReport: buildCatalogSkillTrustReport({
      slug: input.slug,
      files: appendArtifact(input.files, artifact),
      scanner: input.scanner,
      scannerFindings: input.scannerFindings,
      signature: { status: "verified", signedPayloadHash },
      now: input.now,
    }),
    artifactPath: artifact.path,
    artifact,
    signedPayloadHash,
    message: "Generated and verified skill.oms.sig.",
  };
}

function staleExistingSignature(
  before: SkillTrustInputFile[],
  after: SkillTrustInputFile[],
): { status: "stale"; signedPayloadHash: string } | undefined {
  if (!before.some((file) => file.path.toLowerCase() === "skill.oms.sig")) {
    return undefined;
  }
  const beforeHash = computeSignedPayloadHash(before);
  const afterHash = computeSignedPayloadHash(after);
  if (beforeHash === afterHash) return undefined;
  return { status: "stale", signedPayloadHash: afterHash };
}

function appendArtifact(
  files: SkillTrustInputFile[],
  artifact: GeneratedSkillTrustArtifact,
): SkillTrustInputFile[] {
  return [...files, { path: artifact.path, content: artifact.content }];
}

function displayNameForSkill(skill: SkillMdParsed): string {
  const internalDisplayName = skill.internal?.display_name;
  if (typeof internalDisplayName === "string" && internalDisplayName.trim()) {
    return internalDisplayName.trim();
  }
  return skill.name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForStep(step: SkillTrustEvidenceFixStepId): string {
  switch (step) {
    case "skillCard":
      return "Skill card";
    case "evalDataset":
      return "Eval dataset";
    case "benchmark":
      return "Benchmark";
    case "signature":
      return "Signature";
  }
}
