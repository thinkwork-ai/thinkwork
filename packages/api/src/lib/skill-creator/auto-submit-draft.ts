import { randomUUID } from "node:crypto";
import { getConfig } from "@thinkwork/runtime-config";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3Client as S3ClientType,
} from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  skillDraftEvents,
  skillDrafts,
  tenants,
} from "@thinkwork/database-pg/schema";
import type { ReconcileReport } from "../chat-finalize/reconcile.js";
import {
  computeSkillDraftContentHash,
  contentTypeForSkillDraftPath,
  skillDraftPrefix,
  validateSkillDraftFiles,
  type SkillDraftFile,
} from "../skill-drafts/files.js";
import { parseSkillMd } from "../skill-md-parser.js";

export interface AutoSubmitSkillCreatorDraftInput {
  tenantId: string;
  threadId: string;
  threadTurnId: string;
  requesterUserId: string | null;
  userMessage: string;
  skillCreatorCommand?: unknown;
  reconcileReport: ReconcileReport;
  storage?: SkillCreatorDraftStorage;
  now?: Date;
}

export interface SkillCreatorDraftStorage {
  list(prefix: string): Promise<string[]>;
  read(key: string): Promise<Buffer>;
  write(key: string, content: Buffer, contentType: string): Promise<void>;
}

export type AutoSubmitSkillCreatorDraftResult =
  | { status: "skipped"; reason: string }
  | {
      status: "submitted" | "failed";
      draftId: string;
      slug: string;
      fileCount: number;
      currentContentHash: string;
      failureMessage?: string;
    };

const SUBMIT_INTENT_RE =
  /\b(?:submit|submitted|review|approval|approve|ready|queue|register|publish|library)\b/i;
const WORKSPACE_SKILL_MD_RE =
  /^(?:Agent\/)?skills\/([a-z0-9][a-z0-9-]{0,62})\/SKILL\.md$/;

const defaultS3 = new S3Client({});

export async function autoSubmitSkillCreatorDraft(
  input: AutoSubmitSkillCreatorDraftInput,
): Promise<AutoSubmitSkillCreatorDraftResult> {
  if (!isSkillCreatorCommandPayload(input.skillCreatorCommand)) {
    return { status: "skipped", reason: "not_skill_creator_turn" };
  }
  if (!input.requesterUserId) {
    return { status: "skipped", reason: "missing_requester" };
  }
  if (!SUBMIT_INTENT_RE.test(input.userMessage)) {
    return { status: "skipped", reason: "missing_submit_intent" };
  }

  const candidates = changedSkillMdFiles(input.reconcileReport);
  if (candidates.length === 0) {
    return { status: "skipped", reason: "no_skill_md_change" };
  }
  if (candidates.length > 1) {
    return { status: "skipped", reason: "multiple_skill_md_changes" };
  }

  const candidate = candidates[0]!;
  const existing = await findExistingDraftForTurn(input);
  if (existing) {
    return { status: "skipped", reason: "already_registered" };
  }

  const storage = input.storage ?? createS3SkillCreatorDraftStorage();
  const files = await readSkillFolder(storage, candidate.sourcePrefix);
  if (files.length === 0) {
    return { status: "skipped", reason: "empty_skill_folder" };
  }

  const validated = validateSkillDraftFiles(files);
  const filesToPersist = validated.ok ? validated.files : files;
  const currentContentHash = validated.ok
    ? validated.currentContentHash
    : computeSkillDraftContentHash(filesToPersist);
  const parsedSkill = validated.ok ? parseValidatedSkill(filesToPersist) : null;
  const now = input.now ?? new Date();
  const draftStatus = validated.ok ? "submitted" : "failed";
  const failureMessage = validated.ok
    ? null
    : summarizeValidationFailure(validated.errors);

  const tenantSlug = await loadTenantSlug(input.tenantId);
  const draftId = randomUUID();
  const draftPrefix = skillDraftPrefix(tenantSlug, draftId);
  for (const file of filesToPersist) {
    await storage.write(
      `${draftPrefix}${file.path}`,
      file.content,
      contentTypeForSkillDraftPath(file.path),
    );
  }

  const db = getDb();
  await db.insert(skillDrafts).values({
    id: draftId,
    tenant_id: input.tenantId,
    requested_by_user_id: input.requesterUserId,
    source_thread_id: input.threadId,
    source_message_id: null,
    slug: validated.ok ? validated.slug : candidate.slug,
    title: parsedSkill?.displayName ?? titleFromSlug(candidate.slug),
    display_name: parsedSkill?.displayName ?? null,
    summary: parsedSkill?.description ?? failureMessage,
    source_kind: "thread",
    status: draftStatus,
    current_content_hash: currentContentHash,
    draft_s3_prefix: draftPrefix,
    failure_message: failureMessage,
    metadata: {
      skillCreator: {
        source: "chat_finalize",
        threadTurnId: input.threadTurnId,
        sourcePath: candidate.path,
        sourcePrefix: candidate.sourcePrefix,
      },
    },
    submitted_at: validated.ok ? now : null,
    created_at: now,
    updated_at: now,
  });

  await db.insert(skillDraftEvents).values({
    tenant_id: input.tenantId,
    draft_id: draftId,
    actor_user_id: input.requesterUserId,
    event_type: "created",
    message: "Skill draft created from /skill-creator chat output.",
    payload: {
      source: "chat_finalize",
      threadTurnId: input.threadTurnId,
      sourcePath: candidate.path,
    },
  });
  await db.insert(skillDraftEvents).values({
    tenant_id: input.tenantId,
    draft_id: draftId,
    actor_user_id: input.requesterUserId,
    event_type: draftStatus === "submitted" ? "submitted" : "failed",
    message:
      draftStatus === "submitted"
        ? "Skill draft submitted for review from /skill-creator."
        : "Skill draft could not be submitted because validation failed.",
    payload: {
      currentContentHash,
      ...(failureMessage ? { failureMessage } : {}),
    },
  });

  return {
    status: draftStatus,
    draftId,
    slug: validated.ok ? validated.slug : candidate.slug,
    fileCount: filesToPersist.length,
    currentContentHash,
    ...(failureMessage ? { failureMessage } : {}),
  };
}

