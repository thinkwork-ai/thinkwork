import { and, asc, eq, ne, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  DesktopPiRuntimeInvocation,
  PiSdkEmbeddingContract,
  PreparedDesktopPiRuntimeSession,
} from "@thinkwork/pi-runtime-core/desktop-session";
import { db } from "../db.js";
import {
  messages,
  spaceMembers,
  spaces,
  tenantMembers,
  threadAttachments,
  threadTurns,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import {
  AgentNotFoundError,
  resolveAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";
import {
  buildDesktopSidecarCredentials,
  createDesktopFinalizeToken,
  DEFAULT_DESKTOP_SESSION_TTL_MS,
  hashDesktopFinalizeToken,
  type DesktopSidecarCredentials,
} from "./sidecar-credentials.js";
import {
  DESKTOP_RUNTIME_DISPATCHER,
  DESKTOP_RUNTIME_HOST,
  DESKTOP_RUNTIME_INVOCATION_SOURCE,
} from "./dispatch-mode.js";
import type { AgentRuntimeType } from "../resolve-runtime-function-name.js";
import type { EffectiveWorkspacePolicy } from "../workspace-renderer/index.js";
import { notifyThreadTurnUpdate } from "../chat-finalize/notify.js";

const HISTORY_LIMIT = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_RENDERER_FUNCTION_NAME =
  process.env.WORKSPACE_RENDERER_FUNCTION_NAME || "";

const lambdaClient = new LambdaClient({});

const DESKTOP_PI_SDK_EMBEDDING_CONTRACT = {
  packageName: "@earendil-works/pi-coding-agent",
  minimumVersion: "0.76.0",
  docsUrl: "https://pi.dev/docs/latest/sdk",
  sessionFactory: "createAgentSession",
  runtimeFactory: "createAgentSessionRuntime",
  sessionManager: "in-memory",
  authStorage: "runtime-overrides",
  resourceLoader: "thinkwork-rendered-workspace",
  modelSource: "prepared-invocation",
  toolSource: "thinkwork-prepared-policy",
} satisfies PiSdkEmbeddingContract;

export interface DesktopRuntimeAuth {
  principalId: string | null;
  tenantId: string | null;
  email: string | null;
  authType: "cognito" | "apikey" | "service";
  agentId: string | null;
}

export interface DesktopRuntimeAttachment {
  attachmentId: string;
  s3Key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PrepareLocalPiRuntimeSessionInput {
  auth: DesktopRuntimeAuth;
  agentId: string;
  threadId: string;
  messageId?: string;
  userMessage: string;
  messageAttachments?: DesktopRuntimeAttachment[];
}

export interface PrepareLocalPiWorkspacePrewarmInput {
  auth: DesktopRuntimeAuth;
  agentId: string;
  spaceId: string;
  purpose?: "chat" | "eval";
}

export interface PrepareLocalPiEvalRuntimeSessionInput {
  auth: DesktopRuntimeAuth;
  agentId: string;
  spaceId: string;
  evalRunId: string;
  testCaseId: string;
  userMessage: string;
}

export type PreparedLocalPiRuntimeSession =
  PreparedDesktopPiRuntimeSession<DesktopSidecarCredentials>;

export interface PreparedLocalPiWorkspacePrewarmSession {
  expiresAt: string;
  sidecarCredentials: DesktopSidecarCredentials;
  workspace: {
    bucket: string;
    renderedPrefix: string;
  };
  partition: {
    stage?: string;
    tenantSlug: string;
    agentSlug: string;
    spaceId: string;
    userId: string;
  };
}

interface CallerRow {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
}

interface ThreadAccessRow {
  id: string;
  tenantId: string;
  agentId: string | null;
  spaceId: string;
}

interface SpaceAccessRow {
  id: string;
  slug: string | null;
  accessMode: string;
  status: string;
}

interface MessageHistoryRow {
  role: string | null;
  content: string | null;
}

export interface RenderWorkspaceTupleForInvokeResult {
  rendered: boolean;
  renderedPrefix?: string;
  cacheStatus?: "hit" | "miss";
  activeSpace?: {
    id: string;
    slug: string;
    name: string;
    isDefault: boolean;
  };
  effectivePolicy?: EffectiveWorkspacePolicy;
  errorCode?: string;
  statusCode?: number;
  reason?: string;
}

export interface PrepareLocalPiRuntimeSessionDeps {
  now(): Date;
  loadCallerByEmail(email: string): Promise<CallerRow | null>;
  loadTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<{ role: string; status: string } | null>;
  loadThreadForAccess(input: {
    tenantId: string;
    threadId: string;
  }): Promise<ThreadAccessRow | null>;
  loadSpaceForAccess(input: {
    tenantId: string;
    spaceId: string;
  }): Promise<SpaceAccessRow | null>;
  loadSpaceMembership(input: {
    tenantId: string;
    spaceId: string;
    userId: string;
  }): Promise<{ role: string } | null>;
  resolveRuntimeConfig(input: {
    tenantId: string;
    agentId: string;
    spaceId: string | null;
    currentUserId: string;
    currentUserEmail: string;
  }): Promise<AgentRuntimeConfig>;
  loadMessageHistory(input: {
    threadId: string;
    excludeMessageId?: string;
  }): Promise<MessageHistoryRow[]>;
  renderWorkspace(input: {
    tenantId: string;
    agentId: string;
    spaceId: string;
    threadId: string;
    threadSlug?: string | null;
    userId: string;
    agentBlockedTools: string[];
  }): Promise<RenderWorkspaceTupleForInvokeResult>;
  createThreadTurn(input: {
    tenantId: string;
    agentId: string;
    threadId: string;
    runtimeType: string;
    turnNumber: number;
    contextSnapshot: Record<string, unknown>;
  }): Promise<{ id: string }>;
  countThreadTurns(threadId: string): Promise<number>;
  updateTurnWakeupRequestId(turnId: string): Promise<void>;
  notifyTurnStarted(input: {
    runId: string;
    tenantId: string;
    threadId: string;
    agentId: string;
  }): Promise<void>;
  getTraceId(): string;
  /**
   * Resolve the attachments linked to a message from the database (canonical
   * s3 keys), the same way the cloud wakeup-processor does. The desktop client
   * only knows attachment ids, so the server derives the rest — never trusting
   * a client-supplied s3 key.
   */
  loadMessageAttachments(input: {
    tenantId: string;
    threadId: string;
    messageId: string;
  }): Promise<DesktopRuntimeAttachment[]>;
  /**
   * Mint a short-lived presigned GET URL so the desktop runtime (which holds
   * no AWS credentials) can download an attachment over plain HTTPS. Returns
   * null when presigning is unavailable.
   */
  presignAttachmentDownload(input: {
    bucket: string;
    key: string;
  }): Promise<string | null>;
  env: {
    thinkworkApiUrl?: string;
    workspaceBucket?: string;
    hindsightEndpoint?: string;
  };
}

export class DesktopRuntimeSessionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DesktopRuntimeSessionError";
  }
}

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new DesktopRuntimeSessionError(
      `Invalid ${field}`,
      400,
      "BAD_REQUEST",
    );
  }
}

