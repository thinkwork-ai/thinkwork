import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

import { parseSkillMdInternal } from "../../api/src/lib/skill-md-parser.js";

export const RUNBOOK_SKILL_KIND = "computer-runbook";
export const RUNBOOK_SKILL_CONTRACT_PATH = "references/thinkwork-runbook.json";

export const RUNBOOK_CAPABILITY_ROLES = [
  "research",
  "analysis",
  "artifact_build",
  "map_build",
  "validation",
] as const;

const allowedCapabilityRoles = new Set<string>(RUNBOOK_CAPABILITY_ROLES);

export type RunbookSkillContractIssue = {
  code:
    | "invalid-skill-md"
    | "missing-contract"
    | "invalid-contract-json"
    | "invalid-contract-shape"
    | "missing-reference"
    | "unknown-capability-role";
  message: string;
  path?: string;
};

export type RunbookSkillContractValidation = {
  slug: string;
  isRunbookSkill: boolean;
  contractPath: string | null;
  issues: RunbookSkillContractIssue[];
};

type ContractObject = Record<string, unknown>;

export function validateRunbookSkillContract(
  skillDirectory: string,
): RunbookSkillContractValidation {
  const skillMdPath = join(skillDirectory, "SKILL.md");
  const slug = skillDirectory.split(sep).filter(Boolean).at(-1) ?? "";
  const issues: RunbookSkillContractIssue[] = [];

  if (!existsSync(skillMdPath)) {
    return {
      slug,
      isRunbookSkill: false,
      contractPath: null,
      issues: [
        {
          code: "invalid-skill-md",
          message: `missing SKILL.md at ${skillMdPath}`,
          path: "SKILL.md",
        },
      ],
    };
  }

  const source = readFileSync(skillMdPath, "utf8");
  const parsed = parseSkillMdInternal(source, skillMdPath);
  if (!parsed.valid) {
    return {
      slug,
      isRunbookSkill: false,
      contractPath: null,
      issues: parsed.errors.map((error) => ({
        code: "invalid-skill-md",
        message: error.message,
        path: "SKILL.md",
      })),
    };
  }

  if (!isRunbookSkillMetadata(parsed.parsed.data.metadata)) {
    return {
      slug: skillSlug(parsed.parsed.data.name, slug),
      isRunbookSkill: false,
      contractPath: null,
      issues: [],
    };
  }

  const contractPath = contractPathFromMetadata(parsed.parsed.data.metadata);
  if (!isSafeRelativePath(contractPath)) {
    return {
      slug: skillSlug(parsed.parsed.data.name, slug),
      isRunbookSkill: true,
      contractPath,
      issues: [
        {
          code: "invalid-contract-shape",
          message: `runbook skill contract path must be relative and inside the skill: ${contractPath}`,
          path: contractPath,
        },
      ],
    };
  }

  const contractFullPath = join(skillDirectory, contractPath);
  if (!existsSync(contractFullPath) || !statSync(contractFullPath).isFile()) {
    return {
      slug: skillSlug(parsed.parsed.data.name, slug),
      isRunbookSkill: true,
      contractPath,
      issues: [
        {
          code: "missing-contract",
          message: `runbook skill contract not found at ${contractPath}`,
          path: contractPath,
        },
      ],
    };
  }

  let contract: unknown;
  try {
    contract = JSON.parse(readFileSync(contractFullPath, "utf8"));
  } catch (error) {
    issues.push({
      code: "invalid-contract-json",
      message: `runbook skill contract has invalid JSON: ${(error as Error).message}`,
      path: contractPath,
    });
    return {
      slug: skillSlug(parsed.parsed.data.name, slug),
      isRunbookSkill: true,
      contractPath,
      issues,
    };
  }

  validateContractShape(contract, contractPath, issues);
  validateReferencedFiles(contract, skillDirectory, contractPath, issues);
  validateCapabilityRoles(contract, contractPath, issues);

  return {
    slug: skillSlug(parsed.parsed.data.name, slug),
    isRunbookSkill: true,
    contractPath,
    issues,
  };
}

function isRunbookSkillMetadata(metadata: unknown): metadata is ContractObject {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as ContractObject).thinkwork_kind === RUNBOOK_SKILL_KIND;
}

function contractPathFromMetadata(metadata: ContractObject) {
  const candidate = metadata.thinkwork_runbook_contract;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }
  return RUNBOOK_SKILL_CONTRACT_PATH;
}

