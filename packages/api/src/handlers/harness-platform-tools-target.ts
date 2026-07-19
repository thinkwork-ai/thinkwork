/**
 * Exact-user AgentCore Gateway target for ThinkWork-owned platform tools.
 *
 * Brain is a bounded read-only query. Email is a governed side effect: the
 * target claims a deterministic per-turn idempotency key before invoking the
 * existing email policy/approval path, so a retry can never send twice.
 */

import { createHash } from "node:crypto";
import { getApiAuthSecret } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  harnessGovernedToolExecutions,
  harnessParticipantSessions,
} from "@thinkwork/database-pg/schema";
import {
  verifyProofProviderAccessToken,
  type AccessTokenClaims,
} from "@thinkwork/lambda/agentcore-proof-oauth-provider";
import {
  resolveHarnessCapabilityContext,
  type HarnessCapabilityClaims,
  type HarnessCapabilityContext,
} from "./harness-capability-mcp.js";
import { sendDirectRoutineEmail } from "./email-send.js";
import { handleQuestionIntake } from "../lib/user-questions/intake.js";
import {
  validateQuestionBatch,
  type UserQuestionInput,
} from "../lib/user-questions/question-message.js";
import { getContextEngineService } from "../lib/context-engine/service.js";
import type { ContextEngineResponse } from "../lib/context-engine/types.js";
import { toolPolicyAliases } from "../lib/builtin-tool-policy-aliases.js";
import { CAPABILITY_SLUG_PATTERN } from "../lib/capabilities/definition-schemas.js";
import { validateTemplateContextEngine } from "../lib/templates/context-engine-config.js";
import { validateTemplateSendEmail } from "../lib/templates/send-email-config.js";
import {
  listAuthorizedWorkspaceSkills,
  loadAuthorizedWorkspaceSkill,
  type AuthorizedWorkspaceSkill,
  type WorkspaceSkillAccessErrorCode,
} from "../lib/harness/workspace-tools.js";
import {
  messageAttachmentTools,
  type AuthorizedMessageAttachment,
  type MessageAttachmentAccessErrorCode,
  type ReadMessageAttachmentResult,
} from "../lib/harness/message-attachment-tools.js";
import {
  appendToolExecutionStarted,
  appendToolExecutionTerminal,
  drizzleToolExecutionLedgerStore,
  type ToolExecutionCorrelation,
  type ToolExecutionLedgerStore,
} from "../lib/harness/tool-execution-ledger.js";

const BRAIN_PATH = "/agentcore/capabilities/brain/query";
const EMAIL_PATH = "/agentcore/capabilities/email/send";
const WORKSPACE_SKILLS_LIST_PATH =
  "/agentcore/capabilities/workspace/skills/list";
const WORKSPACE_SKILLS_LOAD_PATH =
  "/agentcore/capabilities/workspace/skills/load";
const MESSAGE_ATTACHMENTS_LIST_PATH =
  "/agentcore/capabilities/message/attachments/list";
const MESSAGE_ATTACHMENTS_READ_PATH =
  "/agentcore/capabilities/message/attachments/read";
const USER_QUESTIONS_ASK_PATH = "/agentcore/capabilities/user/questions/ask";
const MAX_BODY_BYTES = 80 * 1024;
const MAX_QUERY_CHARS = 2_000;
const MAX_EMAIL_SUBJECT_CHARS = 500;
const MAX_EMAIL_BODY_CHARS = 60_000;

interface BrainBody {
  tenant_id?: unknown;
  query?: unknown;
  mode?: unknown;
  limit?: unknown;
}

interface EmailBody {
  tenant_id?: unknown;
  to?: unknown;
  subject?: unknown;
  content?: unknown;
  body?: unknown;
}

interface WorkspaceSkillBody {
  tenant_id?: unknown;
  skill?: unknown;
}

interface MessageAttachmentBody {
  tenant_id?: unknown;
  attachment_id?: unknown;
  offset?: unknown;
  max_chars?: unknown;
}

interface UserQuestionBody {
  tenant_id?: unknown;
  questions?: unknown;
  delegation_context?: unknown;
}

interface PlatformAccess {
  brain: boolean;
  email: boolean;
  questions: boolean;
}

type EmailClaim =
  | { state: "claimed" }
  | { state: "replay"; result: Record<string, unknown> }
  | { state: "in_progress" | "failed" | "ambiguous" };

interface EmailClaimInput {
  context: HarnessCapabilityContext;
  idempotencyKey: string;
  inputDigest: string;
  toolUseId: string;
}