export async function renderWorkspaceTupleForDesktopRuntime(input: {
  tenantId: string;
  agentId: string;
  spaceId: string;
  threadId: string;
  threadSlug?: string | null;
  userId: string;
  agentBlockedTools: unknown;
  agentAllowedTools?: unknown;
}): Promise<RenderWorkspaceTupleForInvokeResult> {
  if (!WORKSPACE_RENDERER_FUNCTION_NAME) {
    return { rendered: false, reason: "workspace_renderer_unconfigured" };
  }

  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: WORKSPACE_RENDERER_FUNCTION_NAME,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          tenantId: input.tenantId,
          agentId: input.agentId,
          spaceId: input.spaceId,
          threadId: input.threadId,
          threadSlug: input.threadSlug ?? input.threadId,
          userId: input.userId,
          agentBlockedTools: input.agentBlockedTools,
          agentAllowedTools: input.agentAllowedTools,
        }),
      ),
    }),
  );

  const rawPayload = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "{}";
  if (response.FunctionError) {
    return {
      rendered: false,
      reason: `workspace_renderer_function_error:${response.FunctionError}`,
    };
  }

  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
  if (parsed.ok !== true || typeof parsed.renderedPrefix !== "string") {
    const errorPayload =
      typeof parsed.error === "object" && parsed.error
        ? (parsed.error as Record<string, unknown>)
        : null;
    return {
      rendered: false,
      errorCode:
        typeof errorPayload?.code === "string" ? errorPayload.code : undefined,
      statusCode:
        typeof parsed.statusCode === "number" ? parsed.statusCode : undefined,
      reason: errorPayload
        ? JSON.stringify(errorPayload)
        : "workspace_renderer_failed",
    };
  }

  return {
    rendered: true,
    renderedPrefix: parsed.renderedPrefix,
    activeSpace: isActiveSpacePayload(parsed.activeSpace)
      ? parsed.activeSpace
      : undefined,
    effectivePolicy: isEffectiveWorkspacePolicy(parsed.effectivePolicy)
      ? parsed.effectivePolicy
      : undefined,
    cacheStatus:
      parsed.cacheStatus === "hit" || parsed.cacheStatus === "miss"
        ? parsed.cacheStatus
        : undefined,
  };
}

function isActiveSpacePayload(value: unknown): value is {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.slug === "string" &&
    typeof obj.name === "string" &&
    typeof obj.isDefault === "boolean"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || isStringArray(value);
}

function isEffectiveWorkspacePolicy(
  value: unknown,
): value is EffectiveWorkspacePolicy {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    isStringArray(obj.blockedTools) &&
    isNullableStringArray(obj.allowedTools) &&
    isNullableStringArray(obj.mcpAllowedServers) &&
    isStringArray(obj.mcpBlockedServers) &&
    isStringArray(obj.diagnostics)
  );
}

