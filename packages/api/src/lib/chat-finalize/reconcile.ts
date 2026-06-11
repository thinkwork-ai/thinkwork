import { getConfig } from "@thinkwork/runtime-config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  messages,
  spaceMembers,
  spaces,
  tenants,
  threads,
} from "@thinkwork/database-pg/schema";
import type {
  WorkspaceHydrateFile,
  WorkspaceHydrateManifest,
} from "../workspace-renderer/types.js";
import {
  isProtectedOrchestrationWritePath,
  isSpaceCapabilityWritePath,
  isVisibleUserContextPath,
  workspacePathOwner,
  workspaceSourcePath,
  type WorkspacePathOwner,
} from "../workspace-lanes.js";

export type ChangedFileOp = "create" | "modify" | "delete";

export interface ChangedFilePayload {
  path: string;
  op: ChangedFileOp;
  content?: string;
  base_etag?: string;
}

export interface ChangedFileValidationError {
  index: number;
  path: string | null;
  code:
    | "invalid_shape"
    | "invalid_op"
    | "invalid_path"
    | "content_required"
    | "content_forbidden"
    | "content_too_large";
  message: string;
}

export type ReconcileFailureCode =
  | "manifest_missing"
  | "manifest_invalid"
  | "source_not_mounted"
  | "unowned_path"
  | "read_only_status_file"
  | "lane_violation"
  | "secret_detected"
  | "base_etag_required"
  | "base_etag_mismatch"
  | "manifest_etag_missing"
  | "precondition_failed"
  | "s3_error";

export type ReconcileFileResult =
  | {
      path: string;
      op: ChangedFileOp;
      owner: Exclude<WorkspacePathOwner, "unowned" | "scratch" | "status">;
      status: "written";
      sourceKey: string;
      etag: string;
    }
  | {
      path: string;
      op: "delete";
      owner: Exclude<WorkspacePathOwner, "unowned" | "scratch" | "status">;
      status: "deleted";
      sourceKey: string;
    }
  | {
      path: string;
      op: ChangedFileOp;
      owner: "scratch";
      status: "dropped_scratch";
    }
  | {
      path: string;
      op: ChangedFileOp;
      owner: WorkspacePathOwner;
      status: "rejected";
      code: ReconcileFailureCode;
      message: string;
      sourceKey?: string;
      rule?: string;
      quarantineKey?: string;
    };

export interface ReconcileReport {
  status: "no_changes" | "complete" | "partial_success" | "failed";
  files: ReconcileFileResult[];
}

export interface ReconcileChangedFilesInput {
  tenantId: string;
  agentId: string;
  threadId: string;
  threadTurnId: string;
  changedFiles: ChangedFilePayload[];
  bucket?: string;
  objectStore?: ReconcileObjectStore;
  context?: ReconcileContext;
  hydrateManifest?: WorkspaceHydrateManifest | null;
  secretQuarantineStore?: SecretQuarantineStore;
  secretQuarantineBucket?: string;
  secretQuarantineKmsKeyId?: string;
  secretQuarantineRetentionDays?: number;
  notifySecretQuarantine?: SecretQuarantineNotifier;
  secretOverride?: SecretQuarantineOverride;
}

export class ReconcileNotImplementedError extends Error {
  readonly code = "ReconcileNotImplemented";

  constructor() {
    super("Workspace reconcile is not implemented yet.");
    this.name = "ReconcileNotImplementedError";
  }
}

export class ReconcileContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconcileContextError";
  }
}

export interface ReconcileContext {
  tenantId: string;
  tenantSlug: string;
  agentId: string;
  spaceId: string;
  spaceAccessMode: string;
  userId: string | null;
  threadId: string;
  renderedPrefix: string;
}

export interface ReconcileObjectStore {
  getText(input: { bucket: string; key: string }): Promise<string | null>;
  putText(input: {
    bucket: string;
    key: string;
    content: string;
    ifNoneMatch?: string;
    ifMatch?: string;
    contentType?: string;
  }): Promise<string>;
  deleteObject(input: {
    bucket: string;
    key: string;
    ifMatch: string;
  }): Promise<void>;
}

