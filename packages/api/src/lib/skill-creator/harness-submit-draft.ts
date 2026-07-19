import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  skillDraftEvents,
  skillDrafts,
  tenants,
} from "@thinkwork/database-pg/schema";
import { parseSkillMd } from "../skill-md-parser.js";
import {
  contentTypeForSkillDraftPath,
  skillDraftPrefix,
  validateSkillDraftFiles,
  type SkillDraftFile,
} from "../skill-drafts/files.js";
import {
  createS3SkillCreatorDraftStorage,
  type SkillCreatorDraftStorage,
} from "./auto-submit-draft.js";

const MAX_SUPPORTING_FILES = 20;
const MAX_TOOL_FILE_BYTES = 128 * 1024;
const MAX_TOOL_TOTAL_BYTES = 256 * 1024;

export interface HarnessSkillDraftRegistration {
  status: "submitted";
  draftId: string;
  slug: string;
  fileCount: number;
  currentContentHash: string;
  failureMessage?: string;
}

export interface PreparedHarnessSkillDraft {
  slug: string;
  title: string;
  displayName: string | null;
  summary: string;
  files: SkillDraftFile[];
  currentContentHash: string;
}

export interface HarnessSkillDraftPersistence {
  storage: SkillCreatorDraftStorage;
  findExisting(input: {
    tenantId: string;
    threadTurnId: string;
  }): Promise<HarnessSkillDraftRegistration | null>;
  loadTenantSlug(tenantId: string): Promise<string>;
  insertDraft(input: {
    draftId: string;
    tenantId: string;
    requesterUserId: string;
    threadId: string;
    threadTurnId: string;
    prefix: string;
    prepared: PreparedHarnessSkillDraft;
    now: Date;
  }): Promise<void>;
  newId(): string;
}

export function prepareHarnessSkillDraft(
  value: unknown,
): PreparedHarnessSkillDraft {
  const record = readRecord(value);
  const skillMarkdown = boundedText(
    record.skill_markdown,
    MAX_TOOL_FILE_BYTES,
    "skill_markdown",
  );
  const supporting = record.supporting_files;
  if (
    supporting !== undefined &&
    (!Array.isArray(supporting) || supporting.length > MAX_SUPPORTING_FILES)
  ) {
    throw new Error(
      `supporting_files must contain at most ${MAX_SUPPORTING_FILES} text files`,
    );
  }

  const files: SkillDraftFile[] = [
    { path: "SKILL.md", content: Buffer.from(skillMarkdown, "utf8") },
  ];
  for (const [index, entry] of (supporting ?? []).entries()) {
    const file = readRecord(entry);
    const path = boundedText(file.path, 260, `supporting_files[${index}].path`);
    if (path === "SKILL.md") {
      throw new Error("supporting_files must not replace SKILL.md");
    }
    const content = boundedText(
      file.content,
      MAX_TOOL_FILE_BYTES,
      `supporting_files[${index}].content`,
      true,
    );
    files.push({ path, content: Buffer.from(content, "utf8") });
  }
  const totalBytes = files.reduce(
    (total, file) => total + file.content.byteLength,
    0,
  );
  if (totalBytes > MAX_TOOL_TOTAL_BYTES) {
    throw new Error(
      `skill draft exceeds the ${MAX_TOOL_TOTAL_BYTES}-byte Harness submission limit`,
    );
  }

  const validated = validateSkillDraftFiles(files);
  if (!validated.ok) {
    throw new Error(
      `invalid skill draft: ${validated.errors.map((error) => error.message).join("; ")}`,
    );
  }
  const skillFile = validated.files.find((file) => file.path === "SKILL.md");
  const parsed = skillFile
    ? parseSkillMd(skillFile.content.toString("utf8"), "SKILL.md")
    : null;
  if (!parsed?.valid) {
    throw new Error("invalid skill draft: SKILL.md could not be parsed");
  }
  const displayName = parsed.parsed.internal?.display_name;
  const normalizedDisplayName =
    typeof displayName === "string" && displayName.trim()
      ? displayName.trim()
      : null;
  return {
    slug: validated.slug,
    title: normalizedDisplayName ?? titleFromSlug(validated.slug),
    displayName: normalizedDisplayName,
    summary: parsed.parsed.description,
    files: validated.files,
    currentContentHash: validated.currentContentHash,
  };
}

export async function submitHarnessSkillDraft(input: {
  tenantId: string;
  requesterUserId: string;
  threadId: string;
  threadTurnId: string;
  raw: unknown;
  now?: Date;
  persistence?: HarnessSkillDraftPersistence;
}): Promise<HarnessSkillDraftRegistration> {
  const prepared = prepareHarnessSkillDraft(input.raw);
  const persistence = input.persistence ?? defaultPersistence();
  const existing = await persistence.findExisting({
    tenantId: input.tenantId,
    threadTurnId: input.threadTurnId,
  });
  if (existing) return existing;

  const tenantSlug = await persistence.loadTenantSlug(input.tenantId);
  const draftId = persistence.newId();
  const prefix = skillDraftPrefix(tenantSlug, draftId);
  for (const file of prepared.files) {
    await persistence.storage.write(
      `${prefix}${file.path}`,
      file.content,
      contentTypeForSkillDraftPath(file.path),
    );
  }
  await persistence.insertDraft({
    draftId,
    tenantId: input.tenantId,
    requesterUserId: input.requesterUserId,
    threadId: input.threadId,
    threadTurnId: input.threadTurnId,
    prefix,
    prepared,
    now: input.now ?? new Date(),
  });
  return {
    status: "submitted",
    draftId,
    slug: prepared.slug,
    fileCount: prepared.files.length,
    currentContentHash: prepared.currentContentHash,
  };
}