function skillSlug(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function validateContractShape(
  contract: unknown,
  contractPath: string,
  issues: RunbookSkillContractIssue[],
) {
  if (!isObject(contract)) {
    issues.push({
      code: "invalid-contract-shape",
      message: "runbook skill contract must be a JSON object",
      path: contractPath,
    });
    return;
  }

  requireObject(contract, "routing", contractPath, issues);
  requireNonEmptyStringArray(
    contract.routing,
    "explicitAliases",
    contractPath,
    issues,
  );
  requireNonEmptyStringArray(
    contract.routing,
    "triggerExamples",
    contractPath,
    issues,
  );
  requireObject(contract, "confirmation", contractPath, issues);
  requireNonEmptyString(contract.confirmation, "title", contractPath, issues);
  requireNonEmptyString(contract.confirmation, "summary", contractPath, issues);
  requireNonEmptyStringArray(
    contract.confirmation,
    "expectedOutputs",
    contractPath,
    issues,
  );
  requireNonEmptyArray(contract, "phases", contractPath, issues);

  if (Array.isArray(contract.phases)) {
    for (const [index, phase] of contract.phases.entries()) {
      const phasePath = `${contractPath}:phases[${index}]`;
      if (!isObject(phase)) {
        issues.push({
          code: "invalid-contract-shape",
          message: "phase must be an object",
          path: phasePath,
        });
        continue;
      }
      requireNonEmptyString(phase, "id", phasePath, issues);
      requireNonEmptyString(phase, "title", phasePath, issues);
      requireNonEmptyString(phase, "guidance", phasePath, issues);
      requireNonEmptyStringArray(phase, "capabilityRoles", phasePath, issues);
      requireNonEmptyStringArray(phase, "taskSeeds", phasePath, issues);
      if (
        "dependsOn" in phase &&
        !isStringArray((phase as ContractObject).dependsOn)
      ) {
        issues.push({
          code: "invalid-contract-shape",
          message: "phase.dependsOn must be an array of strings when present",
          path: phasePath,
        });
      }
    }
  }
}

function validateReferencedFiles(
  contract: unknown,
  skillDirectory: string,
  contractPath: string,
  issues: RunbookSkillContractIssue[],
) {
  if (!isObject(contract)) return;

  for (const referencePath of referencedPaths(contract)) {
    const issuePath = `${contractPath}:${referencePath}`;
    if (!isSafeRelativePath(referencePath)) {
      issues.push({
        code: "missing-reference",
        message: `runbook contract reference must be a relative path inside the skill: ${referencePath}`,
        path: issuePath,
      });
      continue;
    }

    const fullPath = join(skillDirectory, referencePath);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      issues.push({
        code: "missing-reference",
        message: `runbook contract references missing file ${referencePath}`,
        path: issuePath,
      });
    }
  }
}

function referencedPaths(contract: ContractObject) {
  const paths: string[] = [];
  if (Array.isArray(contract.phases)) {
    for (const phase of contract.phases) {
      if (isObject(phase) && typeof phase.guidance === "string") {
        paths.push(phase.guidance);
      }
    }
  }

  const assets = contract.assets;
  if (isStringArray(assets)) paths.push(...assets);

  if (Array.isArray(contract.outputs)) {
    for (const output of contract.outputs) {
      if (isObject(output) && typeof output.asset === "string") {
        paths.push(output.asset);
      }
    }
  }
  return paths;
}

function validateCapabilityRoles(
  contract: unknown,
  contractPath: string,
  issues: RunbookSkillContractIssue[],
) {
  if (!isObject(contract) || !Array.isArray(contract.phases)) return;
  for (const [index, phase] of contract.phases.entries()) {
    if (!isObject(phase) || !Array.isArray(phase.capabilityRoles)) continue;
    for (const role of phase.capabilityRoles) {
      if (typeof role !== "string") continue;
      if (
        allowedCapabilityRoles.has(role) ||
        role.startsWith("experimental:")
      ) {
        continue;
      }
      issues.push({
        code: "unknown-capability-role",
        message: `unknown runbook capability role "${role}"`,
        path: `${contractPath}:phases[${index}].capabilityRoles`,
      });
    }
  }
}

function requireObject(
  value: ContractObject,
  field: string,
  path: string,
  issues: RunbookSkillContractIssue[],
) {
  if (!isObject(value[field])) {
    issues.push({
      code: "invalid-contract-shape",
      message: `${field} must be an object`,
      path,
    });
  }
}

function requireNonEmptyArray(
  value: ContractObject,
  field: string,
  path: string,
  issues: RunbookSkillContractIssue[],
) {
  if (!Array.isArray(value[field]) || value[field].length === 0) {
    issues.push({
      code: "invalid-contract-shape",
      message: `${field} must be a non-empty array`,
      path,
    });
  }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  path: string,
  issues: RunbookSkillContractIssue[],
) {
  if (
    !isObject(value) ||
    typeof value[field] !== "string" ||
    !value[field].trim()
  ) {
    issues.push({
      code: "invalid-contract-shape",
      message: `${field} must be a non-empty string`,
      path,
    });
  }
}

function requireNonEmptyStringArray(
  value: unknown,
  field: string,
  path: string,
  issues: RunbookSkillContractIssue[],
) {
  if (
    !isObject(value) ||
    !isStringArray(value[field]) ||
    value[field].length === 0
  ) {
    issues.push({
      code: "invalid-contract-shape",
      message: `${field} must be a non-empty array of strings`,
      path,
    });
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isObject(value: unknown): value is ContractObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeRelativePath(value: string) {
  if (!value || isAbsolute(value)) return false;
  const normalized = normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}
