import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface EnterpriseOverlayDefinition {
  schemaVersion: 1;
  customerSlug: string;
  stages: Record<string, EnterpriseOverlayStage>;
}

export interface EnterpriseOverlayStage {
  tenantSlug: string;
  evalPacks: string[];
  seedPacks: string[];
  skillPacks: string[];
  workspaceDefaultPacks: string[];
  branding: Record<string, unknown> | null;
  defaultAgentTemplateSlug: string;
}

export interface CustomerEvalAssertion {
  type: string;
  value?: string | null;
  path?: string | null;
}

export interface CustomerEvalSeed {
  name: string;
  category: string;
  query: string;
  systemPrompt?: string | null;
  agentId?: string | null;
  assertions: CustomerEvalAssertion[];
  agentcoreEvaluatorIds?: string[];
  tags?: string[];
  enabled?: boolean;
}

export interface OverlayFile {
  relativePath: string;
  content: string;
}

export function loadEnterpriseOverlayDefinition(
  repoRoot: string,
): EnterpriseOverlayDefinition {
  const path = join(repoRoot, "customer", "deployment.json");
  if (!existsSync(path)) {
    throw new Error(`Missing customer overlay definition: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Unsupported customer/deployment.json schemaVersion ${parsed.schemaVersion}`,
    );
  }
  if (!isNonEmptyString(parsed.customerSlug)) {
    throw new Error("customer/deployment.json requires customerSlug");
  }
  if (!isRecord(parsed.stages)) {
    throw new Error("customer/deployment.json requires stages");
  }
  return {
    schemaVersion: 1,
    customerSlug: parsed.customerSlug,
    stages: Object.fromEntries(
      Object.entries(parsed.stages).map(([stage, value]) => [
        stage,
        normalizeStage(stage, value),
      ]),
    ),
  };
}

export function stageOverlay(
  definition: EnterpriseOverlayDefinition,
  stage: string,
): EnterpriseOverlayStage {
  const config = definition.stages[stage];
  if (!config) {
    throw new Error(`customer/deployment.json does not define stage ${stage}`);
  }
  return config;
}

export function readCustomerEvalPack(
  repoRoot: string,
  packName: string,
): CustomerEvalSeed[] {
  assertPackName(packName, "eval");
  const path = join(repoRoot, "customer", "evals", `${packName}.json`);
  if (!existsSync(path)) {
    throw new Error(`Eval pack "${packName}" is missing: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Eval pack "${packName}" must be a JSON array`);
  }
  return parsed.map((value, index) =>
    normalizeEvalSeed(value, `customer/evals/${packName}.json[${index}]`),
  );
}

export function readJsonSeedPack(repoRoot: string, packName: string): unknown {
  assertPackName(packName, "seed");
  const path = join(repoRoot, "customer", "seeds", `${packName}.json`);
  if (!existsSync(path)) {
    throw new Error(`Seed pack "${packName}" is missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function collectOverlayFiles(
  repoRoot: string,
  family: "skills" | "workspace-defaults",
  packName: string,
): OverlayFile[] {
  assertPackName(packName, family);
  const root = join(repoRoot, "customer", family, packName);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Overlay pack "${family}/${packName}" is missing: ${root}`);
  }
  const files: OverlayFile[] = [];
  walkFiles(root, (path) => {
    const relativePath = relative(root, path).split(sep).join("/");
    if (relativePath === ".DS_Store" || relativePath.endsWith("/.DS_Store")) {
      return;
    }
    files.push({
      relativePath,
      content: readFileSync(path, "utf8"),
    });
  });
  if (
    family === "skills" &&
    !files.some((file) => file.relativePath === "SKILL.md")
  ) {
    throw new Error(`Skill pack "${packName}" must include SKILL.md`);
  }
  if (files.length === 0) {
    throw new Error(`Overlay pack "${family}/${packName}" contains no files`);
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function normalizeStage(stage: string, value: unknown): EnterpriseOverlayStage {
  if (!isRecord(value)) {
    throw new Error(`Stage ${stage} must be an object`);
  }
  if (!isNonEmptyString(value.tenantSlug)) {
    throw new Error(`Stage ${stage} requires tenantSlug`);
  }
  const branding = value.branding;
  if (branding !== null && branding !== undefined && !isRecord(branding)) {
    throw new Error(`Stage ${stage} branding must be an object or null`);
  }
  return {
    tenantSlug: value.tenantSlug,
    evalPacks: normalizePackArray(value.evalPacks, `${stage}.evalPacks`),
    seedPacks: normalizePackArray(value.seedPacks, `${stage}.seedPacks`),
    skillPacks: normalizePackArray(value.skillPacks, `${stage}.skillPacks`),
    workspaceDefaultPacks: normalizePackArray(
      value.workspaceDefaultPacks,
      `${stage}.workspaceDefaultPacks`,
    ),
    branding: (branding ?? null) as Record<string, unknown> | null,
    defaultAgentTemplateSlug: isNonEmptyString(value.defaultAgentTemplateSlug)
      ? value.defaultAgentTemplateSlug
      : "default",
  };
}

function normalizeEvalSeed(value: unknown, label: string): CustomerEvalSeed {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!isNonEmptyString(value.name))
    throw new Error(`${label}.name is required`);
  if (!isNonEmptyString(value.category))
    throw new Error(`${label}.category is required`);
  if (!isNonEmptyString(value.query))
    throw new Error(`${label}.query is required`);
  const assertions = value.assertions;
  if (!Array.isArray(assertions)) {
    throw new Error(`${label}.assertions must be an array`);
  }
  return {
    name: value.name,
    category: value.category,
    query: value.query,
    systemPrompt:
      typeof value.systemPrompt === "string" ? value.systemPrompt : null,
    agentId: typeof value.agentId === "string" ? value.agentId : null,
    assertions: assertions.map((assertion, index) =>
      normalizeAssertion(assertion, `${label}.assertions[${index}]`),
    ),
    agentcoreEvaluatorIds: normalizeOptionalStringArray(
      value.agentcoreEvaluatorIds,
      `${label}.agentcoreEvaluatorIds`,
    ),
    tags: normalizeOptionalStringArray(value.tags, `${label}.tags`),
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
  };
}

function normalizeAssertion(
  value: unknown,
  label: string,
): CustomerEvalAssertion {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!isNonEmptyString(value.type))
    throw new Error(`${label}.type is required`);
  return {
    type: value.type,
    value:
      typeof value.value === "string" || value.value === null
        ? value.value
        : undefined,
    path:
      typeof value.path === "string" || value.path === null
        ? value.path
        : undefined,
  };
}

function normalizePackArray(value: unknown, label: string): string[] {
  const items = normalizeStringArray(value, label);
  for (const item of items) assertPackName(item, label);
  return items;
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isNonEmptyString(item)) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return item;
  });
}

function normalizeOptionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  return normalizeStringArray(value, label);
}

function assertPackName(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(value)) {
    throw new Error(
      `${label} pack "${value}" must use lowercase letters, numbers, dot, underscore, or hyphen`,
    );
  }
}

function walkFiles(root: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, visit);
    } else if (entry.isFile()) {
      visit(path);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
