import { and, eq } from "drizzle-orm";
import { messages } from "@thinkwork/database-pg/schema";
import { spaces } from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import { ensureThreadForWork } from "../thread-helpers.js";
import {
  CUSTOMER_ONBOARDING_TEMPLATE_KEY,
  startCustomerOnboardingWorkflow,
  type CustomerOnboardingWorkflowResult,
} from "./customer-onboarding-workflow.js";

const SUMMARY_MAX_LENGTH = 1200;
const FIELD_MAX_LENGTH = 180;
const GENERAL_WORKFLOW_KEYS = new Set(["default", "general", "custom"]);

export interface StartSpaceWebhookThreadInput {
  tenantId: string;
  agentId: string;
  spaceId?: string | null;
  webhookId: string;
  webhookName: string;
  payload: Record<string, unknown>;
}

export interface WebhookOpeningSummaryInput {
  webhookName: string;
  payload: Record<string, unknown>;
}

export interface WebhookOpeningMessageInput {
  tenantId: string;
  threadId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface WebhookWorkflowWarningMessageInput {
  tenantId: string;
  threadId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface SpaceWebhookThreadStartSpace {
  id: string;
  tenantId: string;
  kind: string;
  templateKey: string | null;
  config: Record<string, unknown> | null;
}

export interface SpaceWebhookThreadStartWarning {
  code: string;
  message: string;
  workflowKey?: string | null;
}

export interface StartSpaceWebhookThreadResult {
  threadId: string;
  identifier: string;
  number: number;
  openingMessageId: string;
  openingMessageContent: string;
  openingMessageAlreadyPersisted: true;
  warnings: SpaceWebhookThreadStartWarning[];
  workflow: {
    key: "customer_onboarding";
    threadId: string;
    idempotent: boolean;
    missingFields: string[];
    linkedTaskCount: number;
  } | null;
  agentContext: {
    webhookPayload: Record<string, unknown>;
    webhookId: string;
    webhookName: string;
    spaceId: string | null;
    openingMessageId: string;
    openingMessageAlreadyPersisted: true;
    workflowWarnings: SpaceWebhookThreadStartWarning[];
  };
}

export interface StartSpaceWebhookThreadDeps {
  ensureThreadForWork?: typeof ensureThreadForWork;
  findSpace?: (input: {
    tenantId: string;
    spaceId: string;
  }) => Promise<SpaceWebhookThreadStartSpace | null>;
  startCustomerOnboardingWorkflow?: typeof startCustomerOnboardingWorkflow;
  insertOpeningMessage?: (
    input: WebhookOpeningMessageInput,
  ) => Promise<{ id: string } | null | undefined>;
  insertWorkflowWarningMessage?: (
    input: WebhookWorkflowWarningMessageInput,
  ) => Promise<{ id: string } | null | undefined>;
  now?: () => Date;
}

export async function startSpaceWebhookThread(
  input: StartSpaceWebhookThreadInput,
  deps: StartSpaceWebhookThreadDeps = {},
): Promise<StartSpaceWebhookThreadResult> {
  const ensureThread = deps.ensureThreadForWork ?? ensureThreadForWork;
  const findSpace = deps.findSpace ?? findActiveSpace;
  const startCustomerOnboarding =
    deps.startCustomerOnboardingWorkflow ?? startCustomerOnboardingWorkflow;
  const insertOpeningMessage =
    deps.insertOpeningMessage ?? insertWebhookOpeningMessage;
  const insertWarningMessage =
    deps.insertWorkflowWarningMessage ?? insertWebhookWorkflowWarningMessage;
  const createdAt = deps.now?.() ?? new Date();
  const openingMessageContent = buildWebhookOpeningSummary({
    webhookName: input.webhookName,
    payload: input.payload,
  });

  const thread = await ensureThread({
    tenantId: input.tenantId,
    agentId: input.agentId,
    spaceId: input.spaceId ?? undefined,
    title: input.webhookName,
    channel: "webhook",
  });

  const openingMessage = await insertOpeningMessage({
    tenantId: input.tenantId,
    threadId: thread.threadId,
    content: openingMessageContent,
    createdAt,
    metadata: {
      source: "webhook",
      webhookId: input.webhookId,
      webhookName: input.webhookName,
      summaryFields: extractSummaryFields(input.payload),
    },
  });

  if (!openingMessage?.id) {
    throw new Error("Webhook opening message could not be created");
  }

  const warnings: SpaceWebhookThreadStartWarning[] = [];
  let workflow: StartSpaceWebhookThreadResult["workflow"] = null;
  const space = input.spaceId
    ? await findSpace({ tenantId: input.tenantId, spaceId: input.spaceId })
    : null;
  const workflowKey = space ? detectSpaceWorkflowKey(space) : null;
  if (workflowKey === CUSTOMER_ONBOARDING_TEMPLATE_KEY && space) {
    try {
      const workflowResult = await startCustomerOnboarding({
        tenantId: input.tenantId,
        spaceId: space.id,
        source: "webhook",
        opportunity: input.payload,
        preparedThread: {
          id: thread.threadId,
          tenantId: input.tenantId,
          spaceId: space.id,
          title: input.webhookName,
          identifier: thread.identifier,
          metadata: null,
        },
        startedBy: { type: "system" },
      });
      workflow = customerOnboardingWorkflowSummary(workflowResult);
    } catch (error) {
      const warning = workflowWarningFromError({
        code: "CUSTOMER_ONBOARDING_WORKFLOW_FAILED",
        workflowKey,
        fallbackMessage:
          "Customer Onboarding workflow could not be initialized for this webhook-created thread.",
        error,
      });
      warnings.push(warning);
      await insertWarningMessage({
        tenantId: input.tenantId,
        threadId: thread.threadId,
        content: warning.message,
        createdAt,
        metadata: {
          source: "webhook",
          kind: "workflow_warning",
          webhookId: input.webhookId,
          webhookName: input.webhookName,
          workflowKey,
          code: warning.code,
        },
      });
    }
  } else if (workflowKey) {
    const warning: SpaceWebhookThreadStartWarning = {
      code: "UNSUPPORTED_SPACE_WORKFLOW",
      message: `Space workflow "${workflowKey}" is configured but cannot be started from webhooks yet.`,
      workflowKey,
    };
    warnings.push(warning);
    await insertWarningMessage({
      tenantId: input.tenantId,
      threadId: thread.threadId,
      content: warning.message,
      createdAt,
      metadata: {
        source: "webhook",
        kind: "workflow_warning",
        webhookId: input.webhookId,
        webhookName: input.webhookName,
        workflowKey,
        code: warning.code,
      },
    });
  }

  return {
    ...thread,
    openingMessageId: openingMessage.id,
    openingMessageContent,
    openingMessageAlreadyPersisted: true,
    warnings,
    workflow,
    agentContext: {
      webhookPayload: input.payload,
      webhookId: input.webhookId,
      webhookName: input.webhookName,
      spaceId: input.spaceId ?? null,
      openingMessageId: openingMessage.id,
      openingMessageAlreadyPersisted: true,
      workflowWarnings: warnings,
    },
  };
}

export function buildWebhookOpeningSummary(
  input: WebhookOpeningSummaryInput,
): string {
  const payload = input.payload ?? {};
  const lines = [`Webhook "${boundedValue(input.webhookName)}" was triggered.`];
  const fields = extractSummaryFields(payload);

  pushLine(lines, "Event", fields.event);
  pushLine(lines, "Customer", fields.customer);
  pushLine(lines, "Opportunity", fields.opportunity);
  pushLine(lines, "Stage", fields.stage);
  pushLine(lines, "Status", fields.status);

  const summary = lines.join("\n");
  if (summary.length <= SUMMARY_MAX_LENGTH) return summary;
  return `${summary.slice(0, SUMMARY_MAX_LENGTH - 3).trimEnd()}...`;
}

async function insertWebhookOpeningMessage(
  input: WebhookOpeningMessageInput,
): Promise<{ id: string } | null> {
  const [message] = await db
    .insert(messages)
    .values({
      thread_id: input.threadId,
      tenant_id: input.tenantId,
      role: "system",
      content: input.content,
      sender_type: "system",
      metadata: input.metadata,
      created_at: input.createdAt,
    })
    .returning({ id: messages.id });
  return message ?? null;
}

async function insertWebhookWorkflowWarningMessage(
  input: WebhookWorkflowWarningMessageInput,
): Promise<{ id: string } | null> {
  const [message] = await db
    .insert(messages)
    .values({
      thread_id: input.threadId,
      tenant_id: input.tenantId,
      role: "system",
      content: input.content,
      sender_type: "system",
      metadata: input.metadata,
      created_at: input.createdAt,
    })
    .returning({ id: messages.id });
  return message ?? null;
}

async function findActiveSpace(input: {
  tenantId: string;
  spaceId: string;
}): Promise<SpaceWebhookThreadStartSpace | null> {
  const [space] = await db
    .select({
      id: spaces.id,
      tenantId: spaces.tenant_id,
      kind: spaces.kind,
      templateKey: spaces.template_key,
      config: spaces.config,
    })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, input.tenantId),
        eq(spaces.id, input.spaceId),
        eq(spaces.status, "active"),
      ),
    )
    .limit(1);
  return space
    ? {
        id: space.id,
        tenantId: space.tenantId,
        kind: space.kind,
        templateKey: space.templateKey,
        config: objectRecord(space.config),
      }
    : null;
}

