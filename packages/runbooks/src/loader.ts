import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  RunbookValidationError,
  type RunbookDefinition,
  validateRunbookDefinition,
} from "./schema.js";

export const defaultRunbooksRoot = fileURLToPath(resolveDefaultRunbooksRoot());
const RUNBOOK_SKILL_KIND = "computer-runbook";
const RUNBOOK_SKILL_CONTRACT_PATH = "references/thinkwork-runbook.json";

export function resolveDefaultRunbooksRoot(importMetaUrl = import.meta.url) {
  const sourceSkillCatalogRoot = fileURLToPath(
    new URL("../../skill-catalog", importMetaUrl),
  );
  const bundledSkillCatalogRoot = fileURLToPath(
    new URL("./skill-catalog", importMetaUrl),
  );
  const sourceRoot = fileURLToPath(new URL("../runbooks", importMetaUrl));
  const bundledRoot = fileURLToPath(new URL("./runbooks", importMetaUrl));

  if (existsSync(sourceSkillCatalogRoot)) {
    return new URL("../../skill-catalog", importMetaUrl);
  }
  if (existsSync(bundledSkillCatalogRoot)) {
    return new URL("./skill-catalog", importMetaUrl);
  }
  if (existsSync(sourceRoot)) return new URL("../runbooks", importMetaUrl);
  if (existsSync(bundledRoot)) return new URL("./runbooks", importMetaUrl);
  return new URL("../../skill-catalog", importMetaUrl);
}

export function loadRunbookFromDirectory(directory: string): RunbookDefinition {
  if (existsSync(join(directory, "SKILL.md"))) {
    return loadRunbookFromSkillDirectory(directory);
  }
  return loadLegacyRunbookFromDirectory(directory);
}

function loadLegacyRunbookFromDirectory(directory: string): RunbookDefinition {
  const yamlPath = join(directory, "runbook.yaml");
  if (!existsSync(yamlPath)) {
    throw new RunbookValidationError("Invalid runbook definition", [
      `missing runbook.yaml at ${yamlPath}`,
    ]);
  }

  const parsed = parse(readFileSync(yamlPath, "utf8"));
  const runbook = validateRunbookDefinition(parsed);
  const issues: string[] = [];
  const phases = runbook.phases.map((phase) => {
    const guidancePath = join(directory, "phases", phase.guidance);
    if (!existsSync(guidancePath)) {
      issues.push(
        `phase "${phase.id}" guidance file "${phase.guidance}" was not found`,
      );
      return phase;
    }
    return {
      ...phase,
      guidanceMarkdown: readFileSync(guidancePath, "utf8"),
    };
  });

  if (issues.length > 0) {
    throw new RunbookValidationError("Invalid runbook definition", issues);
  }

  return { ...runbook, phases };
}

export function loadRunbooks(root = defaultRunbooksRoot) {
  if (!existsSync(root)) return [];
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter(isRunbookDirectory)
    .sort();
  return directories.map((directory) => loadRunbookFromDirectory(directory));
}

function loadRunbookFromSkillDirectory(directory: string): RunbookDefinition {
  const skillMdPath = join(directory, "SKILL.md");
  const frontmatter = parseSkillFrontmatter(skillMdPath);
  if (!isRunbookSkillFrontmatter(frontmatter)) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `SKILL.md at ${skillMdPath} is not marked as a Computer runbook skill`,
    ]);
  }

  const contractPath = runbookContractPath(frontmatter);
  if (!isSafeRelativePath(contractPath)) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `runbook skill contract path must be relative and inside the skill: ${contractPath}`,
    ]);
  }

  const contractFullPath = join(directory, contractPath);
  if (!existsSync(contractFullPath) || !statSync(contractFullPath).isFile()) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `missing runbook skill contract at ${contractPath}`,
    ]);
  }

  const contract = parseJsonObject(contractFullPath);
  const runbook = validateRunbookDefinition(
    definitionFromSkillContract(frontmatter, contract),
  );
  const issues: string[] = [];
  const phases = runbook.phases.map((phase) => {
    if (!isSafeRelativePath(phase.guidance)) {
      issues.push(
        `phase "${phase.id}" guidance file "${phase.guidance}" must be relative and inside the skill`,
      );
      return phase;
    }
    const guidancePath = join(directory, phase.guidance);
    if (!existsSync(guidancePath) || !statSync(guidancePath).isFile()) {
      issues.push(
        `phase "${phase.id}" guidance file "${phase.guidance}" was not found`,
      );
      return phase;
    }
    return {
      ...phase,
      guidanceMarkdown: readFileSync(guidancePath, "utf8"),
    };
  });

  if (issues.length > 0) {
    throw new RunbookValidationError("Invalid runbook skill", issues);
  }

  return { ...runbook, phases };
}

