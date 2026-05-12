import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, ne } from "drizzle-orm";
import {
  agentTemplates,
  computers,
  tenants,
} from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";
import {
  RunbookValidationError,
  validateRunbookDefinition,
  type RunbookDefinition,
} from "./definition.js";
import { ensureDefaultComputerRunbookSkillsMaterialized } from "../computers/workspace-seed.js";
import { parseSkillMdInternal } from "../skill-md-parser.js";

const db = getDb();
const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const RUNBOOK_SKILL_KIND = "computer-runbook";
const DEFAULT_RUNBOOK_CONTRACT_PATH = "references/thinkwork-runbook.json";
const WORKSPACE_SKILL_MD_PATH_RE = /^skills\/([^/]+)\/SKILL\.md$/;

export type ComputerRunbookSkill = RunbookDefinition & {
  skill: {
    slug: string;
    source: "template-workspace";
    skillMdPath: string;
    skillMd: string;
    skillBody: string;
    frontmatter: Record<string, unknown>;
    contractPath: string;
    contract: Record<string, unknown>;
  };
};

export async function listAssignedComputerRunbookSkills(input: {
  tenantId: string;
  computerId: string;
}): Promise<ComputerRunbookSkill[]> {
  try {
    await ensureDefaultComputerRunbookSkillsMaterialized(input);
  } catch (err) {
    console.error(
      "[runbook-skill-discovery] failed to materialize default runbook skills",
      {
        tenantId: input.tenantId,
        computerId: input.computerId,
        message: err instanceof Error ? err.message : String(err),
      },
    );
  }
  const workspace = await resolveComputerTemplateWorkspace(input);
  const skillMarkers = await listWorkspaceSkillMarkers(workspace.prefix);
  const runbooks: ComputerRunbookSkill[] = [];

  for (const marker of skillMarkers) {
    const skillMd = await readWorkspaceText(
      `${workspace.prefix}${marker.path}`,
    );
    const runbook = await buildComputerRunbookSkill({
      skillMdPath: marker.path,
      skillMd,
      readSkillFile: (relativePath) =>
        readWorkspaceText(
          `${workspace.prefix}skills/${marker.slug}/${relativePath}`,
        ),
    });
    if (runbook) runbooks.push(runbook);
  }

  return runbooks.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function buildComputerRunbookSkill(input: {
  skillMdPath: string;
  skillMd: string;
  readSkillFile: (relativePath: string) => Promise<string>;
}): Promise<ComputerRunbookSkill | null> {
  const parsed = parseSkillMdInternal(input.skillMd, input.skillMdPath);
  if (!parsed.valid) {
    throw new RunbookValidationError(
      "Invalid runbook skill",
      parsed.errors.map((error) => error.message),
    );
  }

  const frontmatter = parsed.parsed.data;
  if (!isRunbookSkillFrontmatter(frontmatter)) return null;

  const contractPath = runbookContractPath(frontmatter);
  assertSafeRelativePath(contractPath, "runbook skill contract path");

  const contract = parseJsonObject(
    await input.readSkillFile(contractPath),
    contractPath,
  );
  const runbook = validateRunbookDefinition(
    definitionFromSkillContract(frontmatter, contract),
  );
  const phases = [];
  for (const phase of runbook.phases) {
    assertSafeRelativePath(phase.guidance, `phase "${phase.id}" guidance file`);
    phases.push({
      ...phase,
      guidanceMarkdown: await input.readSkillFile(phase.guidance),
    });
  }

  const hydrated = { ...runbook, phases };
  const pathSlug = input.skillMdPath.match(WORKSPACE_SKILL_MD_PATH_RE)?.[1];
  if (pathSlug && hydrated.slug !== pathSlug) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `SKILL.md name "${hydrated.slug}" must match workspace skill folder "${pathSlug}"`,
    ]);
  }
  return {
    ...hydrated,
    skill: {
      slug: hydrated.slug,
      source: "template-workspace",
      skillMdPath: input.skillMdPath,
      skillMd: input.skillMd,
      skillBody: parsed.parsed.body,
      frontmatter,
      contractPath,
      contract,
    },
  };
}

async function resolveComputerTemplateWorkspace(input: {
  tenantId: string;
  computerId: string;
}) {
  const [row] = await db
    .select({
      tenantSlug: tenants.slug,
      templateSlug: agentTemplates.slug,
    })
    .from(computers)
    .innerJoin(tenants, eq(tenants.id, computers.tenant_id))
    .innerJoin(agentTemplates, eq(agentTemplates.id, computers.template_id))
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
        ne(computers.status, "archived"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error(
      `Computer ${input.computerId} not found in tenant ${input.tenantId}`,
    );
  }

  return {
    prefix: `tenants/${row.tenantSlug}/agents/_catalog/${row.templateSlug}/workspace/`,
  };
}

async function listWorkspaceSkillMarkers(prefix: string) {
  const markers: Array<{ slug: string; path: string }> = [];
  let continuationToken: string | undefined;

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: workspaceBucket(),
        Prefix: `${prefix}skills/`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of list.Contents ?? []) {
      if (!object.Key) continue;
      const relativePath = object.Key.slice(prefix.length);
      const match = relativePath.match(WORKSPACE_SKILL_MD_PATH_RE);
      if (!match) continue;
      markers.push({ slug: match[1], path: relativePath });
    }
    continuationToken = list.IsTruncated
      ? list.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return markers.sort((a, b) => a.path.localeCompare(b.path));
}

async function readWorkspaceText(key: string) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
  );
  return (await response.Body?.transformToString("utf-8")) ?? "";
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
    : DEFAULT_RUNBOOK_CONTRACT_PATH;
}

function definitionFromSkillContract(
  frontmatter: Record<string, unknown>,
  contract: Record<string, unknown>,
) {
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
    approval: objectField(contract, "confirmation"),
    phases: arrayField(contract, "phases"),
    outputs: arrayField(contract, "outputs"),
    overrides: objectField(contract, "overrides"),
  };
}

function parseJsonObject(
  source: string,
  path: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
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

function assertSafeRelativePath(path: string, label: string) {
  const parts = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new RunbookValidationError("Invalid runbook skill", [
      `${label} must be relative and inside the skill: ${path}`,
    ]);
  }
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
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function workspaceBucket() {
  const bucket = process.env.WORKSPACE_BUCKET || process.env.BUCKET_NAME || "";
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET is required for runbook skill discovery");
  }
  return bucket;
}