export interface HarnessPlatformToolsDeps {
  verifyAccessToken(token: string): HarnessCapabilityClaims;
  resolveCanonicalContext(
    claims: HarnessCapabilityClaims,
  ): Promise<HarnessCapabilityContext | null>;
  resolveAccess(context: HarnessCapabilityContext): Promise<PlatformAccess>;
  queryBrain(input: {
    context: HarnessCapabilityContext;
    query: string;
    mode: "results" | "answer";
    limit: number;
  }): Promise<ContextEngineResponse>;
  sendEmail(input: {
    context: HarnessCapabilityContext;
    to: string[];
    subject: string;
    body: string;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>>;
  listWorkspaceSkills(context: HarnessCapabilityContext): Promise<{
    manifestFingerprint: string;
    skills: AuthorizedWorkspaceSkill[];
  }>;
  loadWorkspaceSkill(
    context: HarnessCapabilityContext,
    slug: string,
  ): Promise<
    AuthorizedWorkspaceSkill & {
      content: string;
      contentSha256: string;
      sizeBytes: number;
      manifestFingerprint: string;
    }
  >;
  listMessageAttachments(context: HarnessCapabilityContext): Promise<{
    attachmentSetFingerprint: string;
    attachments: AuthorizedMessageAttachment[];
  }>;
  readMessageAttachment(
    context: HarnessCapabilityContext,
    attachmentId: string,
    offset: number,
    maxChars: number,
  ): Promise<ReadMessageAttachmentResult>;
  askUserQuestion(input: {
    context: HarnessCapabilityContext;
    questions: UserQuestionInput[];
    delegationContext?: Record<string, unknown> | null;
  }): Promise<{
    status: "posted" | "already_pending";
    questionId?: string;
    messageId?: string;
  }>;
  claimEmail(input: EmailClaimInput): Promise<EmailClaim>;
  finishEmail(input: {
    context: HarnessCapabilityContext;
    idempotencyKey: string;
    state: "completed" | "failed" | "ambiguous";
    result?: Record<string, unknown>;
    failureReason?: string;
  }): Promise<void>;
  ledgerStore: ToolExecutionLedgerStore;
  policyRevision: string;
  now(): number;
}

export function createHarnessPlatformToolsHandler(
  deps: HarnessPlatformToolsDeps,
) {
  return async function harnessPlatformTools(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const path = event.rawPath || event.requestContext.http.path;
    if (
      event.requestContext.http.method !== "POST" ||
      ![
        BRAIN_PATH,
        EMAIL_PATH,
        WORKSPACE_SKILLS_LIST_PATH,
        WORKSPACE_SKILLS_LOAD_PATH,
        MESSAGE_ATTACHMENTS_LIST_PATH,
        MESSAGE_ATTACHMENTS_READ_PATH,
        USER_QUESTIONS_ASK_PATH,
      ].includes(path)
    ) {
      return response(404, { error: "not_found" });
    }
    if (hasIdentityOverride(event.headers)) {
      return response(400, { error: "identity_override_rejected" });
    }
    const authorization =
      event.headers.authorization ?? event.headers.Authorization ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return response(401, { error: "exact_user_token_required" });
    }

    let claims: HarnessCapabilityClaims;
    try {
      claims = deps.verifyAccessToken(authorization.slice(7));
    } catch {
      return response(401, { error: "exact_user_token_invalid" });
    }
    if (!hasCompleteTurnTuple(claims)) {
      return response(401, { error: "turn_bound_token_required" });
    }

    const rawBody = decodeBody(event);
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return response(413, { error: "request_too_large" });
    }
    let body:
      | BrainBody
      | EmailBody
      | WorkspaceSkillBody
      | MessageAttachmentBody
      | UserQuestionBody;
    try {
      body = JSON.parse(rawBody || "{}") as
        | BrainBody
        | EmailBody
        | WorkspaceSkillBody
        | MessageAttachmentBody
        | UserQuestionBody;
    } catch {
      console.warn("[harness-platform-tools] Invalid Gateway body encoding", {
        path,
        contentType: event.headers["content-type"] ?? null,
        bodyLength: rawBody.length,
        firstCodePoint: rawBody.codePointAt(0) ?? null,
        lastCodePoint: rawBody.codePointAt(rawBody.length - 1) ?? null,
        containsEquals: rawBody.includes("="),
        isBase64Encoded: event.isBase64Encoded === true,
      });
      return response(400, { error: "invalid_json" });
    }
    if (body.tenant_id !== claims.tenant_id) {
      return response(403, { error: "tenant_context_mismatch" });
    }

    const parsed =
      path === BRAIN_PATH
        ? parseBrainBody(body as BrainBody)
        : path === EMAIL_PATH
          ? parseEmailBody(body as EmailBody)
          : path === WORKSPACE_SKILLS_LOAD_PATH
            ? parseWorkspaceSkillBody(body as WorkspaceSkillBody)
            : path === MESSAGE_ATTACHMENTS_READ_PATH
              ? parseMessageAttachmentBody(body as MessageAttachmentBody)
              : path === USER_QUESTIONS_ASK_PATH
                ? parseUserQuestionBody(body as UserQuestionBody)
                : ({ ok: true, value: {} } as ParseResult<
                    Record<string, never>
                  >);
    if (!parsed.ok) return response(400, { error: parsed.error });

    const context = await deps.resolveCanonicalContext(claims);
    if (!context) {
      return response(403, { error: "canonical_turn_not_authorized" });
    }
    const isBrain = path === BRAIN_PATH;
    const isEmail = path === EMAIL_PATH;
    const isQuestion = path === USER_QUESTIONS_ASK_PATH;
    if (isBrain || isEmail || isQuestion) {
      const access = await deps.resolveAccess(context);
      if (
        (isBrain && !access.brain) ||
        (isEmail && !access.email) ||
        (isQuestion && !access.questions)
      ) {
        return response(403, {
          error: isBrain
            ? "brain_not_authorized"
            : isEmail
              ? "send_email_not_authorized"
              : "ask_user_question_not_authorized",
        });
      }
    }

    if (isBrain) {
      return runBrain(deps, context, event, parsed.value as ParsedBrain);
    }
    if (isEmail) {
      return runEmail(deps, context, event, parsed.value as ParsedEmail);
    }
    if (isQuestion) {
      return runUserQuestion(
        deps,
        context,
        event,
        parsed.value as ParsedUserQuestion,
      );
    }
    if (path === WORKSPACE_SKILLS_LIST_PATH) {
      return runWorkspaceSkillList(deps, context, event);
    }
    if (path === WORKSPACE_SKILLS_LOAD_PATH) {
      return runWorkspaceSkillLoad(
        deps,
        context,
        event,
        parsed.value as ParsedWorkspaceSkill,
      );
    }
    if (path === MESSAGE_ATTACHMENTS_LIST_PATH) {
      return runMessageAttachmentList(deps, context, event);
    }
    return runMessageAttachmentRead(
      deps,
      context,
      event,
      parsed.value as ParsedMessageAttachment,
    );
  };
}