export function changedSkillMdFiles(report: ReconcileReport): Array<{
  slug: string;
  path: string;
  sourceKey: string;
  sourcePrefix: string;
}> {
  const candidates = new Map<
    string,
    { slug: string; path: string; sourceKey: string; sourcePrefix: string }
  >();
  for (const file of report.files) {
    if (file.status !== "written" || file.owner !== "agent") continue;
    const match = WORKSPACE_SKILL_MD_RE.exec(file.path);
    if (!match) continue;
    const sourceKey = file.sourceKey;
    if (!sourceKey.endsWith("SKILL.md")) continue;
    const slug = match[1]!;
    candidates.set(slug, {
      slug,
      path: file.path,
      sourceKey,
      sourcePrefix: sourceKey.slice(0, -"SKILL.md".length),
    });
  }
  return [...candidates.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function isSkillCreatorCommandPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "skill_creator" &&
    record.source === "slash_command" &&
    record.command === "/skill-creator"
  );
}

async function findExistingDraftForTurn(
  input: Pick<AutoSubmitSkillCreatorDraftInput, "tenantId" | "threadTurnId">,
): Promise<{ id: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: skillDrafts.id })
    .from(skillDrafts)
    .where(
      and(
        eq(skillDrafts.tenant_id, input.tenantId),
        sql`${skillDrafts.metadata}->'skillCreator'->>'threadTurnId' = ${input.threadTurnId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadTenantSlug(tenantId: string): Promise<string> {
  const db = getDb();
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) {
    throw new Error("Tenant slug not found for skill creator draft.");
  }
  return tenant.slug;
}

async function readSkillFolder(
  storage: SkillCreatorDraftStorage,
  sourcePrefix: string,
): Promise<SkillDraftFile[]> {
  const keys = await storage.list(sourcePrefix);
  const files: SkillDraftFile[] = [];
  for (const key of keys.sort((a, b) => a.localeCompare(b))) {
    if (!key.startsWith(sourcePrefix)) continue;
    const path = key.slice(sourcePrefix.length);
    if (!path || path.endsWith("/")) continue;
    files.push({ path, content: await storage.read(key) });
  }
  return files;
}

function parseValidatedSkill(files: SkillDraftFile[]): {
  displayName: string | null;
  description: string;
} | null {
  const skillFile = files.find((file) => file.path === "SKILL.md");
  if (!skillFile) return null;
  const parsed = parseSkillMd(skillFile.content.toString("utf8"), "SKILL.md");
  if (!parsed.valid) return null;
  const displayName = parsed.parsed.internal?.display_name;
  return {
    displayName:
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : titleFromSlug(parsed.parsed.name),
    description: parsed.parsed.description,
  };
}

function summarizeValidationFailure(
  errors: Array<{ message: string }>,
): string {
  const [first] = errors;
  return first?.message ?? "Skill draft validation failed.";
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function createS3SkillCreatorDraftStorage(
  s3: S3ClientType = defaultS3,
  bucketName = getConfig("WORKSPACE_BUCKET") ?? "",
): SkillCreatorDraftStorage {
  if (!bucketName) {
    throw new Error("WORKSPACE_BUCKET is required for skill creator drafts.");
  }
  return {
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key) keys.push(object.Key);
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
      return keys;
    },
    async read(key: string): Promise<Buffer> {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucketName, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      return Buffer.from(bytes ?? []);
    },
    async write(
      key: string,
      content: Buffer,
      contentType: string,
    ): Promise<void> {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: content,
          ContentType: contentType,
        }),
      );
    },
  };
}