/** Re-load untrusted finalize metadata through the exact persisted ownership chain. */
export async function loadCanonicalHarnessSkillDraftRegistration(input: {
  tenantId: string;
  requesterUserId: string;
  threadId: string;
  threadTurnId: string;
  draftId: string;
}): Promise<HarnessSkillDraftRegistration | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: skillDrafts.id,
      slug: skillDrafts.slug,
      status: skillDrafts.status,
      currentContentHash: skillDrafts.current_content_hash,
      metadata: skillDrafts.metadata,
    })
    .from(skillDrafts)
    .where(
      and(
        eq(skillDrafts.id, input.draftId),
        eq(skillDrafts.tenant_id, input.tenantId),
        eq(skillDrafts.requested_by_user_id, input.requesterUserId),
        eq(skillDrafts.source_thread_id, input.threadId),
        sql`${skillDrafts.metadata}->'skillCreator'->>'threadTurnId' = ${input.threadTurnId}`,
        sql`${skillDrafts.metadata}->'skillCreator'->>'source' = 'agentcore_harness'`,
      ),
    )
    .limit(1);
  if (!row || row.status !== "submitted" || !row.currentContentHash) {
    return null;
  }
  const creator = readRecord(readRecord(row.metadata).skillCreator);
  return {
    status: "submitted",
    draftId: row.id,
    slug: row.slug,
    fileCount: finitePositiveInteger(creator.fileCount) ?? 1,
    currentContentHash: row.currentContentHash,
  };
}

function defaultPersistence(): HarnessSkillDraftPersistence {
  const db = getDb();
  return {
    storage: createS3SkillCreatorDraftStorage(),
    newId: randomUUID,
    async findExisting(input) {
      const [row] = await db
        .select({
          id: skillDrafts.id,
          slug: skillDrafts.slug,
          status: skillDrafts.status,
          currentContentHash: skillDrafts.current_content_hash,
          metadata: skillDrafts.metadata,
        })
        .from(skillDrafts)
        .where(
          and(
            eq(skillDrafts.tenant_id, input.tenantId),
            sql`${skillDrafts.metadata}->'skillCreator'->>'threadTurnId' = ${input.threadTurnId}`,
            sql`${skillDrafts.metadata}->'skillCreator'->>'source' = 'agentcore_harness'`,
          ),
        )
        .limit(1);
      if (!row || row.status !== "submitted" || !row.currentContentHash) {
        return null;
      }
      const metadata = readRecord(row.metadata);
      const creator = readRecord(metadata.skillCreator);
      const fileCount = finitePositiveInteger(creator.fileCount);
      return {
        status: "submitted",
        draftId: row.id,
        slug: row.slug,
        fileCount: fileCount ?? 1,
        currentContentHash: row.currentContentHash,
      };
    },
    async loadTenantSlug(tenantId) {
      const [tenant] = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!tenant?.slug)
        throw new Error("Tenant slug not found for skill draft");
      return tenant.slug;
    },
    async insertDraft(input) {
      await db.insert(skillDrafts).values({
        id: input.draftId,
        tenant_id: input.tenantId,
        requested_by_user_id: input.requesterUserId,
        source_thread_id: input.threadId,
        source_message_id: null,
        slug: input.prepared.slug,
        title: input.prepared.title,
        display_name: input.prepared.displayName,
        summary: input.prepared.summary,
        source_kind: "thread",
        status: "submitted",
        current_content_hash: input.prepared.currentContentHash,
        draft_s3_prefix: input.prefix,
        metadata: {
          skillCreator: {
            source: "agentcore_harness",
            threadTurnId: input.threadTurnId,
            fileCount: input.prepared.files.length,
          },
        },
        submitted_at: input.now,
        created_at: input.now,
        updated_at: input.now,
      });
      await db.insert(skillDraftEvents).values([
        {
          tenant_id: input.tenantId,
          draft_id: input.draftId,
          actor_user_id: input.requesterUserId,
          event_type: "created",
          message: "Skill draft created by the AgentCore Harness.",
          payload: {
            source: "agentcore_harness",
            threadTurnId: input.threadTurnId,
          },
        },
        {
          tenant_id: input.tenantId,
          draft_id: input.draftId,
          actor_user_id: input.requesterUserId,
          event_type: "submitted",
          message: "Skill draft submitted for review from AgentCore.",
          payload: {
            currentContentHash: input.prepared.currentContentHash,
          },
        },
      ]);
    },
  };
}

function boundedText(
  value: unknown,
  maxBytes: number,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const text = allowEmpty ? value : value.trim();
  if ((!allowEmpty && !text) || Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(`${field} is empty or exceeds ${maxBytes} bytes`);
  }
  return text;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