export interface SecretQuarantineStore {
  put(input: {
    bucket: string;
    key: string;
    content: string;
    kmsKeyId?: string;
    metadata: Record<string, string>;
    expiresAt: Date;
  }): Promise<{ key: string }>;
}

export type SecretQuarantineNotifier = (input: {
  context: ReconcileContext;
  changedFile: ChangedFilePayload;
  rule: string;
  quarantineKey: string | null;
}) => Promise<void>;

export interface SecretQuarantineOverride {
  actorType: "operator";
  operatorId: string;
  reason: string;
  approvedAt?: Date;
}

type ManifestFailure = {
  code: "manifest_missing" | "manifest_invalid";
  message: string;
};

export const CHANGED_FILE_LIMITS = {
  maxFiles: 100,
  maxPathBytes: 512,
  maxContentBytes: 256 * 1024,
  maxTotalContentBytes: 1024 * 1024,
} as const;

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const HYDRATE_MANIFEST_PATH = ".hydrate_manifest.json";
const DEFAULT_SECRET_QUARANTINE_RETENTION_DAYS = 7;

class S3ReconcileObjectStore implements ReconcileObjectStore {
  async getText(input: {
    bucket: string;
    key: string;
  }): Promise<string | null> {
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return (await response.Body?.transformToString("utf-8")) ?? "";
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async putText(input: {
    bucket: string;
    key: string;
    content: string;
    ifNoneMatch?: string;
    ifMatch?: string;
    contentType?: string;
  }): Promise<string> {
    const response = await s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.content,
        ContentType: input.contentType ?? "text/plain; charset=utf-8",
        ...(input.ifNoneMatch ? { IfNoneMatch: input.ifNoneMatch } : {}),
        ...(input.ifMatch ? { IfMatch: input.ifMatch } : {}),
      }),
    );
    return response.ETag ?? "";
  }

  async deleteObject(input: {
    bucket: string;
    key: string;
    ifMatch: string;
  }): Promise<void> {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        IfMatch: input.ifMatch,
      }),
    );
  }
}

class S3SecretQuarantineStore implements SecretQuarantineStore {
  async put(input: {
    bucket: string;
    key: string;
    content: string;
    kmsKeyId?: string;
    metadata: Record<string, string>;
    expiresAt: Date;
  }): Promise<{ key: string }> {
    await s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.content,
        ContentType: "text/plain; charset=utf-8",
        Metadata: input.metadata,
        Expires: input.expiresAt,
        ServerSideEncryption: input.kmsKeyId ? "aws:kms" : "AES256",
        ...(input.kmsKeyId ? { SSEKMSKeyId: input.kmsKeyId } : {}),
        Tagging: "classification=secret-quarantine&retention=short",
      }),
    );
    return { key: input.key };
  }
}