async function runUserQuestion(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedUserQuestion,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "ask_user_question",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: null,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: { questionCount: input.questions.length },
    inputAllowPaths: ["questionCount"],
  });
  try {
    const result = await deps.askUserQuestion({
      context,
      questions: input.questions,
      delegationContext: input.delegationContext,
    });
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: {
        status: result.status,
        ...(result.questionId ? { questionId: result.questionId } : {}),
        ...(result.messageId ? { messageId: result.messageId } : {}),
      },
      outputAllowPaths: ["status", "questionId", "messageId"],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, {
      ...result,
      endTurn: true,
      instruction:
        "The question is persisted. End this turn now; the user's answer arrives in a later turn.",
    });
  } catch (error) {
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "failed",
      output: {},
      outputAllowPaths: [],
      error: { code: "ask_user_question_failed" },
      errorAllowPaths: ["code"],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    console.error("[harness-platform-tools] User question intake failed", {
      tenantId: context.tenantId,
      turnId: context.turnId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return response(502, { error: "ask_user_question_failed" });
  }
}

async function runBrain(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedBrain,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "brain.query",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: `tenant:${context.tenantId}:brain`,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: {
      queryLength: input.query.length,
      mode: input.mode,
      limit: input.limit,
    },
    inputAllowPaths: ["queryLength", "mode", "limit"],
  });
  try {
    const result = sanitizeBrainResult(
      await deps.queryBrain({ context, ...input }),
    );
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: {
        hitCount: result.hits.length,
        providerCount: result.providers.length,
        answered: Boolean(result.answer),
      },
      outputAllowPaths: ["hitCount", "providerCount", "answered"],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, result);
  } catch (error) {
    await recordUncertain(deps, correlation, startedAt, "brain_query_failed");
    console.error("[harness-platform-tools] Brain query failed", {
      tenantId: context.tenantId,
      turnId: context.turnId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return response(502, { error: "brain_query_failed" });
  }
}

async function runWorkspaceSkillList(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "workspace.skills.list",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: null,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: {},
    inputAllowPaths: [],
  });
  try {
    const result = await deps.listWorkspaceSkills(context);
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: { skillCount: result.skills.length },
      outputAllowPaths: ["skillCount"],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, result);
  } catch (error) {
    return finishWorkspaceSkillError(
      deps,
      correlation,
      startedAt,
      error,
      "workspace_skill_source_unavailable",
    );
  }
}

async function runWorkspaceSkillLoad(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedWorkspaceSkill,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "workspace.skills.load",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: null,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: { slug: input.skill },
    inputAllowPaths: ["slug"],
  });
  try {
    const result = await deps.loadWorkspaceSkill(context, input.skill);
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: {
        slug: result.slug,
        scope: result.scope,
        sizeBytes: result.sizeBytes,
        contentSha256: result.contentSha256,
        manifestFingerprint: result.manifestFingerprint,
      },
      outputAllowPaths: [
        "slug",
        "scope",
        "sizeBytes",
        "contentSha256",
        "manifestFingerprint",
      ],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, result);
  } catch (error) {
    return finishWorkspaceSkillError(
      deps,
      correlation,
      startedAt,
      error,
      "workspace_skill_source_unavailable",
    );
  }
}

