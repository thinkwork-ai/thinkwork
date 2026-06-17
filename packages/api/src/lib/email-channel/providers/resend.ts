import { Webhook } from "svix";
import { buildReadinessChecks } from "../readiness.js";
import {
  EmailProviderError,
  type EmailDomainInstructions,
  type EmailProviderAdapter,
  type EmailProviderEventType,
  type EmailProviderSendInput,
  type EmailProviderSendResult,
  type EmailProviderWebhookInput,
  type NormalizedInboundEmail,
  type NormalizedProviderEvent,
} from "../provider-contract.js";

const RESEND_API_BASE = "https://api.resend.com";

export interface ResendProviderDeps {
  fetchImpl?: typeof fetch;
  verifyWebhook?: (input: {
    payload: string;
    headers: Record<string, string>;
    webhookSecret: string;
  }) => unknown;
  fetchReceivedEmailContent?: (
    emailId: string,
    credential: string,
  ) => Promise<Partial<NormalizedInboundEmail>>;
}

export interface ResendWebhookCreateResult {
  id: string;
  signingSecret: string;
  metadata: Record<string, unknown>;
}

export function createResendProvider(
  deps: ResendProviderDeps = {},
): EmailProviderAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    provider: "resend",
    send: (input) => sendResendEmail(fetchImpl, input),
    verifyEvent: (input) => verifyResendEvent(input, deps),
    normalizeInbound: async (input) => normalizeResendInbound(input, deps),
    readinessChecks: async (input) => buildReadinessChecks(input),
    domainInstructions: (input) => resendDomainInstructions(input),
  };
}

async function sendResendEmail(
  fetchImpl: typeof fetch,
  input: EmailProviderSendInput,
): Promise<EmailProviderSendResult> {
  if (!input.credential) {
    throw new EmailProviderError(
      "resend",
      "RESEND_CREDENTIAL_MISSING",
      "Resend API key is not configured.",
    );
  }
  if (input.rawMessage) {
    throw new EmailProviderError(
      "resend",
      "RESEND_RAW_MIME_UNSUPPORTED",
      "Resend adapter requires structured text/html content, not raw MIME.",
    );
  }

  const response = await fetchImpl(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.credential}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey
        ? { "Idempotency-Key": input.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      ...(input.cc?.length ? { cc: input.cc } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      subject: input.subject,
      ...(input.text ? { text: input.text } : {}),
      ...(input.html ? { html: input.html } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.tags ? { tags: tagsPayload(input.tags) } : {}),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new EmailProviderError(
      "resend",
      "RESEND_SEND_FAILED",
      "Resend email send failed; production email must fail closed.",
      {
        retryable: response.status >= 500,
        metadata: {
          status: response.status,
          error: safeString(body.message ?? body.error),
        },
      },
    );
  }

  return {
    provider: "resend",
    providerMessageId: safeString(body.id),
    status: "sent",
    metadata: { response: body },
  };
}

export async function createResendWebhook(input: {
  credential: string;
  endpoint: string;
  events: string[];
  fetchImpl?: typeof fetch;
}): Promise<ResendWebhookCreateResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${RESEND_API_BASE}/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      endpoint: input.endpoint,
      events: input.events,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new EmailProviderError(
      "resend",
      "RESEND_WEBHOOK_CREATE_FAILED",
      "Resend webhook creation failed; production email must fail closed until webhook readiness passes.",
      {
        retryable: response.status >= 500,
        metadata: {
          status: response.status,
          error: safeString(body.message ?? body.error),
        },
      },
    );
  }
  const signingSecret = safeString(body.signing_secret);
  if (!signingSecret) {
    throw new EmailProviderError(
      "resend",
      "RESEND_WEBHOOK_SECRET_MISSING",
      "Resend did not return a webhook signing secret.",
    );
  }
  return {
    id: safeString(body.id),
    signingSecret,
    metadata: sanitizeResendPayload(body),
  };
}

async function verifyResendEvent(
  input: EmailProviderWebhookInput,
  deps: ResendProviderDeps,
): Promise<NormalizedProviderEvent> {
  if (!input.webhookSecret) {
    throw new EmailProviderError(
      "resend",
      "RESEND_WEBHOOK_SECRET_MISSING",
      "Resend webhook secret is not configured.",
    );
  }
  const payload = rawBodyString(input.rawBody);
  const headers = svixHeaders(input.headers);
  let verified: unknown;
  try {
    verified = deps.verifyWebhook
      ? deps.verifyWebhook({
          payload,
          headers,
          webhookSecret: input.webhookSecret,
        })
      : new Webhook(input.webhookSecret).verify(payload, headers);
  } catch (cause) {
    throw new EmailProviderError(
      "resend",
      "RESEND_WEBHOOK_SIGNATURE_INVALID",
      "Resend webhook signature verification failed.",
      { cause },
    );
  }
  return normalizeResendProviderEvent(verified, input.credential, deps);
}