export function validateChangedFiles(
  input: unknown,
):
  | { ok: true; changedFiles: ChangedFilePayload[] }
  | { ok: false; errors: ChangedFileValidationError[] } {
  if (input === undefined || input === null) {
    return { ok: true, changedFiles: [] };
  }
  if (!Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        {
          index: -1,
          path: null,
          code: "invalid_shape",
          message: "changed_files must be an array.",
        },
      ],
    };
  }

  const errors: ChangedFileValidationError[] = [];
  const changedFiles: ChangedFilePayload[] = [];
  if (input.length > CHANGED_FILE_LIMITS.maxFiles) {
    errors.push({
      index: -1,
      path: null,
      code: "invalid_shape",
      message: `changed_files must contain at most ${CHANGED_FILE_LIMITS.maxFiles} files.`,
    });
  }

  let totalContentBytes = 0;
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({
        index,
        path: null,
        code: "invalid_shape",
        message: "changed file must be an object.",
      });
      return;
    }

    const file = raw as Record<string, unknown>;
    const path = typeof file.path === "string" ? file.path : null;
    const op = file.op;
    const content = file.content;
    const baseEtag = file.base_etag;

    if (!path || !isCanonicalRelativePath(path)) {
      errors.push({
        index,
        path,
        code: "invalid_path",
        message: "path must be a canonical relative workspace path.",
      });
    } else if (
      Buffer.byteLength(path, "utf8") > CHANGED_FILE_LIMITS.maxPathBytes
    ) {
      errors.push({
        index,
        path,
        code: "invalid_path",
        message: `path must be at most ${CHANGED_FILE_LIMITS.maxPathBytes} bytes.`,
      });
    }

    if (op !== "create" && op !== "modify" && op !== "delete") {
      errors.push({
        index,
        path,
        code: "invalid_op",
        message: "op must be create, modify, or delete.",
      });
    }

    if ((op === "create" || op === "modify") && typeof content !== "string") {
      errors.push({
        index,
        path,
        code: "content_required",
        message: "content is required for create and modify operations.",
      });
    }
    if (op === "delete" && content !== undefined) {
      errors.push({
        index,
        path,
        code: "content_forbidden",
        message: "content is not allowed for delete operations.",
      });
    }

    if (typeof content === "string") {
      const contentBytes = Buffer.byteLength(content, "utf8");
      totalContentBytes += contentBytes;
      if (contentBytes > CHANGED_FILE_LIMITS.maxContentBytes) {
        errors.push({
          index,
          path,
          code: "content_too_large",
          message: `content must be at most ${CHANGED_FILE_LIMITS.maxContentBytes} bytes.`,
        });
      }
    }

    if (baseEtag !== undefined && typeof baseEtag !== "string") {
      errors.push({
        index,
        path,
        code: "invalid_shape",
        message: "base_etag must be a string when present.",
      });
    }

    if (
      path &&
      isCanonicalRelativePath(path) &&
      (op === "create" || op === "modify" || op === "delete")
    ) {
      changedFiles.push({
        path,
        op,
        ...(typeof content === "string" ? { content } : {}),
        ...(typeof baseEtag === "string" ? { base_etag: baseEtag } : {}),
      });
    }
  });

  if (totalContentBytes > CHANGED_FILE_LIMITS.maxTotalContentBytes) {
    errors.push({
      index: -1,
      path: null,
      code: "content_too_large",
      message: `total changed file content must be at most ${CHANGED_FILE_LIMITS.maxTotalContentBytes} bytes.`,
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, changedFiles };
}

export async function reconcileChangedFiles(
  input: ReconcileChangedFilesInput,
): Promise<ReconcileReport> {
  if (input.changedFiles.length === 0) {
    return { status: "no_changes", files: [] };
  }

  const bucket = input.bucket ?? getConfig("WORKSPACE_BUCKET") ?? "";
  if (!bucket) {
    throw new ReconcileContextError(
      "WORKSPACE_BUCKET is required to reconcile workspace changes.",
    );
  }

  const context = input.context ?? (await resolveReconcileContext(input));
  const objectStore = input.objectStore ?? new S3ReconcileObjectStore();
  const secretQuarantineStore =
    input.secretQuarantineStore ?? new S3SecretQuarantineStore();
  const secretQuarantineBucket =
    input.secretQuarantineBucket ??
    process.env.SECRET_QUARANTINE_BUCKET ??
    bucket;
  const secretQuarantineKmsKeyId =
    input.secretQuarantineKmsKeyId ??
    process.env.SECRET_QUARANTINE_KMS_KEY_ID ??
    undefined;
  const configuredSecretQuarantineRetentionDays =
    input.secretQuarantineRetentionDays ??
    Number(process.env.SECRET_QUARANTINE_RETENTION_DAYS);
  const secretQuarantineRetentionDays =
    Number.isFinite(configuredSecretQuarantineRetentionDays) &&
    configuredSecretQuarantineRetentionDays > 0
      ? configuredSecretQuarantineRetentionDays
      : DEFAULT_SECRET_QUARANTINE_RETENTION_DAYS;
  const notifySecretQuarantine =
    input.notifySecretQuarantine ?? notifySecretQuarantineMessage;
  let manifest = input.hydrateManifest;
  let manifestFailure: ManifestFailure | null = null;
  if (manifest === undefined) {
    try {
      manifest = await readHydrateManifest({
        bucket,
        renderedPrefix: context.renderedPrefix,
        objectStore,
      });
    } catch (error) {
      manifest = null;
      manifestFailure = {
        code: "manifest_invalid",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (manifest === null && !manifestFailure) {
    manifestFailure = {
      code: "manifest_missing",
      message: "Hydrate manifest is missing for this thread.",
    };
  }

  const files: ReconcileFileResult[] = [];
  for (const changedFile of input.changedFiles) {
    const result = await reconcileOneFile({
      bucket,
      context,
      manifest,
      manifestFailure,
      changedFile,
      threadTurnId: input.threadTurnId,
      objectStore,
      secretQuarantineStore,
      secretQuarantineBucket,
      secretQuarantineKmsKeyId,
      secretQuarantineRetentionDays,
      notifySecretQuarantine,
      secretOverride: input.secretOverride,
    });
    files.push(result);
  }

  return {
    status: summarizeReconcileStatus(files),
    files,
  };
}

async function reconcileOneFile(input: {
  bucket: string;
  context: ReconcileContext;
  manifest: WorkspaceHydrateManifest | null;
  manifestFailure: ManifestFailure | null;
  changedFile: ChangedFilePayload;
  threadTurnId: string;
  objectStore: ReconcileObjectStore;
  secretQuarantineStore: SecretQuarantineStore;
  secretQuarantineBucket: string;
  secretQuarantineKmsKeyId?: string;
  secretQuarantineRetentionDays: number;
  notifySecretQuarantine: SecretQuarantineNotifier;
  secretOverride?: SecretQuarantineOverride;
}): Promise<ReconcileFileResult> {
  const { changedFile } = input;
  const owner = workspacePathOwner(changedFile.path);
  const sourcePath = workspaceSourcePath(changedFile.path);

  if (owner === "scratch") {
    return {
      path: changedFile.path,
      op: changedFile.op,
      owner,
      status: "dropped_scratch",
    };
  }

  if (owner === "unowned") {
    logRejectedLane(input.context, changedFile.path, "unowned_path");
    return rejected(changedFile, owner, "unowned_path", "Path is unowned.");
  }

  if (owner === "status") {
    logRejectedLane(input.context, changedFile.path, "read_only_status_file");
    return rejected(
      changedFile,
      owner,
      "read_only_status_file",
      "Spaces/INDEX.md and Thread projection files are generated read-only files. Use set_task_status or refresh progress for checklist updates.",
    );
  }

  const laneFailure = lanePolicyFailure(owner, changedFile.path);
  if (laneFailure) {
    logRejectedLane(input.context, changedFile.path, laneFailure.code);
    return rejected(changedFile, owner, laneFailure.code, laneFailure.message);
  }

  if (input.manifestFailure) {
    return rejected(
      changedFile,
      owner,
      input.manifestFailure.code,
      input.manifestFailure.message,
    );
  }
  if (!input.manifest) {
    return rejected(
      changedFile,
      owner,
      "manifest_missing",
      "Hydrate manifest is missing for this thread.",
    );
  }

  const sourcePrefix = sourcePrefixForOwner(input.manifest, owner);
  if (!sourcePrefix) {
    return rejected(
      changedFile,
      owner,
      "source_not_mounted",
      "No writable source prefix is mounted for this owner.",
    );
  }
  if (!sourcePrefix.startsWith(`tenants/${input.context.tenantSlug}/`)) {
    return rejected(
      changedFile,
      owner,
      "manifest_invalid",
      "Hydrate manifest source prefix is outside the current tenant.",
    );
  }

  const manifestFile = input.manifest.files.find(
    (file) => file.path === changedFile.path && file.owner === owner,
  );
  const sourceKey =
    changedFile.op === "create"
      ? `${sourcePrefix}${sourcePath}`
      : manifestFile?.sourceKey;
  if (!sourceKey) {
    return rejected(
      changedFile,
      owner,
      "manifest_missing",
      "Path is not present in the hydrate manifest.",
    );
  }
  if (!sourceKey.startsWith(sourcePrefix)) {
    return rejected(
      changedFile,
      owner,
      "manifest_invalid",
      "Hydrate manifest source key does not match the mounted source prefix.",
      sourceKey,
    );
  }

  if (changedFile.op !== "create") {
    const etagFailure = etagFailureFor(changedFile, manifestFile);
    if (etagFailure) {
      return rejected(
        changedFile,
        owner,
        etagFailure.code,
        etagFailure.message,
        sourceKey,
      );
    }
  }

  if (
    (changedFile.op === "create" || changedFile.op === "modify") &&
    changedFile.content !== undefined
  ) {
    const secretMatch = detectSecret(changedFile.content);
    if (secretMatch && !isAuthorizedSecretOverride(input.secretOverride)) {
      const quarantine = await quarantineSecretDetection({
        bucket: input.secretQuarantineBucket,
        kmsKeyId: input.secretQuarantineKmsKeyId,
        retentionDays: input.secretQuarantineRetentionDays,
        store: input.secretQuarantineStore,
        notify: input.notifySecretQuarantine,
        context: input.context,
        threadTurnId: input.threadTurnId,
        changedFile,
        content: changedFile.content,
        rule: secretMatch.rule,
      });
      return rejected(
        changedFile,
        owner,
        "secret_detected",
        quarantine.key
          ? "Content matched the secret-scan gate and was quarantined."
          : "Content matched the secret-scan gate; quarantine failed before canonical write.",
        sourceKey,
        secretMatch.rule,
        quarantine.key,
      );
    }
  }

  try {
    if (changedFile.op === "delete") {
      await input.objectStore.deleteObject({
        bucket: input.bucket,
        key: sourceKey,
        ifMatch: changedFile.base_etag!,
      });
      return {
        path: changedFile.path,
        op: "delete",
        owner,
        status: "deleted",
        sourceKey,
      };
    }

    const etag = await input.objectStore.putText({
      bucket: input.bucket,
      key: sourceKey,
      content: changedFile.content!,
      contentType: "text/plain; charset=utf-8",
      ...(changedFile.op === "create"
        ? { ifNoneMatch: "*" }
        : { ifMatch: changedFile.base_etag! }),
    });
    return {
      path: changedFile.path,
      op: changedFile.op,
      owner,
      status: "written",
      sourceKey,
      etag,
    };
  } catch (error) {
    if (isPreconditionFailed(error)) {
      return rejected(
        changedFile,
        owner,
        "precondition_failed",
        "S3 conditional write precondition failed.",
        sourceKey,
      );
    }
    return rejected(
      changedFile,
      owner,
      "s3_error",
      error instanceof Error ? error.message : String(error),
      sourceKey,
    );
  }
}

async function resolveReconcileContext(
  input: Pick<ReconcileChangedFilesInput, "tenantId" | "agentId" | "threadId">,
): Promise<ReconcileContext> {
  const db = getDb();
  const [thread] = await db
    .select({
      id: threads.id,
      tenantId: threads.tenant_id,
      agentId: threads.agent_id,
      spaceId: threads.space_id,
      userId: threads.user_id,
      workspaceFolderName: threads.workspace_folder_name,
    })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!thread) {
    throw new ReconcileContextError("Thread was not found for reconcile.");
  }
  if (thread.agentId && thread.agentId !== input.agentId) {
    throw new ReconcileContextError(
      "Finalize agent_id does not match the thread agent.",
    );
  }

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant?.slug) {
    throw new ReconcileContextError("Tenant slug was not found for reconcile.");
  }

  const [space] = await db
    .select({
      id: spaces.id,
      slug: spaces.slug,
      workspaceFolderName: spaces.workspace_folder_name,
      accessMode: spaces.access_mode,
      status: spaces.status,
    })
    .from(spaces)
    .where(
      and(eq(spaces.id, thread.spaceId), eq(spaces.tenant_id, input.tenantId)),
    )
    .limit(1);
  if (!space || space.status !== "active") {
    throw new ReconcileContextError("Thread Space is not active.");
  }

  if (space.accessMode === "private") {
    if (!thread.userId) {
      throw new ReconcileContextError(
        "Private Space reconcile requires a thread user.",
      );
    }
    const [member] = await db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.tenant_id, input.tenantId),
          eq(spaceMembers.space_id, thread.spaceId),
          eq(spaceMembers.user_id, thread.userId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new ReconcileContextError(
        "Thread user is not a member of the private Space.",
      );
    }
  }

  const threadFolder = thread.workspaceFolderName ?? thread.id;
  return {
    tenantId: input.tenantId,
    tenantSlug: tenant.slug,
    agentId: input.agentId,
    spaceId: thread.spaceId,
    spaceAccessMode: space.accessMode,
    userId: thread.userId,
    threadId: thread.id,
    renderedPrefix: `tenants/${tenant.slug}/threads/${threadFolder}/`,
  };
}

async function readHydrateManifest(input: {
  bucket: string;
  renderedPrefix: string;
  objectStore: ReconcileObjectStore;
}): Promise<WorkspaceHydrateManifest | null> {
  const text = await input.objectStore.getText({
    bucket: input.bucket,
    key: `${input.renderedPrefix}${HYDRATE_MANIFEST_PATH}`,
  });
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as WorkspaceHydrateManifest;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.sources) ||
      !Array.isArray(parsed.files)
    ) {
      throw new Error("invalid hydrate manifest shape");
    }
    return parsed;
  } catch (error) {
    throw new ReconcileContextError(
      `Hydrate manifest is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function lanePolicyFailure(
  owner: Exclude<WorkspacePathOwner, "scratch" | "unowned" | "status">,
  path: string,
): { code: "lane_violation"; message: string } | null {
  if (owner === "user" && !isVisibleUserContextPath(path)) {
    return {
      code: "lane_violation",
      message: "User context path is not writable from reconcile.",
    };
  }
  if (owner === "space" && isSpaceCapabilityWritePath(path)) {
    return {
      code: "lane_violation",
      message: "Spaces cannot contain capability files.",
    };
  }
  if (owner === "agent" && isProtectedOrchestrationWritePath(path)) {
    return {
      code: "lane_violation",
      message:
        "Protected orchestration paths require the orchestration writer.",
    };
  }
  return null;
}

function sourcePrefixForOwner(
  manifest: WorkspaceHydrateManifest,
  owner: Exclude<WorkspacePathOwner, "scratch" | "unowned" | "status">,
): string | null {
  return (
    manifest.sources.find((source) => source.owner === owner)?.prefix ?? null
  );
}

function etagFailureFor(
  changedFile: ChangedFilePayload,
  manifestFile: WorkspaceHydrateFile | undefined,
): {
  code: "base_etag_required" | "manifest_etag_missing" | "base_etag_mismatch";
  message: string;
} | null {
  if (!changedFile.base_etag) {
    return {
      code: "base_etag_required",
      message: "base_etag is required for modify and delete operations.",
    };
  }
  if (!manifestFile) {
    return {
      code: "base_etag_mismatch",
      message: "Path is not present in the hydrate manifest.",
    };
  }
  if (!manifestFile.etag) {
    return {
      code: "manifest_etag_missing",
      message: "Hydrate manifest file is missing an ETag.",
    };
  }
  if (manifestFile.etag !== changedFile.base_etag) {
    return {
      code: "base_etag_mismatch",
      message: "base_etag does not match the hydrate manifest ETag.",
    };
  }
  return null;
}

function rejected(
  changedFile: ChangedFilePayload,
  owner: WorkspacePathOwner,
  code: ReconcileFailureCode,
  message: string,
  sourceKey?: string,
  rule?: string,
  quarantineKey?: string | null,
): ReconcileFileResult {
  return {
    path: changedFile.path,
    op: changedFile.op,
    owner,
    status: "rejected",
    code,
    message,
    ...(sourceKey ? { sourceKey } : {}),
    ...(rule ? { rule } : {}),
    ...(quarantineKey ? { quarantineKey } : {}),
  };
}

function summarizeReconcileStatus(
  files: ReconcileFileResult[],
): ReconcileReport["status"] {
  if (files.length === 0) return "no_changes";
  const failures = files.filter((file) => file.status === "rejected").length;
  if (failures === 0) return "complete";
  if (failures === files.length) return "failed";
  return "partial_success";
}

function detectSecret(content: string): { rule: string } | null {
  const patterns: Array<{ rule: string; pattern: RegExp }> = [
    {
      rule: "aws_access_key_id",
      pattern:
        /(?:^|[^A-Z0-9])(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}(?:[^A-Z0-9]|$)/,
    },
    { rule: "openai_api_key", pattern: /sk-[A-Za-z0-9_-]{24,}/ },
    {
      rule: "private_key_block",
      pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    },
  ];
  for (const candidate of patterns) {
    if (candidate.pattern.test(content)) return { rule: candidate.rule };
  }
  const highEntropy = content.match(/[A-Za-z0-9+/=_-]{48,}/g) ?? [];
  for (const token of highEntropy) {
    if (shannonEntropy(token) >= 4.75) {
      return { rule: "high_entropy_token" };
    }
  }
  return null;
}

async function quarantineSecretDetection(input: {
  bucket: string;
  kmsKeyId?: string;
  retentionDays: number;
  store: SecretQuarantineStore;
  notify: SecretQuarantineNotifier;
  context: ReconcileContext;
  threadTurnId: string;
  changedFile: ChangedFilePayload;
  content: string;
  rule: string;
}): Promise<{ key: string | null }> {
  const key = secretQuarantineKey({
    tenantSlug: input.context.tenantSlug,
    threadId: input.context.threadId,
    threadTurnId: input.threadTurnId,
    path: input.changedFile.path,
    content: input.content,
  });
  const expiresAt = new Date(
    Date.now() + input.retentionDays * 24 * 60 * 60 * 1000,
  );

  let stored: { key: string };
  try {
    stored = await input.store.put({
      bucket: input.bucket,
      key,
      content: input.content,
      kmsKeyId: input.kmsKeyId,
      expiresAt,
      metadata: {
        tenant_id: input.context.tenantId,
        thread_id: input.context.threadId,
        agent_id: input.context.agentId,
        path_hash: hashText(input.changedFile.path),
        rule: input.rule,
      },
    });
  } catch (error) {
    console.warn("[workspace-reconcile] secret quarantine failed", {
      tenantId: input.context.tenantId,
      threadId: input.context.threadId,
      agentId: input.context.agentId,
      path: input.changedFile.path,
      rule: input.rule,
      error: error instanceof Error ? error.message : String(error),
    });
    return { key: null };
  }

  try {
    await input.notify({
      context: input.context,
      changedFile: input.changedFile,
      rule: input.rule,
      quarantineKey: stored.key,
    });
  } catch (error) {
    console.warn(
      "[workspace-reconcile] secret quarantine notification failed",
      {
        tenantId: input.context.tenantId,
        threadId: input.context.threadId,
        agentId: input.context.agentId,
        path: input.changedFile.path,
        rule: input.rule,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return { key: stored.key };
}

function secretQuarantineKey(input: {
  tenantSlug: string;
  threadId: string;
  threadTurnId: string;
  path: string;
  content: string;
}): string {
  return [
    "tenants",
    input.tenantSlug,
    "_quarantine",
    "workspace-secrets",
    input.threadId,
    input.threadTurnId,
    `${hashText(`${input.path}\0${input.content}`)}.txt`,
  ].join("/");
}

async function notifySecretQuarantineMessage(input: {
  context: ReconcileContext;
  changedFile: ChangedFilePayload;
  rule: string;
  quarantineKey: string | null;
}): Promise<void> {
  await getDb()
    .insert(messages)
    .values({
      thread_id: input.context.threadId,
      tenant_id: input.context.tenantId,
      role: "assistant",
      content: `A workspace file was quarantined because it matched secret-scan rule ${input.rule}: ${input.changedFile.path}.`,
      sender_type: "system",
      sender_id: null,
      metadata: {
        kind: "workspace_secret_quarantine",
        path: input.changedFile.path,
        rule: input.rule,
        quarantineKey: input.quarantineKey,
      },
      created_at: new Date(),
    });
}

function isAuthorizedSecretOverride(
  override: SecretQuarantineOverride | undefined,
): boolean {
  return Boolean(
    override?.actorType === "operator" &&
    override.operatorId.trim() &&
    override.reason.trim(),
  );
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function logRejectedLane(
  context: ReconcileContext,
  path: string,
  code: string,
): void {
  console.warn("[workspace-reconcile] rejected", {
    tenantId: context.tenantId,
    threadId: context.threadId,
    agentId: context.agentId,
    path,
    code,
  });
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === "PreconditionFailed" || status === 412;
}

function isCanonicalRelativePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return false;
  }
  return path === segments.join("/");
}
