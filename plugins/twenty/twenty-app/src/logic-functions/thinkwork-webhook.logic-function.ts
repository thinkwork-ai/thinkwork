import { defineLogicFunction } from "twenty-sdk/define";

import { THINKWORK_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from "src/constants/universal-identifiers";

type ThinkWorkWebhookInput = {
  event?: unknown;
  opportunityId?: unknown;
  recordId?: unknown;
  opportunityName?: unknown;
  customerId?: unknown;
  customerName?: unknown;
  companyId?: unknown;
  companyName?: unknown;
  amount?: unknown;
  closeDate?: unknown;
  ownerId?: unknown;
  pointOfContactId?: unknown;
  stage?: unknown;
  updatedAt?: unknown;
  opportunityUrl?: unknown;
  workflowKey?: unknown;
  workflowRunId?: unknown;
  occurredAt?: unknown;
  idempotencyKey?: unknown;
  name?: unknown;
  properties?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    diff?: Record<string, unknown>;
    updatedFields?: unknown;
  };
};

type ThinkWorkWebhookResponse = {
  ok: boolean;
  status:
    | "delivered"
    | "missing_configuration"
    | "skipped_stage"
    | "delivery_failed";
  statusCode?: number;
  idempotencyKey?: string;
  configuredStage?: string;
  receivedStage?: string;
  error?: string;
  thinkwork?: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedText(
  value: unknown,
  keys: readonly string[],
): string | undefined {
  const source = record(value);
  if (!source) return undefined;
  for (const key of keys) {
    const candidate = text(source[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function stageLabel(value: unknown): string | undefined {
  return (
    text(value) ?? nestedText(value, ["label", "name", "value", "displayName"])
  );
}

function databaseEventAfter(input: ThinkWorkWebhookInput) {
  return record(input.properties?.after);
}

function stageFromInput(input: ThinkWorkWebhookInput): string | undefined {
  const diffStage = record(input.properties?.diff)?.stage;
  return (
    stageLabel(input.stage) ??
    stageLabel(databaseEventAfter(input)?.stage) ??
    stageLabel(record(diffStage)?.after) ??
    stageLabel(record(diffStage)?.to) ??
    stageLabel(record(diffStage)?.newValue)
  );
}

function decimalFromMicros(value: number | bigint | string): string | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return String(value / 1_000_000);
  }

  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) return undefined;

  const sign = raw.startsWith("-") ? "-" : "";
  const absolute = sign ? raw.slice(1) : raw;
  const padded = absolute.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fractional = padded.slice(-6).replace(/0+$/, "");

  return fractional ? `${sign}${whole}.${fractional}` : `${sign}${whole}`;
}

function currencyAmount(value: unknown): string | undefined {
  const source = record(value);
  if (!source) return text(value);
  const amountMicros = source.amountMicros;
  const amount = source.amount;
  const currencyCode = text(source.currencyCode);
  const amountText =
    typeof amountMicros === "number" ||
    typeof amountMicros === "bigint" ||
    typeof amountMicros === "string"
      ? decimalFromMicros(amountMicros)
      : typeof amount === "number" || typeof amount === "bigint"
        ? String(amount)
        : text(amount);
  if (!amountText) return undefined;
  return [amountText, currencyCode].filter(Boolean).join(" ");
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

function normalizedStage(value: string | undefined): string | undefined {
  return value?.toLowerCase().replace(/[\s_-]+/g, "");
}

const handler = async (
  input: ThinkWorkWebhookInput,
): Promise<ThinkWorkWebhookResponse> => {
  const configuredStage = process.env.THINKWORK_TRIGGER_STAGE?.trim()
    ? process.env.THINKWORK_TRIGGER_STAGE.trim()
    : "Customer";
  const after = databaseEventAfter(input);
  const receivedStage = stageFromInput(input);
  if (
    !receivedStage ||
    normalizedStage(receivedStage) !== normalizedStage(configuredStage)
  ) {
    return {
      ok: true,
      status: "skipped_stage",
      configuredStage,
      receivedStage,
    };
  }

  const webhookUrl = process.env.THINKWORK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return {
      ok: false,
      status: "missing_configuration",
      configuredStage,
      receivedStage,
      error:
        "Configure THINKWORK_WEBHOOK_URL on the installed ThinkWork app before using this workflow action.",
    };
  }

  const event =
    text(input.event) ??
    `opportunity.stage.${configuredStage.toLowerCase().replace(/\s+/g, "_")}`;
  const opportunityId =
    text(input.opportunityId) ?? text(input.recordId) ?? text(after?.id);
  const updatedAt = text(input.updatedAt) ?? text(after?.updatedAt);
  const occurredAt = text(input.occurredAt) ?? updatedAt ?? new Date().toISOString();
  const workflowKey = text(input.workflowKey) ?? "customer_onboarding";
  const idempotencyKey =
    text(input.idempotencyKey) ??
    [
      "twenty-app",
      event,
      workflowKey,
      configuredStage,
      opportunityId ?? "unknown",
      occurredAt,
    ]
      .join(":")
      .slice(0, 240);

  const payload = compactObject({
    source: "twenty-app",
    event,
    opportunityId,
    customerId: text(input.customerId),
    customerName: text(input.customerName),
    companyId:
      text(input.companyId) ??
      text(input.customerId) ??
      text(after?.companyId) ??
      text(record(after?.company)?.id),
    companyName:
      text(input.companyName) ??
      text(record(after?.company)?.name) ??
      text(record(after?.account)?.name),
    opportunityName: text(input.opportunityName) ?? text(after?.name),
    amount: currencyAmount(input.amount) ?? currencyAmount(after?.amount),
    closeDate: text(input.closeDate) ?? text(after?.closeDate),
    ownerId: text(input.ownerId) ?? text(after?.ownerId),
    pointOfContactId:
      text(input.pointOfContactId) ?? text(after?.pointOfContactId),
    stage: receivedStage,
    triggerStage: configuredStage,
    updatedAt,
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
      configuredStage,
      receivedStage,
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
    configuredStage,
    receivedStage,
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
          companyId: { type: "string", label: "Company ID" },
          companyName: { type: "string", label: "Company Name" },
          amount: { type: "object", label: "Amount" },
          closeDate: { type: "string", label: "Close Date" },
          ownerId: { type: "string", label: "Owner ID" },
          pointOfContactId: { type: "string", label: "Point of Contact ID" },
          stage: { type: "string", label: "Stage" },
          updatedAt: { type: "string", label: "Updated At" },
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
          ok: { type: "boolean", label: "Handled" },
          status: { type: "string", label: "Status" },
          statusCode: { type: "number", label: "HTTP Status" },
          idempotencyKey: { type: "string", label: "Idempotency Key" },
          configuredStage: { type: "string", label: "Configured Stage" },
          receivedStage: { type: "string", label: "Received Stage" },
          error: { type: "string", label: "Error" },
          thinkwork: { type: "object", label: "ThinkWork Response" },
        },
      },
    ],
  },
});