async function finishWorkspaceSkillError(
  deps: HarnessPlatformToolsDeps,
  correlation: ToolExecutionCorrelation,
  startedAt: number,
  error: unknown,
  fallbackCode: WorkspaceSkillAccessErrorCode,
): Promise<APIGatewayProxyStructuredResultV2> {
  const code = workspaceSkillErrorCode(error) ?? fallbackCode;
  await appendToolExecutionTerminal(deps.ledgerStore, {
    ...correlation,
    status: "failed",
    output: {},
    outputAllowPaths: [],
    error: { code },
    errorAllowPaths: ["code"],
    durationMs: Math.max(0, deps.now() - startedAt),
  });
  if (!workspaceSkillErrorCode(error)) {
    console.error("[harness-platform-tools] Workspace skill access failed", {
      tenantId: correlation.tenantId,
      turnId: correlation.turnId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
  return response(workspaceSkillErrorStatus(code), { error: code });
}

async function runMessageAttachmentList(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "message.attachments.list",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: null,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: {},
    inputAllowPaths: [],
  });
  try {
    const result = await deps.listMessageAttachments(context);
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: {
        attachmentCount: result.attachments.length,
        attachmentSetFingerprint: result.attachmentSetFingerprint,
      },
      outputAllowPaths: ["attachmentCount", "attachmentSetFingerprint"],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, result);
  } catch (error) {
    return finishMessageAttachmentError(
      deps,
      correlation,
      startedAt,
      error,
      "message_attachment_source_unavailable",
    );
  }
}

async function runMessageAttachmentRead(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedMessageAttachment,
): Promise<APIGatewayProxyStructuredResultV2> {
  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "message.attachments.read",
    policyRevision: deps.policyRevision,
    idempotencyKey: event.requestContext.requestId,
    credentialOwnerAlias: null,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: {
      attachmentId: input.attachmentId,
      offset: input.offset,
      maxChars: input.maxChars,
    },
    inputAllowPaths: ["attachmentId", "offset", "maxChars"],
  });
  try {
    const result = await deps.readMessageAttachment(
      context,
      input.attachmentId,
      input.offset,
      input.maxChars,
    );
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: "completed",
      output: {
        attachmentId: result.attachmentId,
        kind: result.kind,
        contentSha256: result.contentSha256,
        offset: result.offset,
        nextOffset: result.nextOffset,
        totalChars: result.totalChars,
        truncated: result.truncated,
      },
      outputAllowPaths: [
        "attachmentId",
        "kind",
        "contentSha256",
        "offset",
        "nextOffset",
        "totalChars",
        "truncated",
      ],
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(200, result);
  } catch (error) {
    return finishMessageAttachmentError(
      deps,
      correlation,
      startedAt,
      error,
      "message_attachment_source_unavailable",
    );
  }
}

async function finishMessageAttachmentError(
  deps: HarnessPlatformToolsDeps,
  correlation: ToolExecutionCorrelation,
  startedAt: number,
  error: unknown,
  fallbackCode: MessageAttachmentAccessErrorCode,
): Promise<APIGatewayProxyStructuredResultV2> {
  const code = messageAttachmentErrorCode(error) ?? fallbackCode;
  await appendToolExecutionTerminal(deps.ledgerStore, {
    ...correlation,
    status: "failed",
    output: {},
    outputAllowPaths: [],
    error: { code },
    errorAllowPaths: ["code"],
    durationMs: Math.max(0, deps.now() - startedAt),
  });
  return response(messageAttachmentErrorStatus(code), { error: code });
}

function messageAttachmentErrorCode(
  error: unknown,
): MessageAttachmentAccessErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code === "invalid_message_attachment" ||
    code === "message_attachment_not_authorized" ||
    code === "message_attachment_source_unavailable" ||
    code === "message_attachment_too_large" ||
    code === "message_attachment_unreadable"
    ? code
    : null;
}

function messageAttachmentErrorStatus(code: MessageAttachmentAccessErrorCode) {
  if (code === "invalid_message_attachment") return 400;
  if (code === "message_attachment_not_authorized") return 403;
  if (code === "message_attachment_too_large") return 413;
  if (code === "message_attachment_unreadable") return 422;
  return 503;
}

function workspaceSkillErrorCode(
  error: unknown,
): WorkspaceSkillAccessErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code === "invalid_workspace_skill" ||
    code === "workspace_skill_not_authorized" ||
    code === "workspace_skill_source_unavailable" ||
    code === "workspace_skill_too_large" ||
    code === "workspace_skill_content_blocked"
    ? code
    : null;
}

function workspaceSkillErrorStatus(code: WorkspaceSkillAccessErrorCode) {
  if (code === "invalid_workspace_skill") return 400;
  if (code === "workspace_skill_not_authorized") return 403;
  if (code === "workspace_skill_too_large") return 413;
  if (code === "workspace_skill_content_blocked") return 422;
  return 503;
}