function definitionFromSkillContract(
  frontmatter: Record<string, unknown>,
  contract: Record<string, unknown>,
) {
  const confirmation = objectField(contract, "confirmation");
  return {
    slug: stringField(frontmatter, "name"),
    version:
      optionalStringField(contract, "sourceVersion") ||
      optionalStringField(frontmatter, "version") ||
      "0.1.0",
    catalog: {
      displayName:
        optionalStringField(frontmatter, "display_name") ||
        optionalStringField(frontmatter, "displayName") ||
        stringField(frontmatter, "name"),
      description: stringField(frontmatter, "description"),
      category: optionalStringField(frontmatter, "category") || "artifact",
    },
    routing: objectField(contract, "routing"),
    inputs: arrayField(contract, "inputs"),
    approval: confirmation,
    phases: arrayField(contract, "phases"),
    outputs: arrayField(contract, "outputs"),
    overrides: objectField(contract, "overrides"),
  };
}

function isRunbookDirectory(directory: string) {
  if (existsSync(join(directory, "runbook.yaml"))) return true;
  const skillMdPath = join(directory, "SKILL.md");
  if (!existsSync(skillMdPath)) return false;
  try {
    return isRunbookSkillFrontmatter(parseSkillFrontmatter(skillMdPath));
  } catch {
    return false;
  }
}

function parseSkillFrontmatter(path: string): Record<string, unknown> {
  const source = readFileSync(path, "utf8");
  if (!source.startsWith("---\n")) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `missing SKILL.md frontmatter at ${path}`,
    ]);
  }
  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `unterminated SKILL.md frontmatter at ${path}`,
    ]);
  }
  let parsed: unknown;
  try {
    parsed = parse(source.slice(4, end));
  } catch (error) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `SKILL.md frontmatter at ${path} is invalid YAML: ${(error as Error).message}`,
    ]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `SKILL.md frontmatter at ${path} must be an object`,
    ]);
  }
  return parsed as Record<string, unknown>;
}

function isRunbookSkillFrontmatter(frontmatter: Record<string, unknown>) {
  const metadata = frontmatter.metadata;
  return (
    Boolean(metadata) &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).thinkwork_kind === RUNBOOK_SKILL_KIND
  );
}

function runbookContractPath(frontmatter: Record<string, unknown>) {
  const metadata = frontmatter.metadata as Record<string, unknown>;
  const candidate = metadata.thinkwork_runbook_contract;
  return typeof candidate === "string" && candidate.trim()
    ? candidate
    : RUNBOOK_SKILL_CONTRACT_PATH;
}

function parseJsonObject(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `runbook skill contract at ${path} is invalid JSON: ${(error as Error).message}`,
    ]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `runbook skill contract at ${path} must be a JSON object`,
    ]);
  }
  return parsed as Record<string, unknown>;
}

function objectField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  return fieldValue &&
    typeof fieldValue === "object" &&
    !Array.isArray(fieldValue)
    ? fieldValue
    : {};
}

function arrayField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  return Array.isArray(fieldValue) ? fieldValue : [];
}

function stringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  return typeof fieldValue === "string" ? fieldValue : "";
}

function optionalStringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];
  return typeof fieldValue === "string" && fieldValue.trim()
    ? fieldValue
    : undefined;
}

function isSafeRelativePath(value: string) {
  if (!value || isAbsolute(value)) return false;
  const normalized = normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}
