import { defineLogicFunction } from "twenty-sdk/define";

import { THINKWORK_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from "src/constants/universal-identifiers";

type ThinkWorkWebhookInput = {
  event?: unknown;
  opportunityId?: unknown;
  recordId?: unknown;
  opportunityName?: unknown;
  customerId?: unknown;
  customerName?: unknown;
  companyName?: unknown;
  stage?: unknown;
  opportunityUrl?: unknown;
  workflowKey?: unknown;
  workflowRunId?: unknown;
  occurredAt?: unknown;
  idempotencyKey?: unknown;
};

type ThinkWorkWebhookResponse = {
  ok: boolean;
  status: "delivered" | "missing_configuration" | "delivery_failed";
  statusCode?: number;
  idempotencyKey?: string;
  error?: string;
  thinkwork?: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function parseResponseBody(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body.slice(0, 512);
  }
}

const handler = async (
  input: ThinkWorkWebhookInput,
): Promise<ThinkWorkWebhookResponse> => {
  const webhookUrl = process.env.THINKWORK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return {
      ok: false,
      status: "missing_configuration",
      error:
        "Configure THINKWORK_WEBHOOK_URL on the installed ThinkWork app before using this workflow action.",
    };
  }

  const event = text(input.event) ?? "opportunity.won";
  const opportunityId = text(input.opportunityId) ?? text(input.recordId);
  const occurredAt = text(input.occurredAt) ?? new Date().toISOString();
  const workflowKey = text(input.workflowKey) ?? "customer_onboarding";
  const idempotencyKey =
    text(input.idempotencyKey) ??
    ["twenty-app", event, workflowKey, opportunityId ?? "unknown", occurredAt]
      .join(":")
      .slice(0, 240);

  const payload = compactObject({
    source: "twenty-app",
    event,
    opportunityId,
    customerId: text(input.customerId),
    customerName: text(input.customerName),
    companyName: text(input.companyName),
    opportunityName: text(input.opportunityName),
    stage: text(input.stage),
    opportunityUrl: text(input.opportunityUrl),
    workflowKey,
    workflowRunId: text(input.workflowRunId),
    occurredAt,
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  const responseBody = parseResponseBody(responseText);

  if (!response.ok) {
    return {
      ok: false,
      status: "delivery_failed",
      statusCode: response.status,
      idempotencyKey,
      error:
        typeof responseBody === "string"
          ? responseBody
          : `ThinkWork webhook returned HTTP ${response.status}`,
      thinkwork: responseBody,
    };
  }

  return {
    ok: true,
    status: "delivered",
    statusCode: response.status,
    idempotencyKey,
    thinkwork: responseBody,
  };
};

export default defineLogicFunction({
  universalIdentifier: THINKWORK_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: "thinkwork-webhook",
  description:
    "Posts a Twenty workflow event to the configured ThinkWork generic webhook.",
  timeoutSeconds: 15,
  handler,
  workflowActionTriggerSettings: {
    label: "ThinkWork Webhook",
    icon: "IconBolt",
    inputSchema: [
      {
        type: "object",
        properties: {
          event: { type: "string", label: "Event" },
          opportunityId: { type: "string", label: "Opportunity ID" },
          recordId: { type: "string", label: "Record ID" },
          opportunityName: { type: "string", label: "Opportunity Name" },
          customerId: { type: "string", label: "Customer ID" },
          customerName: { type: "string", label: "Customer Name" },
          companyName: { type: "string", label: "Company Name" },
          stage: { type: "string", label: "Stage" },
          opportunityUrl: { type: "string", label: "Opportunity URL" },
          workflowKey: { type: "string", label: "Workflow Key" },
          workflowRunId: { type: "string", label: "Workflow Run ID" },
          occurredAt: { type: "string", label: "Occurred At" },
          idempotencyKey: { type: "string", label: "Idempotency Key" },
        },
      },
    ],
    outputSchema: [
      {
        type: "object",
        properties: {
          ok: { type: "boolean", label: "Delivered" },
          status: { type: "string", label: "Status" },
          statusCode: { type: "number", label: "HTTP Status" },
          idempotencyKey: { type: "string", label: "Idempotency Key" },
          error: { type: "string", label: "Error" },
          thinkwork: { type: "object", label: "ThinkWork Response" },
        },
      },
    ],
  },
});