async function runEmail(
  deps: HarnessPlatformToolsDeps,
  context: HarnessCapabilityContext,
  event: APIGatewayProxyEventV2,
  input: ParsedEmail,
): Promise<APIGatewayProxyStructuredResultV2> {
  const inputDigest = digestEmailInput(input);
  const idempotencyKey = `email:${context.turnId}:${inputDigest}`;
  const claim = await deps.claimEmail({
    context,
    idempotencyKey,
    inputDigest,
    toolUseId: event.requestContext.requestId,
  });
  if (claim.state === "replay") {
    return response(200, { ...claim.result, replayed: true });
  }
  if (claim.state !== "claimed") {
    return response(409, { error: `send_email_${claim.state}` });
  }

  const startedAt = deps.now();
  const correlation = correlationFor({
    context,
    event,
    operation: "email.send",
    policyRevision: deps.policyRevision,
    idempotencyKey,
    credentialOwnerAlias: `tenant:${context.tenantId}:email`,
  });
  await appendToolExecutionStarted(deps.ledgerStore, {
    ...correlation,
    input: {
      recipientCount: input.to.length,
      subjectLength: input.subject.length,
      bodyLength: input.body.length,
    },
    inputAllowPaths: ["recipientCount", "subjectLength", "bodyLength"],
  });

  try {
    const result = await deps.sendEmail({
      context,
      ...input,
      idempotencyKey,
    });
    const sanitized = sanitizeEmailResult(result);
    const failed =
      sanitized.status === "blocked" || sanitized.status === "failed";
    await deps.finishEmail({
      context,
      idempotencyKey,
      state: failed ? "failed" : "completed",
      result: sanitized,
      ...(failed
        ? { failureReason: String(sanitized.reasonCode ?? "blocked") }
        : {}),
    });
    await appendToolExecutionTerminal(deps.ledgerStore, {
      ...correlation,
      status: failed ? "failed" : "completed",
      output: {
        status: sanitized.status,
        approvalRequested: sanitized.status === "pending_review",
        ...(sanitized.inboxItemId
          ? { inboxItemId: sanitized.inboxItemId }
          : {}),
        ...(sanitized.approvalUrl
          ? { approvalUrl: sanitized.approvalUrl }
          : {}),
      },
      outputAllowPaths: [
        "status",
        "approvalRequested",
        "inboxItemId",
        "approvalUrl",
      ],
      ...(failed
        ? {
            error: { code: String(sanitized.reasonCode ?? "blocked") },
            errorAllowPaths: ["code"],
          }
        : {}),
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    return response(
      failed ? 503 : sanitized.status === "pending_review" ? 202 : 200,
      sanitized,
    );
  } catch (error) {
    await deps
      .finishEmail({
        context,
        idempotencyKey,
        state: "ambiguous",
        failureReason: "provider_result_ambiguous",
      })
      .catch(() => undefined);
    await recordUncertain(deps, correlation, startedAt, "send_email_ambiguous");
    console.error("[harness-platform-tools] Email send became ambiguous", {
      tenantId: context.tenantId,
      turnId: context.turnId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return response(502, { error: "send_email_ambiguous" });
  }
}

function correlationFor(input: {
  context: HarnessCapabilityContext;
  event: APIGatewayProxyEventV2;
  operation: string;
  policyRevision: string;
  idempotencyKey: string;
  credentialOwnerAlias: string | null;
}): ToolExecutionCorrelation {
  return {
    tenantId: input.context.tenantId,
    threadId: input.context.threadId,
    turnId: input.context.turnId,
    principalType: "user",
    principalId: input.context.userId,
    toolUseId: input.event.requestContext.requestId,
    operation: input.operation,
    policyRevision: input.policyRevision,
    idempotencyKey: input.idempotencyKey,
    credentialOwnerAlias: input.credentialOwnerAlias,
  };
}

async function recordUncertain(
  deps: HarnessPlatformToolsDeps,
  correlation: ToolExecutionCorrelation,
  startedAt: number,
  code: string,
) {
  await appendToolExecutionTerminal(deps.ledgerStore, {
    ...correlation,
    status: "uncertain",
    output: {},
    outputAllowPaths: [],
    error: { code },
    errorAllowPaths: ["code"],
    durationMs: Math.max(0, deps.now() - startedAt),
  }).catch(() => undefined);
}

async function resolvePlatformAccess(
  context: HarnessCapabilityContext,
): Promise<PlatformAccess> {
  const [agent] = await getDb()
    .select({
      contextEngine: agents.context_engine,
      sendEmail: agents.send_email,
      blockedTools: agents.blocked_tools,
    })
    .from(agents)
    .where(
      and(
        eq(agents.id, context.agentId),
        eq(agents.tenant_id, context.tenantId),
      ),
    )
    .limit(1);
  if (!agent) return { brain: false, email: false, questions: false };
  const blocked = new Set(
    Array.isArray(agent.blockedTools)
      ? agent.blockedTools.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  const isBlocked = (tool: string) =>
    toolPolicyAliases(tool).some((alias) => blocked.has(alias));
  const brain = validateTemplateContextEngine(agent.contextEngine);
  const email = validateTemplateSendEmail(agent.sendEmail);
  return {
    brain:
      brain.ok && brain.value?.enabled === true && !isBlocked("context_engine"),
    email:
      email.ok && email.value?.enabled === true && !isBlocked("send_email"),
    questions: !isBlocked("ask_user_question"),
  };
}

async function queryBrain(input: {
  context: HarnessCapabilityContext;
  query: string;
  mode: "results" | "answer";
  limit: number;
}): Promise<ContextEngineResponse> {
  return getContextEngineService().query({
    query: input.query,
    mode: input.mode,
    scope: "auto",
    depth: "quick",
    limit: input.limit,
    providers: { families: ["brain"] },
    caller: {
      tenantId: input.context.tenantId,
      userId: input.context.userId,
      agentId: input.context.agentId,
      threadId: input.context.threadId,
      spaceId: input.context.spaceId,
    },
  });
}

async function sendEmail(input: {
  context: HarnessCapabilityContext;
  to: string[];
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const result = await sendDirectRoutineEmail({
    tenantId: input.context.tenantId,
    agentId: input.context.agentId,
    requestingUserId: input.context.userId,
    spaceId: input.context.spaceId ?? undefined,
    threadId: input.context.threadId,
    to: input.to,
    subject: input.subject,
    body: input.body,
    bodyFormat: "markdown",
    source: "agentcore-harness",
    idempotencyKey: input.idempotencyKey,
  });
  if ("statusCode" in result) {
    const parsed = JSON.parse(result.body ?? "{}") as Record<string, unknown>;
    const statusCode =
      typeof result.statusCode === "number" ? result.statusCode : 500;
    // A provider-side 5xx has unknown delivery semantics. Keep the execution
    // ambiguous so an AgentCore retry cannot turn a timeout into a duplicate
    // send. Policy denials are explicit, deterministic `blocked` outcomes.
    if (statusCode >= 500 && parsed.status !== "blocked") {
      throw new Error("email_provider_result_ambiguous");
    }
    return { ...parsed, httpStatus: statusCode };
  }
  return result;
}

async function askUserQuestion(input: {
  context: HarnessCapabilityContext;
  questions: UserQuestionInput[];
  delegationContext?: Record<string, unknown> | null;
}): Promise<{
  status: "posted" | "already_pending";
  questionId?: string;
  messageId?: string;
}> {
  const path = `/api/threads/${input.context.threadId}/questions`;
  const result = await handleQuestionIntake({
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: `Bearer ${getApiAuthSecret()}` },
    requestContext: {
      accountId: "internal",
      apiId: "internal",
      domainName: "internal",
      domainPrefix: "internal",
      http: {
        method: "POST",
        path,
        protocol: "internal",
        sourceIp: "127.0.0.1",
        userAgent: "ThinkWork-AgentCore-Harness/1.0",
      },
      requestId: input.context.turnId,
      routeKey: `POST ${path}`,
      stage: "$default",
      time: "",
      timeEpoch: Date.now(),
    },
    pathParameters: { threadId: input.context.threadId },
    body: JSON.stringify({
      thread_turn_id: input.context.turnId,
      questions: input.questions,
      delegation_context: input.delegationContext ?? null,
    }),
    isBase64Encoded: false,
  });
  const body = JSON.parse(result.body ?? "{}") as Record<string, unknown>;
  if (result.statusCode === 409 && body.code === "QUESTION_ALREADY_PENDING") {
    return { status: "already_pending" };
  }
  if (result.statusCode !== 200 || body.ok !== true) {
    throw new Error(`question_intake_${result.statusCode}`);
  }
  return {
    status: "posted",
    ...(typeof body.questionId === "string"
      ? { questionId: body.questionId }
      : {}),
    ...(typeof body.messageId === "string"
      ? { messageId: body.messageId }
      : {}),
  };
}

async function claimEmail(input: EmailClaimInput): Promise<EmailClaim> {
  const database = getDb();
  const [session] = await database
    .select({ id: harnessParticipantSessions.id })
    .from(harnessParticipantSessions)
    .where(
      and(
        eq(harnessParticipantSessions.tenant_id, input.context.tenantId),
        eq(harnessParticipantSessions.turn_id, input.context.turnId),
        eq(
          harnessParticipantSessions.participant_user_id,
          input.context.userId,
        ),
      ),
    )
    .limit(1);
  if (!session) return { state: "failed" };
  const [inserted] = await database
    .insert(harnessGovernedToolExecutions)
    .values({
      tenant_id: input.context.tenantId,
      turn_id: input.context.turnId,
      participant_user_id: input.context.userId,
      session_id: session.id,
      idempotency_key: input.idempotencyKey,
      audience: "agentcore-gateway",
      operation: "email.send",
      tool_use_id: input.toolUseId,
      input_digest: input.inputDigest,
      state: "claimed",
      credential_owner_alias: `tenant:${input.context.tenantId}:email`,
    })
    .onConflictDoNothing()
    .returning({ id: harnessGovernedToolExecutions.id });
  if (inserted) return { state: "claimed" };
  const [existing] = await database
    .select({
      state: harnessGovernedToolExecutions.state,
      result: harnessGovernedToolExecutions.sanitized_result,
    })
    .from(harnessGovernedToolExecutions)
    .where(
      and(
        eq(harnessGovernedToolExecutions.tenant_id, input.context.tenantId),
        eq(harnessGovernedToolExecutions.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing?.state === "completed" && isRecord(existing.result)) {
    return { state: "replay", result: existing.result };
  }
  if (existing?.state === "failed") return { state: "failed" };
  if (existing?.state === "ambiguous") return { state: "ambiguous" };
  return { state: "in_progress" };
}

async function finishEmail(input: {
  context: HarnessCapabilityContext;
  idempotencyKey: string;
  state: "completed" | "failed" | "ambiguous";
  result?: Record<string, unknown>;
  failureReason?: string;
}) {
  await getDb()
    .update(harnessGovernedToolExecutions)
    .set({
      state: input.state,
      sanitized_result: input.result ?? null,
      failure_reason: input.failureReason ?? null,
      completed_at: new Date(),
    })
    .where(
      and(
        eq(harnessGovernedToolExecutions.tenant_id, input.context.tenantId),
        eq(harnessGovernedToolExecutions.idempotency_key, input.idempotencyKey),
      ),
    );
}

interface ParsedBrain {
  query: string;
  mode: "results" | "answer";
  limit: number;
}

interface ParsedEmail {
  to: string[];
  subject: string;
  body: string;
}

interface ParsedWorkspaceSkill {
  skill: string;
}

interface ParsedMessageAttachment {
  attachmentId: string;
  offset: number;
  maxChars: number;
}

interface ParsedUserQuestion {
  questions: UserQuestionInput[];
  delegationContext: Record<string, unknown> | null;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseBrainBody(body: BrainBody): ParseResult<ParsedBrain> {
  if (
    typeof body.query !== "string" ||
    body.query.trim().length === 0 ||
    body.query.length > MAX_QUERY_CHARS
  ) {
    return { ok: false, error: "invalid_query" };
  }
  const mode = body.mode === undefined ? "results" : body.mode;
  if (mode !== "results" && mode !== "answer") {
    return { ok: false, error: "invalid_mode" };
  }
  const limit = body.limit === undefined ? 8 : body.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) {
    return { ok: false, error: "invalid_limit" };
  }
  return {
    ok: true,
    value: { query: body.query.trim(), mode, limit: Number(limit) },
  };
}

function parseEmailBody(body: EmailBody): ParseResult<ParsedEmail> {
  // `body` is a reserved AgentCore OpenAPI transport name: when it appears in
  // the published tool schema, Gateway sends that field alone as the raw HTTP
  // body. Publish `content` instead and retain `body` only for direct callers.
  const content = body.content ?? body.body;
  if (
    !Array.isArray(body.to) ||
    body.to.length < 1 ||
    body.to.length > 5 ||
    body.to.some((value) => typeof value !== "string" || value.length > 320)
  ) {
    return { ok: false, error: "invalid_recipients" };
  }
  if (
    typeof body.subject !== "string" ||
    body.subject.trim().length === 0 ||
    body.subject.length > MAX_EMAIL_SUBJECT_CHARS
  ) {
    return { ok: false, error: "invalid_subject" };
  }
  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.length > MAX_EMAIL_BODY_CHARS
  ) {
    return { ok: false, error: "invalid_email_body" };
  }
  return {
    ok: true,
    value: {
      to: body.to.map((value) => (value as string).trim().toLowerCase()).sort(),
      subject: body.subject.trim(),
      body: content.trim(),
    },
  };
}

function parseWorkspaceSkillBody(
  body: WorkspaceSkillBody,
): ParseResult<ParsedWorkspaceSkill> {
  if (
    typeof body.skill !== "string" ||
    !CAPABILITY_SLUG_PATTERN.test(body.skill)
  ) {
    return { ok: false, error: "invalid_workspace_skill" };
  }
  return { ok: true, value: { skill: body.skill } };
}

function parseMessageAttachmentBody(
  body: MessageAttachmentBody,
): ParseResult<ParsedMessageAttachment> {
  const attachmentId = body.attachment_id;
  const offset = body.offset === undefined ? 0 : body.offset;
  const maxChars = body.max_chars === undefined ? 32 * 1024 : body.max_chars;
  if (
    typeof attachmentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      attachmentId,
    ) ||
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isSafeInteger(maxChars) ||
    Number(maxChars) < 1 ||
    Number(maxChars) > 64 * 1024
  ) {
    return { ok: false, error: "invalid_message_attachment" };
  }
  return {
    ok: true,
    value: {
      attachmentId: attachmentId.toLowerCase(),
      offset: Number(offset),
      maxChars: Number(maxChars),
    },
  };
}

function parseUserQuestionBody(
  body: UserQuestionBody,
): ParseResult<ParsedUserQuestion> {
  const error = validateQuestionBatch(body.questions, body.delegation_context);
  if (error) return { ok: false, error: "invalid_user_questions" };
  return {
    ok: true,
    value: {
      questions: body.questions as UserQuestionInput[],
      delegationContext: isRecord(body.delegation_context)
        ? body.delegation_context
        : null,
    },
  };
}

function digestEmailInput(input: ParsedEmail): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        to: input.to,
        subject: input.subject,
        body: input.body,
      }),
    )
    .digest("hex");
}

function sanitizeBrainResult(result: ContextEngineResponse) {
  return {
    ...(result.answer?.text
      ? { answer: result.answer.text.slice(0, 12_000) }
      : {}),
    hits: result.hits.slice(0, 10).map((hit) => ({
      id: hit.id,
      title: hit.title.slice(0, 500),
      snippet: hit.snippet.slice(0, 4_000),
      family: hit.family,
      ...(hit.sourceFamily ? { sourceFamily: hit.sourceFamily } : {}),
      ...(typeof hit.score === "number" ? { score: hit.score } : {}),
      provenance: {
        ...(hit.provenance.label ? { label: hit.provenance.label } : {}),
        ...(hit.provenance.uri ? { uri: hit.provenance.uri } : {}),
        ...(hit.provenance.sourceId
          ? { sourceId: hit.provenance.sourceId }
          : {}),
      },
    })),
    providers: result.providers.map((provider) => ({
      displayName: provider.displayName,
      state: provider.state,
      ...(typeof provider.hitCount === "number"
        ? { hitCount: provider.hitCount }
        : {}),
    })),
  };
}

function sanitizeEmailResult(result: Record<string, unknown>) {
  const status =
    result.status === "sent" ||
    result.status === "pending_review" ||
    result.status === "blocked"
      ? result.status
      : result.httpStatus === 200
        ? "sent"
        : "failed";
  return {
    status,
    ...(typeof result.messageId === "string"
      ? { messageId: result.messageId }
      : {}),
    ...(typeof result.conversationId === "string"
      ? { conversationId: result.conversationId }
      : {}),
    ...(typeof result.inboxItemId === "string"
      ? { inboxItemId: result.inboxItemId }
      : {}),
    ...(typeof result.approvalUrl === "string"
      ? { approvalUrl: result.approvalUrl }
      : typeof result.inboxItemId === "string"
        ? { approvalUrl: `/approvals/${result.inboxItemId}` }
        : {}),
    ...(typeof result.reasonCode === "string"
      ? { reasonCode: result.reasonCode }
      : {}),
  };
}

function hasIdentityOverride(headers: Record<string, string | undefined>) {
  return Boolean(
    headers["x-thinkwork-user-id"] ||
    headers["x-thinkwork-tenant-id"] ||
    headers["x-thinkwork-agent-id"] ||
    headers["x-thinkwork-turn-id"],
  );
}

function hasCompleteTurnTuple(claims: HarnessCapabilityClaims) {
  return Boolean(
    claims.sub &&
    claims.participant_id &&
    claims.sub === claims.participant_id &&
    claims.tenant_id &&
    claims.agent_id &&
    claims.thread_id &&
    claims.turn_id &&
    Number.isInteger(claims.session_generation) &&
    claims.session_generation > 0,
  );
}

function decodeBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? "";
  return event.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

function response(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      pragma: "no-cache",
    },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const deployedHandler = createHarnessPlatformToolsHandler({
  verifyAccessToken(token) {
    return verifyProofProviderAccessToken(token, {
      issuer: requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER"),
      audience: `${requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER").replace(/\/+$/, "")}/target`,
      secret: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET"),
      nowSeconds: Math.floor(Date.now() / 1000),
    }) as AccessTokenClaims & HarnessCapabilityClaims;
  },
  resolveCanonicalContext: resolveHarnessCapabilityContext,
  resolveAccess: resolvePlatformAccess,
  queryBrain,
  sendEmail,
  listWorkspaceSkills: listAuthorizedWorkspaceSkills,
  loadWorkspaceSkill: loadAuthorizedWorkspaceSkill,
  listMessageAttachments: messageAttachmentTools.list,
  readMessageAttachment: messageAttachmentTools.read,
  askUserQuestion,
  claimEmail,
  finishEmail,
  ledgerStore: drizzleToolExecutionLedgerStore(),
  policyRevision:
    process.env.AGENTCORE_GATEWAY_POLICY_REVISION?.trim() ||
    "platform-tools-v1",
  now: Date.now,
});

export const handler = deployedHandler;