function detectSpaceWorkflowKey(
  space: SpaceWebhookThreadStartSpace,
): string | null {
  if (
    normalizeKey(space.kind) === CUSTOMER_ONBOARDING_TEMPLATE_KEY ||
    normalizeKey(space.templateKey) === CUSTOMER_ONBOARDING_TEMPLATE_KEY
  ) {
    return CUSTOMER_ONBOARDING_TEMPLATE_KEY;
  }
  const workflow = normalizeKey(space.config?.workflow);
  if (!workflow || GENERAL_WORKFLOW_KEYS.has(workflow)) return null;
  return workflow;
}

function customerOnboardingWorkflowSummary(
  result: CustomerOnboardingWorkflowResult,
): NonNullable<StartSpaceWebhookThreadResult["workflow"]> {
  return {
    key: CUSTOMER_ONBOARDING_TEMPLATE_KEY,
    threadId: result.thread.id,
    idempotent: result.idempotent,
    missingFields: result.missingFields,
    linkedTaskCount: result.linkedTasks.length,
  };
}

function workflowWarningFromError(input: {
  code: string;
  workflowKey: string;
  fallbackMessage: string;
  error: unknown;
}): SpaceWebhookThreadStartWarning {
  const errorMessage =
    input.error instanceof Error ? input.error.message : input.fallbackMessage;
  return {
    code: input.code,
    message: `${input.fallbackMessage} ${errorMessage}`,
    workflowKey: input.workflowKey,
  };
}

function extractSummaryFields(
  payload: Record<string, unknown>,
): Record<string, string | null> {
  return {
    event:
      stringValue(payload.event) ??
      stringValue(payload.type) ??
      stringValue(payload.eventType),
    customer:
      stringValue(payload.companyName) ??
      stringValue(payload.customerName) ??
      stringValue(payload.customer) ??
      stringValue(payload.accountName),
    opportunity:
      stringValue(payload.opportunityName) ??
      stringValue(payload.dealName) ??
      stringValue(payload.opportunity),
    stage:
      stringValue(payload.stage) ??
      stringValue(payload.triggerStage) ??
      stringValue(payload.stageName),
    status: stringValue(payload.status),
  };
}

function pushLine(lines: string[], label: string, value: string | null): void {
  if (!value) return;
  lines.push(`${label}: ${boundedValue(value)}`);
}

function boundedValue(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= FIELD_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, FIELD_MAX_LENGTH - 3).trimEnd()}...`;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return (
      stringValue(record.name) ??
      stringValue(record.title) ??
      stringValue(record.label)
    );
  }
  return null;
}

function normalizeKey(value: unknown): string | null {
  return stringValue(value)?.toLowerCase() ?? null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