export function defaultPrepareLocalPiRuntimeSessionDeps(): PrepareLocalPiRuntimeSessionDeps {
  return {
    now: () => new Date(),
    async loadCallerByEmail(email) {
      const [row] = await db
        .select({
          id: users.id,
          tenantId: users.tenant_id,
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return row?.tenantId && row.email
        ? {
            id: row.id,
            tenantId: row.tenantId,
            email: row.email,
            name: row.name ?? null,
          }
        : null;
    },
    async loadTenantMembership(input) {
      const [row] = await db
        .select({ role: tenantMembers.role, status: tenantMembers.status })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenant_id, input.tenantId),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, input.userId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async loadThreadForAccess(input) {
      const [row] = await db
        .select({
          id: threads.id,
          tenantId: threads.tenant_id,
          agentId: threads.agent_id,
          spaceId: threads.space_id,
        })
        .from(threads)
        .where(
          and(
            eq(threads.id, input.threadId),
            eq(threads.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      return row
        ? {
            id: row.id,
            tenantId: row.tenantId,
            agentId: row.agentId,
            spaceId: row.spaceId,
          }
        : null;
    },
    async loadSpaceForAccess(input) {
      const [row] = await db
        .select({
          id: spaces.id,
          slug: spaces.slug,
          accessMode: spaces.access_mode,
          status: spaces.status,
        })
        .from(spaces)
        .where(
          and(
            eq(spaces.id, input.spaceId),
            eq(spaces.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      return row
        ? {
            id: row.id,
            slug: row.slug ?? null,
            accessMode: row.accessMode,
            status: row.status,
          }
        : null;
    },
    async loadSpaceMembership(input) {
      const [row] = await db
        .select({ role: spaceMembers.role })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.tenant_id, input.tenantId),
            eq(spaceMembers.space_id, input.spaceId),
            eq(spaceMembers.user_id, input.userId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async resolveRuntimeConfig(input) {
      return resolveAgentRuntimeConfig({
        tenantId: input.tenantId,
        agentId: input.agentId,
        spaceId: input.spaceId,
        currentUserId: input.currentUserId,
        currentUserEmail: input.currentUserEmail,
        allowHumanPairEmailFallback: true,
        logPrefix: "[desktop-runtime-session]",
        thinkworkApiUrl: process.env.THINKWORK_API_URL,
        thinkworkApiSecret: "",
        appsyncApiKey: "",
      });
    },
    async loadMessageHistory(input) {
      const conditions = [eq(messages.thread_id, input.threadId)];
      if (input.excludeMessageId) {
        conditions.push(ne(messages.id, input.excludeMessageId));
      }
      return db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(and(...conditions))
        .orderBy(sql`${messages.created_at} desc`)
        .limit(HISTORY_LIMIT);
    },
    async renderWorkspace(input) {
      return renderWorkspaceTupleForDesktopRuntime({
        tenantId: input.tenantId,
        agentId: input.agentId,
        spaceId: input.spaceId,
        threadId: input.threadId,
        threadSlug: input.threadSlug ?? input.threadId,
        userId: input.userId,
        agentBlockedTools: input.agentBlockedTools,
      });
    },
    async countThreadTurns(threadId) {
      const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(threadTurns)
        .where(eq(threadTurns.thread_id, threadId));
      return countRow?.count || 0;
    },
    async createThreadTurn(input) {
      const [row] = await db
        .insert(threadTurns)
        .values({
          tenant_id: input.tenantId,
          agent_id: input.agentId,
          thread_id: input.threadId,
          invocation_source: DESKTOP_RUNTIME_INVOCATION_SOURCE,
          runtime_type: input.runtimeType,
          status: "running",
          started_at: new Date(),
          last_activity_at: new Date(),
          turn_number: input.turnNumber,
          context_snapshot: input.contextSnapshot,
        })
        .returning({ id: threadTurns.id });
      if (!row?.id) {
        throw new Error("Failed to create thread turn");
      }
      return row;
    },
    async updateTurnWakeupRequestId(turnId) {
      await db
        .update(threadTurns)
        .set({ wakeup_request_id: turnId })
        .where(eq(threadTurns.id, turnId));
    },
    async notifyTurnStarted(input) {
      await notifyThreadTurnUpdate({
        runId: input.runId,
        tenantId: input.tenantId,
        threadId: input.threadId,
        agentId: input.agentId,
        status: "running",
        triggerName: "Desktop",
      });
    },
    getTraceId() {
      const xrayTraceId = process.env._X_AMZN_TRACE_ID;
      const rootMatch = xrayTraceId?.match(/Root=([^;]+)/);
      return rootMatch?.[1] ?? randomBytes(16).toString("hex");
    },
    async loadMessageAttachments({ tenantId, threadId, messageId }) {
      const [message] = await db
        .select({ metadata: messages.metadata })
        .from(messages)
        .where(
          and(
            eq(messages.tenant_id, tenantId),
            eq(messages.thread_id, threadId),
            eq(messages.id, messageId),
          ),
        )
        .limit(1);
      const currentIds = new Set(
        parseAttachmentIdsFromMessageMetadata(message?.metadata),
      );
      if (currentIds.size === 0) return [];
      const rows = await db
        .select({
          id: threadAttachments.id,
          s3Key: threadAttachments.s3_key,
          name: threadAttachments.name,
          mimeType: threadAttachments.mime_type,
          sizeBytes: threadAttachments.size_bytes,
        })
        .from(threadAttachments)
        .where(
          and(
            eq(threadAttachments.tenant_id, tenantId),
            eq(threadAttachments.thread_id, threadId),
          ),
        )
        .orderBy(asc(threadAttachments.created_at), asc(threadAttachments.id));
      return rows
        .filter((row) => currentIds.has(row.id) && row.s3Key)
        .map((row) => ({
          attachmentId: row.id,
          s3Key: row.s3Key as string,
          name: row.name ?? "attachment",
          mimeType: row.mimeType ?? "application/octet-stream",
          sizeBytes: row.sizeBytes ?? 0,
        }));
    },
    async presignAttachmentDownload({ bucket, key }) {
      return presignAttachmentDownloadUrl({ bucket, key });
    },
    env: {
      thinkworkApiUrl:
        process.env.THINKWORK_API_URL || process.env.MCP_BASE_URL,
      workspaceBucket: process.env.WORKSPACE_BUCKET,
      hindsightEndpoint: process.env.HINDSIGHT_ENDPOINT,
    },
  };
}

/** Extract attachment ids from a message's `metadata.attachments` JSON. */
export function parseAttachmentIdsFromMessageMetadata(
  metadata: unknown,
): string[] {
  let parsed: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return [];
    }
  }
  const attachments = (parsed as { attachments?: unknown })?.attachments;
  if (!Array.isArray(attachments)) return [];
  const ids: string[] = [];
  for (const entry of attachments) {
    const id =
      typeof entry === "string"
        ? entry
        : typeof (entry as { attachmentId?: unknown })?.attachmentId ===
            "string"
          ? (entry as { attachmentId: string }).attachmentId
          : "";
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

const ATTACHMENT_DOWNLOAD_TTL_SECONDS = 15 * 60;
let cachedAttachmentS3Client: S3Client | null = null;

function attachmentS3Client(): S3Client {
  if (!cachedAttachmentS3Client) {
    cachedAttachmentS3Client = new S3Client({});
  }
  return cachedAttachmentS3Client;
}

export async function presignAttachmentDownloadUrl(input: {
  bucket: string;
  key: string;
}): Promise<string | null> {
  if (!input.bucket || !input.key) return null;
  try {
    return await getSignedUrl(
      attachmentS3Client(),
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      { expiresIn: ATTACHMENT_DOWNLOAD_TTL_SECONDS },
    );
  } catch {
    return null;
  }
}

/**
 * Map staged attachment refs into the desktop invocation payload, attaching a
 * short-lived presigned `download_url` for each so the credential-less desktop
 * runtime can fetch the bytes. Attachments that can't be presigned are dropped
 * (the turn proceeds without them rather than failing).
 */
async function buildDesktopMessageAttachments(
  attachments: DesktopRuntimeAttachment[] | undefined,
  deps: PrepareLocalPiRuntimeSessionDeps,
): Promise<
  | Array<{
      attachment_id: string;
      s3_key: string;
      download_url: string;
      name: string;
      mime_type: string;
      size_bytes: number;
    }>
  | undefined
> {
  if (!attachments || attachments.length === 0) return undefined;
  const bucket = deps.env.workspaceBucket;
  if (!bucket) return undefined;
  const mapped = await Promise.all(
    attachments.map(async (att) => {
      const downloadUrl = await deps.presignAttachmentDownload({
        bucket,
        key: att.s3Key,
      });
      if (!downloadUrl) return null;
      return {
        attachment_id: att.attachmentId,
        s3_key: att.s3Key,
        download_url: downloadUrl,
        name: att.name,
        mime_type: att.mimeType,
        size_bytes: att.sizeBytes,
      };
    }),
  );
  const present = mapped.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );
  return present.length > 0 ? present : undefined;
}

export async function prepareLocalPiRuntimeSession(
  input: PrepareLocalPiRuntimeSessionInput,
  deps: PrepareLocalPiRuntimeSessionDeps = defaultPrepareLocalPiRuntimeSessionDeps(),
): Promise<PreparedLocalPiRuntimeSession> {
  assertUuid(input.agentId, "agentId");
  assertUuid(input.threadId, "threadId");
  if (input.messageId) assertUuid(input.messageId, "messageId");
  if (!input.userMessage.trim()) {
    throw new DesktopRuntimeSessionError(
      "userMessage is required",
      400,
      "BAD_REQUEST",
    );
  }
  if (input.auth.authType !== "cognito" || !input.auth.email) {
    throw new DesktopRuntimeSessionError(
      "Desktop runtime sessions require Cognito user authentication",
      401,
      "UNAUTHORIZED",
    );
  }

  const caller = await deps.loadCallerByEmail(input.auth.email.toLowerCase());
  if (!caller) {
    throw new DesktopRuntimeSessionError(
      "Caller is not bootstrapped",
      403,
      "CALLER_NOT_BOOTSTRAPPED",
    );
  }
  if (input.auth.tenantId && input.auth.tenantId !== caller.tenantId) {
    throw new DesktopRuntimeSessionError(
      "Caller tenant does not match token tenant",
      403,
      "TENANT_MISMATCH",
    );
  }

  const membership = await deps.loadTenantMembership({
    tenantId: caller.tenantId,
    userId: caller.id,
  });
  if (!membership || membership.status !== "active") {
    throw new DesktopRuntimeSessionError(
      "Caller is not an active tenant member",
      403,
      "TENANT_ACCESS_DENIED",
    );
  }

  const thread = await deps.loadThreadForAccess({
    tenantId: caller.tenantId,
    threadId: input.threadId,
  });
  if (!thread) {
    throw new DesktopRuntimeSessionError(
      "Thread not found",
      404,
      "THREAD_NOT_FOUND",
    );
  }
  if (thread.agentId && thread.agentId !== input.agentId) {
    throw new DesktopRuntimeSessionError(
      "Thread is not assigned to the requested agent",
      403,
      "AGENT_THREAD_MISMATCH",
    );
  }

  const space = await deps.loadSpaceForAccess({
    tenantId: caller.tenantId,
    spaceId: thread.spaceId,
  });
  if (!space || space.status !== "active") {
    throw new DesktopRuntimeSessionError(
      "Space not found",
      404,
      "SPACE_NOT_FOUND",
    );
  }
  if (space.accessMode === "private") {
    const spaceMember = await deps.loadSpaceMembership({
      tenantId: caller.tenantId,
      spaceId: space.id,
      userId: caller.id,
    });
    if (!spaceMember) {
      throw new DesktopRuntimeSessionError(
        "Caller does not have access to this Space",
        403,
        "SPACE_ACCESS_DENIED",
      );
    }
  }

  let runtimeConfig: AgentRuntimeConfig;
  try {
    runtimeConfig = await deps.resolveRuntimeConfig({
      tenantId: caller.tenantId,
      agentId: input.agentId,
      spaceId: thread.spaceId,
      currentUserId: caller.id,
      currentUserEmail: caller.email,
    });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      throw new DesktopRuntimeSessionError(
        "Agent not found",
        404,
        "AGENT_NOT_FOUND",
      );
    }
    throw err;
  }

  const runtimeType: AgentRuntimeType = runtimeConfig.runtimeType;
  const agentModel = runtimeConfig.templateModel;

  let renderedWorkspace: RenderWorkspaceTupleForInvokeResult = {
    rendered: false,
    reason: "not_attempted",
  };
  let renderedWorkspacePrefix: string | undefined;
  let effectiveBlockedTools = runtimeConfig.blockedTools;
  renderedWorkspace = await deps.renderWorkspace({
    tenantId: caller.tenantId,
    agentId: input.agentId,
    spaceId: thread.spaceId,
    threadId: input.threadId,
    threadSlug: input.threadId,
    userId: caller.id,
    agentBlockedTools: runtimeConfig.blockedTools,
  });
  if (renderedWorkspace.rendered) {
    renderedWorkspacePrefix = renderedWorkspace.renderedPrefix;
    effectiveBlockedTools =
      renderedWorkspace.effectivePolicy?.blockedTools ??
      runtimeConfig.blockedTools;
  } else if (renderedWorkspace.errorCode === "SpaceAccessDenied") {
    throw new DesktopRuntimeSessionError(
      renderedWorkspace.reason ?? "Workspace render access denied",
      403,
      "SPACE_ACCESS_DENIED",
    );
  }

  const priorMessageRows = await deps.loadMessageHistory({
    threadId: input.threadId,
    excludeMessageId: input.messageId,
  });
  const messagesHistory = priorMessageRows
    .reverse()
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0,
    )
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

  const finalizeToken = createDesktopFinalizeToken();
  const now = deps.now();
  const expiresAt = new Date(
    now.getTime() + DEFAULT_DESKTOP_SESSION_TTL_MS,
  ).toISOString();
  const turnNumber = (await deps.countThreadTurns(input.threadId)) + 1;
  const sidecarCredentials = buildDesktopSidecarCredentials({
    now,
    workspaceBucket: deps.env.workspaceBucket,
    renderedWorkspacePrefix,
    hindsightEndpoint: deps.env.hindsightEndpoint,
  });

  const contextSnapshot = {
    runtime_type: runtimeType,
    runtime_host: DESKTOP_RUNTIME_HOST,
    model: agentModel,
    agent_slug: runtimeConfig.agentSlug || undefined,
    space_id: thread.spaceId,
    dispatcher: DESKTOP_RUNTIME_DISPATCHER,
    desktop_runtime_session: {
      finalize_token_sha256: hashDesktopFinalizeToken(finalizeToken),
      expires_at: expiresAt,
      caller_user_id: caller.id,
      caller_email: caller.email,
    },
  };

  const turn = await deps.createThreadTurn({
    tenantId: caller.tenantId,
    agentId: input.agentId,
    threadId: input.threadId,
    runtimeType,
    turnNumber,
    contextSnapshot,
  });
  await deps.updateTurnWakeupRequestId(turn.id);
  await deps.notifyTurnStarted({
    runId: turn.id,
    tenantId: caller.tenantId,
    threadId: input.threadId,
    agentId: input.agentId,
  });

  const isEffectivelyBlocked = (toolName: string): boolean =>
    effectiveBlockedTools.includes(toolName);
  const isAnyEffectivelyBlocked = (...toolNames: string[]): boolean =>
    toolNames.some((toolName) => isEffectivelyBlocked(toolName));

  const finalizeCallbackUrl = deps.env.thinkworkApiUrl
    ? `${deps.env.thinkworkApiUrl.replace(/\/$/, "")}/api/threads/${input.threadId}/finalize`
    : null;

  // The desktop client only knows attachment ids, so resolve the canonical
  // attachment list (with s3 keys) server-side from the message — same as the
  // cloud wakeup-processor. Fall back to any explicitly-passed list for tests.
  const resolvedAttachments = input.messageId
    ? await deps.loadMessageAttachments({
        tenantId: caller.tenantId,
        threadId: input.threadId,
        messageId: input.messageId,
      })
    : (input.messageAttachments ?? []);
  const messageAttachments = await buildDesktopMessageAttachments(
    resolvedAttachments,
    deps,
  );

  const invocation: DesktopPiRuntimeInvocation = {
    pi_sdk: DESKTOP_PI_SDK_EMBEDDING_CONTRACT,
    tenant_id: caller.tenantId,
    workspace_tenant_id: caller.tenantId,
    assistant_id: input.agentId,
    thread_id: input.threadId,
    user_id: caller.id,
    current_user_email: caller.email,
    trace_id: deps.getTraceId(),
    message: input.userMessage,
    messages_history: messagesHistory,
    use_memory: true,
    tenant_slug: runtimeConfig.tenantSlug || undefined,
    instance_id: runtimeConfig.agentSlug || undefined,
    agent_name: runtimeConfig.agentName,
    system_prompt: runtimeConfig.agentSystemPrompt || undefined,
    human_name: runtimeConfig.humanName || caller.name || undefined,
    workspace_bucket: deps.env.workspaceBucket || undefined,
    rendered_workspace_prefix: renderedWorkspacePrefix,
    thinkwork_api_url: deps.env.thinkworkApiUrl || undefined,
    hindsight_endpoint: deps.env.hindsightEndpoint || undefined,
    web_search_config: !isAnyEffectivelyBlocked("web-search", "web_search")
      ? runtimeConfig.webSearchConfig
      : undefined,
    send_email_config:
      runtimeConfig.sendEmailConfig && !isEffectivelyBlocked("send_email")
        ? {
            ...runtimeConfig.sendEmailConfig,
            apiSecret: undefined,
            threadId: input.threadId,
          }
        : undefined,
    context_engine_enabled:
      runtimeConfig.contextEngineEnabled &&
      !isAnyEffectivelyBlocked("query_context", "context_engine")
        ? true
        : undefined,
    context_engine_config: !isAnyEffectivelyBlocked(
      "query_context",
      "context_engine",
    )
      ? runtimeConfig.contextEngineConfig
      : undefined,
    runtime_type: runtimeType,
    model: agentModel,
    budget_monthly_cents: runtimeConfig.budgetMonthlyCents,
    budget_paused: runtimeConfig.budgetPaused,
    skills:
      runtimeConfig.skillsConfig.length > 0
        ? runtimeConfig.skillsConfig
        : undefined,
    knowledge_bases: runtimeConfig.knowledgeBasesConfig,
    trigger_channel: "desktop",
    runtime_host: DESKTOP_RUNTIME_HOST,
    guardrail_config: runtimeConfig.guardrailConfig || undefined,
    mcp_configs:
      runtimeConfig.mcpConfigs.length > 0
        ? runtimeConfig.mcpConfigs
        : undefined,
    blocked_tools:
      effectiveBlockedTools.length > 0 ? effectiveBlockedTools : undefined,
    browser_automation_enabled:
      runtimeConfig.browserAutomationEnabled &&
      !isAnyEffectivelyBlocked("browser_automation", "browser")
        ? true
        : undefined,
    effective_workspace_policy: renderedWorkspace.rendered
      ? renderedWorkspace.effectivePolicy
      : undefined,
    turn_context: {
      spaceId: renderedWorkspace.rendered
        ? (renderedWorkspace.activeSpace?.id ?? thread.spaceId)
        : thread.spaceId,
      tenantSlug: runtimeConfig.tenantSlug || undefined,
      spaceSlug: renderedWorkspace.rendered
        ? (renderedWorkspace.activeSpace?.slug ?? space.slug ?? undefined)
        : (space.slug ?? undefined),
      renderedWorkspacePrefix,
    },
    message_attachments: messageAttachments,
    finalize_callback_url: finalizeCallbackUrl || undefined,
    finalize_callback_secret: finalizeToken,
    thread_turn_id: turn.id,
  };

  delete invocation.thinkwork_api_secret;
  delete invocation.api_auth_secret;
  delete invocation.appsync_api_key;

  return {
    threadTurnId: turn.id,
    expiresAt,
    finalizeCallbackUrl,
    finalizeCallbackSecret: finalizeToken,
    sidecarCredentials,
    invocation,
  };
}

export async function prepareLocalPiEvalRuntimeSession(
  input: PrepareLocalPiEvalRuntimeSessionInput,
  deps: PrepareLocalPiRuntimeSessionDeps = defaultPrepareLocalPiRuntimeSessionDeps(),
): Promise<PreparedLocalPiRuntimeSession> {
  assertUuid(input.agentId, "agentId");
  assertUuid(input.spaceId, "spaceId");
  assertUuid(input.evalRunId, "evalRunId");
  assertUuid(input.testCaseId, "testCaseId");
  if (!input.userMessage.trim()) {
    throw new DesktopRuntimeSessionError(
      "userMessage is required",
      400,
      "BAD_REQUEST",
    );
  }
  if (input.auth.authType !== "cognito" || !input.auth.email) {
    throw new DesktopRuntimeSessionError(
      "Desktop eval runtime sessions require Cognito user authentication",
      401,
      "UNAUTHORIZED",
    );
  }

  const caller = await deps.loadCallerByEmail(input.auth.email.toLowerCase());
  if (!caller) {
    throw new DesktopRuntimeSessionError(
      "Caller is not bootstrapped",
      403,
      "CALLER_NOT_BOOTSTRAPPED",
    );
  }
  if (input.auth.tenantId && input.auth.tenantId !== caller.tenantId) {
    throw new DesktopRuntimeSessionError(
      "Caller tenant does not match token tenant",
      403,
      "TENANT_MISMATCH",
    );
  }

  const membership = await deps.loadTenantMembership({
    tenantId: caller.tenantId,
    userId: caller.id,
  });
  if (!membership || membership.status !== "active") {
    throw new DesktopRuntimeSessionError(
      "Caller is not an active tenant member",
      403,
      "TENANT_ACCESS_DENIED",
    );
  }

  const space = await deps.loadSpaceForAccess({
    tenantId: caller.tenantId,
    spaceId: input.spaceId,
  });
  if (!space || space.status !== "active") {
    throw new DesktopRuntimeSessionError(
      "Space not found",
      404,
      "SPACE_NOT_FOUND",
    );
  }
  if (space.accessMode === "private") {
    const spaceMember = await deps.loadSpaceMembership({
      tenantId: caller.tenantId,
      spaceId: space.id,
      userId: caller.id,
    });
    if (!spaceMember) {
      throw new DesktopRuntimeSessionError(
        "Caller does not have access to this Space",
        403,
        "SPACE_ACCESS_DENIED",
      );
    }
  }

  let runtimeConfig: AgentRuntimeConfig;
  try {
    runtimeConfig = await deps.resolveRuntimeConfig({
      tenantId: caller.tenantId,
      agentId: input.agentId,
      spaceId: input.spaceId,
      currentUserId: caller.id,
      currentUserEmail: caller.email,
    });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      throw new DesktopRuntimeSessionError(
        "Agent not found",
        404,
        "AGENT_NOT_FOUND",
      );
    }
    throw err;
  }

  const runtimeType: AgentRuntimeType = runtimeConfig.runtimeType;
  const agentModel = runtimeConfig.templateModel;
  const threadSlug = `eval-${input.evalRunId}-${input.testCaseId}`;
  let renderedWorkspace: RenderWorkspaceTupleForInvokeResult = {
    rendered: false,
    reason: "not_attempted",
  };
  let renderedWorkspacePrefix: string | undefined;
  let effectiveBlockedTools = runtimeConfig.blockedTools;
  renderedWorkspace = await deps.renderWorkspace({
    tenantId: caller.tenantId,
    agentId: input.agentId,
    spaceId: input.spaceId,
    threadId: input.evalRunId,
    threadSlug,
    userId: caller.id,
    agentBlockedTools: runtimeConfig.blockedTools,
  });
  if (renderedWorkspace.rendered) {
    renderedWorkspacePrefix = renderedWorkspace.renderedPrefix;
    effectiveBlockedTools =
      renderedWorkspace.effectivePolicy?.blockedTools ??
      runtimeConfig.blockedTools;
  } else if (renderedWorkspace.errorCode === "SpaceAccessDenied") {
    throw new DesktopRuntimeSessionError(
      renderedWorkspace.reason ?? "Workspace render access denied",
      403,
      "SPACE_ACCESS_DENIED",
    );
  }

  const finalizeToken = createDesktopFinalizeToken();
  const now = deps.now();
  const expiresAt = new Date(
    now.getTime() + DEFAULT_DESKTOP_SESSION_TTL_MS,
  ).toISOString();
  const sidecarCredentials = buildDesktopSidecarCredentials({
    now,
    workspaceBucket: deps.env.workspaceBucket,
    renderedWorkspacePrefix,
    hindsightEndpoint: undefined,
  });

  const isEffectivelyBlocked = (toolName: string): boolean =>
    effectiveBlockedTools.includes(toolName);
  const isAnyEffectivelyBlocked = (...toolNames: string[]): boolean =>
    toolNames.some((toolName) => isEffectivelyBlocked(toolName));

  const evalThreadTurnId = `eval-${input.evalRunId}-${input.testCaseId}`;
  const invocation: DesktopPiRuntimeInvocation = {
    pi_sdk: DESKTOP_PI_SDK_EMBEDDING_CONTRACT,
    tenant_id: caller.tenantId,
    workspace_tenant_id: caller.tenantId,
    assistant_id: input.agentId,
    thread_id: input.evalRunId,
    user_id: caller.id,
    current_user_email: caller.email,
    trace_id: deps.getTraceId(),
    message: input.userMessage,
    messages_history: [],
    use_memory: false,
    tenant_slug: runtimeConfig.tenantSlug || undefined,
    instance_id: runtimeConfig.agentSlug || undefined,
    agent_name: runtimeConfig.agentName,
    system_prompt: runtimeConfig.agentSystemPrompt || undefined,
    human_name: runtimeConfig.humanName || caller.name || undefined,
    workspace_bucket: deps.env.workspaceBucket || undefined,
    rendered_workspace_prefix: renderedWorkspacePrefix,
    web_search_config: !isAnyEffectivelyBlocked("web-search", "web_search")
      ? runtimeConfig.webSearchConfig
      : undefined,
    runtime_type: runtimeType,
    model: agentModel,
    budget_monthly_cents: runtimeConfig.budgetMonthlyCents,
    budget_paused: runtimeConfig.budgetPaused,
    skills:
      runtimeConfig.skillsConfig.length > 0
        ? runtimeConfig.skillsConfig
        : undefined,
    knowledge_bases: runtimeConfig.knowledgeBasesConfig,
    trigger_channel: "desktop",
    runtime_host: DESKTOP_RUNTIME_HOST,
    guardrail_config: runtimeConfig.guardrailConfig || undefined,
    blocked_tools:
      effectiveBlockedTools.length > 0 ? effectiveBlockedTools : undefined,
    browser_automation_enabled:
      runtimeConfig.browserAutomationEnabled &&
      !isAnyEffectivelyBlocked("browser_automation", "browser")
        ? true
        : undefined,
    effective_workspace_policy: renderedWorkspace.rendered
      ? renderedWorkspace.effectivePolicy
      : undefined,
    turn_context: {
      evalRunId: input.evalRunId,
      testCaseId: input.testCaseId,
      spaceId: renderedWorkspace.rendered
        ? (renderedWorkspace.activeSpace?.id ?? input.spaceId)
        : input.spaceId,
      tenantSlug: runtimeConfig.tenantSlug || undefined,
      spaceSlug: renderedWorkspace.rendered
        ? (renderedWorkspace.activeSpace?.slug ?? space.slug ?? undefined)
        : (space.slug ?? undefined),
      renderedWorkspacePrefix,
    },
    finalize_callback_secret: finalizeToken,
    thread_turn_id: evalThreadTurnId,
  };

  delete invocation.thinkwork_api_secret;
  delete invocation.api_auth_secret;
  delete invocation.appsync_api_key;

  return {
    threadTurnId: evalThreadTurnId,
    expiresAt,
    finalizeCallbackUrl: null,
    finalizeCallbackSecret: finalizeToken,
    sidecarCredentials,
    invocation,
  };
}

export async function prepareLocalPiWorkspacePrewarm(
  input: PrepareLocalPiWorkspacePrewarmInput,
  deps: PrepareLocalPiRuntimeSessionDeps = defaultPrepareLocalPiRuntimeSessionDeps(),
): Promise<PreparedLocalPiWorkspacePrewarmSession> {
  assertUuid(input.agentId, "agentId");
  assertUuid(input.spaceId, "spaceId");
  if (input.auth.authType !== "cognito" || !input.auth.email) {
    throw new DesktopRuntimeSessionError(
      "Desktop workspace prewarm requires Cognito user authentication",
      401,
      "UNAUTHORIZED",
    );
  }

  const caller = await deps.loadCallerByEmail(input.auth.email.toLowerCase());
  if (!caller) {
    throw new DesktopRuntimeSessionError(
      "Caller is not bootstrapped",
      403,
      "CALLER_NOT_BOOTSTRAPPED",
    );
  }
  if (input.auth.tenantId && input.auth.tenantId !== caller.tenantId) {
    throw new DesktopRuntimeSessionError(
      "Caller tenant does not match token tenant",
      403,
      "TENANT_MISMATCH",
    );
  }

  const membership = await deps.loadTenantMembership({
    tenantId: caller.tenantId,
    userId: caller.id,
  });
  if (!membership || membership.status !== "active") {
    throw new DesktopRuntimeSessionError(
      "Caller is not an active tenant member",
      403,
      "TENANT_ACCESS_DENIED",
    );
  }

  const space = await deps.loadSpaceForAccess({
    tenantId: caller.tenantId,
    spaceId: input.spaceId,
  });
  if (!space || space.status !== "active") {
    throw new DesktopRuntimeSessionError(
      "Space not found",
      404,
      "SPACE_NOT_FOUND",
    );
  }
  if (space.accessMode === "private") {
    const spaceMember = await deps.loadSpaceMembership({
      tenantId: caller.tenantId,
      spaceId: space.id,
      userId: caller.id,
    });
    if (!spaceMember) {
      throw new DesktopRuntimeSessionError(
        "Caller does not have access to this Space",
        403,
        "SPACE_ACCESS_DENIED",
      );
    }
  }

  let runtimeConfig: AgentRuntimeConfig;
  try {
    runtimeConfig = await deps.resolveRuntimeConfig({
      tenantId: caller.tenantId,
      agentId: input.agentId,
      spaceId: input.spaceId,
      currentUserId: caller.id,
      currentUserEmail: caller.email,
    });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      throw new DesktopRuntimeSessionError(
        "Agent not found",
        404,
        "AGENT_NOT_FOUND",
      );
    }
    throw err;
  }

  const prewarmPurpose = input.purpose === "eval" ? "eval" : "prewarm";
  const prewarmThreadSlug = `${prewarmPurpose}-${input.spaceId}-${caller.id}`;
  const renderedWorkspace = await deps.renderWorkspace({
    tenantId: caller.tenantId,
    agentId: input.agentId,
    spaceId: input.spaceId,
    threadId: prewarmThreadSlug,
    threadSlug: prewarmThreadSlug,
    userId: caller.id,
    agentBlockedTools: runtimeConfig.blockedTools,
  });
  if (!renderedWorkspace.rendered || !renderedWorkspace.renderedPrefix) {
    if (renderedWorkspace.errorCode === "SpaceAccessDenied") {
      throw new DesktopRuntimeSessionError(
        renderedWorkspace.reason ?? "Workspace render access denied",
        403,
        "SPACE_ACCESS_DENIED",
      );
    }
    throw new DesktopRuntimeSessionError(
      renderedWorkspace.reason ?? "Workspace render unavailable",
      renderedWorkspace.statusCode ?? 503,
      renderedWorkspace.errorCode ?? "WORKSPACE_RENDER_UNAVAILABLE",
    );
  }
  if (!deps.env.workspaceBucket) {
    throw new DesktopRuntimeSessionError(
      "Workspace bucket is not configured",
      503,
      "WORKSPACE_BUCKET_UNAVAILABLE",
    );
  }

  const now = deps.now();
  const sidecarCredentials = buildDesktopSidecarCredentials({
    now,
    workspaceBucket: deps.env.workspaceBucket,
    renderedWorkspacePrefix: renderedWorkspace.renderedPrefix,
    hindsightEndpoint: deps.env.hindsightEndpoint,
  });

  return {
    expiresAt: sidecarCredentials.expiresAt,
    sidecarCredentials,
    workspace: {
      bucket: deps.env.workspaceBucket,
      renderedPrefix: renderedWorkspace.renderedPrefix,
    },
    partition: {
      tenantSlug: runtimeConfig.tenantSlug,
      agentSlug: runtimeConfig.agentSlug,
      spaceId: renderedWorkspace.activeSpace?.id ?? input.spaceId,
      userId: caller.id,
    },
  };
}