async function normalizeResendProviderEvent(
  value: unknown,
  credential: string | undefined,
  deps: ResendProviderDeps,
): Promise<NormalizedProviderEvent> {
  const event = requireRecord(value, "Resend webhook payload");
  const data = requireRecord(event.data, "Resend webhook data");
  const eventType = mapResendEventType(safeString(event.type));
  const providerEventId =
    safeString(event.id) ||
    safeString(event["webhook_id"]) ||
    `${safeString(event.type)}:${safeString(data.id) || safeString(data.email_id)}`;
  const providerMessageId =
    safeString(data.email_id) || safeString(data.id) || providerEventId;
  const occurredAt = dateValue(event.created_at ?? data.created_at);
  const inbound =
    eventType === "received"
      ? await normalizeResendInboundFromData(data, {
          providerEventId,
          providerMessageId,
          occurredAt,
          credential,
          deps,
        })
      : undefined;

  return {
    provider: "resend",
    providerEventId,
    providerMessageId,
    eventType,
    occurredAt,
    inbound,
    metadata: sanitizeResendPayload(event),
  };
}

async function normalizeResendInbound(
  input: unknown,
  deps: ResendProviderDeps,
): Promise<NormalizedInboundEmail> {
  const event = await normalizeResendProviderEvent(input, undefined, deps);
  if (!event.inbound) {
    throw new EmailProviderError(
      "resend",
      "RESEND_INBOUND_EVENT_REQUIRED",
      "Resend event is not an inbound email event.",
    );
  }
  return event.inbound;
}

async function normalizeResendInboundFromData(
  data: Record<string, unknown>,
  context: {
    providerEventId: string;
    providerMessageId: string;
    occurredAt: Date | null;
    credential?: string;
    deps: ResendProviderDeps;
  },
): Promise<NormalizedInboundEmail> {
  const emailId = context.providerMessageId;
  const fetched =
    context.credential && context.deps.fetchReceivedEmailContent
      ? await context.deps.fetchReceivedEmailContent(
          emailId,
          context.credential,
        )
      : {};
  return {
    provider: "resend",
    providerEventId: context.providerEventId,
    providerMessageId: emailId,
    receivedAt: context.occurredAt ?? new Date(),
    fromEmail:
      safeEmail(data.from) ||
      safeEmail((fetched.metadata ?? {}).from) ||
      safeEmail(fetched.fromEmail),
    toEmails:
      stringArray(data.to).length > 0
        ? stringArray(data.to)
        : (fetched.toEmails ?? []),
    subject: safeString(data.subject) || fetched.subject || "",
    textBody: fetched.textBody ?? "",
    htmlBody: fetched.htmlBody ?? "",
    headers: fetched.headers ?? {},
    attachments: fetched.attachments ?? attachmentMetadata(data.attachments),
    metadata: {
      resendWebhookData: sanitizeResendPayload(data),
      contentFetched: Boolean(fetched.textBody || fetched.htmlBody),
    },
  };
}

function resendDomainInstructions(input: {
  domain: string;
  ownershipType: "thinkwork_owned" | "customer_owned";
}): EmailDomainInstructions {
  return {
    provider: "resend",
    domain: input.domain,
    ownershipType: input.ownershipType,
    records: [],
    notes: [
      "Configure the sending domain, receiving route, and webhook endpoint in Resend.",
      "Resend inbound webhooks include metadata only; ThinkWork retrieves body content after verifying the raw webhook signature.",
      "Use a dedicated production API key scoped to the selected domain whenever possible.",
    ],
  };
}

function svixHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const id = headerValue(headers, "svix-id");
  const timestamp = headerValue(headers, "svix-timestamp");
  const signature = headerValue(headers, "svix-signature");
  if (!id || !timestamp || !signature) {
    throw new EmailProviderError(
      "resend",
      "RESEND_WEBHOOK_SIGNATURE_MISSING",
      "Resend webhook signature headers are missing.",
    );
  }
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}

function mapResendEventType(value: string): EmailProviderEventType {
  switch (value) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.delivery_delayed":
      return "delayed";
    case "email.failed":
      return "failed";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.opened":
      return "opened";
    case "email.clicked":
      return "clicked";
    case "email.received":
      return "received";
    default:
      throw new EmailProviderError(
        "resend",
        "RESEND_EVENT_UNSUPPORTED",
        `Unsupported Resend event type: ${value}`,
      );
  }
}

function tagsPayload(tags: Record<string, string>) {
  return Object.entries(tags).map(([name, value]) => ({ name, value }));
}

function attachmentMetadata(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          id: safeString(record.id),
          filename: safeString(record.filename),
          contentType: safeString(record.content_type ?? record.contentType),
          contentLength: numberValue(record.size ?? record.content_length),
          metadata: sanitizeResendPayload(record),
        };
      })
    : [];
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return Array.isArray(found) ? (found[0] ?? "") : (found ?? "");
}

function rawBodyString(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => safeEmail(item)).filter(Boolean);
  }
  const email = safeEmail(value);
  return email ? [email] : [];
}

function dateValue(value: unknown): Date | null {
  const raw = safeString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeEmail(value: unknown): string {
  const trimmed = safeString(value).trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return (angleMatch?.[1] || trimmed).trim().toLowerCase();
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sanitizeResendPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return JSON.parse(
    JSON.stringify(value, (key, nested) => {
      if (/authorization|api[_-]?key|secret|token/i.test(key)) {
        return "[redacted]";
      }
      if (typeof nested === "string" && nested.length > 2048) {
        return `${nested.slice(0, 2048)}...[truncated]`;
      }
      return nested;
    }),
  ) as Record<string, unknown>;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new EmailProviderError(
    "resend",
    "RESEND_EVENT_INVALID",
    `${label} is invalid.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
