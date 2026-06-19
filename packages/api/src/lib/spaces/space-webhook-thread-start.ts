import { messages } from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import { ensureThreadForWork } from "../thread-helpers.js";

const SUMMARY_MAX_LENGTH = 1200;
const FIELD_MAX_LENGTH = 180;

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

export interface StartSpaceWebhookThreadResult {
  threadId: string;
  identifier: string;
  number: number;
  openingMessageId: string;
  openingMessageContent: string;
  openingMessageAlreadyPersisted: true;
  agentContext: {
    webhookPayload: Record<string, unknown>;
    webhookId: string;
    webhookName: string;
    spaceId: string | null;
    openingMessageId: string;
    openingMessageAlreadyPersisted: true;
  };
}

export interface StartSpaceWebhookThreadDeps {
  ensureThreadForWork?: typeof ensureThreadForWork;
  insertOpeningMessage?: (
    input: WebhookOpeningMessageInput,
  ) => Promise<{ id: string } | null | undefined>;
  now?: () => Date;
}

export async function startSpaceWebhookThread(
  input: StartSpaceWebhookThreadInput,
  deps: StartSpaceWebhookThreadDeps = {},
): Promise<StartSpaceWebhookThreadResult> {
  const ensureThread = deps.ensureThreadForWork ?? ensureThreadForWork;
  const insertOpeningMessage =
    deps.insertOpeningMessage ?? insertWebhookOpeningMessage;
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

  return {
    ...thread,
    openingMessageId: openingMessage.id,
    openingMessageContent,
    openingMessageAlreadyPersisted: true,
    agentContext: {
      webhookPayload: input.payload,
      webhookId: input.webhookId,
      webhookName: input.webhookName,
      spaceId: input.spaceId ?? null,
      openingMessageId: openingMessage.id,
      openingMessageAlreadyPersisted: true,
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
