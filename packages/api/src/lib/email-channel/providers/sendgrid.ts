import { buildReadinessChecks } from "../readiness.js";
import {
  EmailProviderError,
  type EmailDomainInstructions,
  type EmailProviderAdapter,
  type EmailProviderSendInput,
  type EmailProviderSendResult,
  type EmailProviderWebhookInput,
  type NormalizedInboundEmail,
  type NormalizedProviderEvent,
} from "../provider-contract.js";

const SENDGRID_API_BASE = "https://api.sendgrid.com";
const SENDGRID_EU_API_BASE = "https://api.eu.sendgrid.com";
const DOMAIN_PAGE_SIZE = 100;
const MAX_DOMAIN_PAGES = 30;

export interface SendGridProviderDeps {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export interface SendGridAuthenticatedDomain {
  id: string;
  domain: string;
  subdomain?: string;
  valid: boolean;
  default: boolean;
  legacy: boolean;
  username?: string;
  dns: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export function createSendGridProvider(
  deps: SendGridProviderDeps = {},
): EmailProviderAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    provider: "sendgrid",
    send: (input) => sendSendGridEmail(fetchImpl, input, deps.apiBaseUrl),
    verifyEvent: unsupportedWebhook,
    normalizeInbound: unsupportedInbound,
    readinessChecks: async (input) =>
      buildReadinessChecks({
        credentialConfigured: input.credentialConfigured,
        domainVerified: input.domainVerified,
        inboundVerified: true,
        webhookSecretConfigured: true,
        providerEventsReachable: input.providerEventsReachable,
        loopTestPassed: input.loopTestPassed,
      }).map((check) =>
        check.checkKey === "inbound_receiving" ||
        check.checkKey === "webhook_signature"
          ? {
              ...check,
              status: "pass" as const,
              metadata: {
                ...check.metadata,
                notApplicableFor: "sendgrid_invitation_outbound",
              },
            }
          : check,
      ),
    domainInstructions: (input) => sendGridDomainInstructions(input),
  };
}

export async function listSendGridAuthenticatedDomains(input: {
  credential: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<SendGridAuthenticatedDomain[]> {
  const apiKey = input.credential.trim();
  if (!apiKey) {
    throw new EmailProviderError(
      "sendgrid",
      "SENDGRID_CREDENTIAL_MISSING",
      "SendGrid API key is not configured.",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const domains: SendGridAuthenticatedDomain[] = [];
  for (let offset = 0; offset < DOMAIN_PAGE_SIZE * MAX_DOMAIN_PAGES; ) {
    const url = new URL("/v3/whitelabel/domains", apiBase(input.apiBaseUrl));
    url.searchParams.set("limit", String(DOMAIN_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      throw new EmailProviderError(
        "sendgrid",
        "SENDGRID_DOMAIN_LIST_FAILED",
        "SendGrid authenticated-domain lookup failed.",
        {
          retryable: response.status >= 500,
          metadata: {
            status: response.status,
            error: safeString(errorMessage(body)),
          },
        },
      );
    }
    const page = normalizeDomainList(body);
    domains.push(...page);
    if (page.length < DOMAIN_PAGE_SIZE) break;
    offset += DOMAIN_PAGE_SIZE;
  }
  return domains;
}

export function usableSendGridDomains(
  domains: SendGridAuthenticatedDomain[],
): SendGridAuthenticatedDomain[] {
  return domains.filter((domain) => domain.valid && !domain.legacy);
}

async function sendSendGridEmail(
  fetchImpl: typeof fetch,
  input: EmailProviderSendInput,
  apiBaseUrl?: string,
): Promise<EmailProviderSendResult> {
  if (!input.credential) {
    throw new EmailProviderError(
      "sendgrid",
      "SENDGRID_CREDENTIAL_MISSING",
      "SendGrid API key is not configured.",
    );
  }
  if (input.rawMessage) {
    throw new EmailProviderError(
      "sendgrid",
      "SENDGRID_RAW_MIME_UNSUPPORTED",
      "SendGrid invitation delivery requires structured text/html content.",
    );
  }

  const response = await fetchImpl(`${apiBase(apiBaseUrl)}/v3/mail/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.credential}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey
        ? { "Idempotency-Key": input.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: input.to.map((email) => ({ email })),
          ...(input.cc?.length
            ? { cc: input.cc.map((email) => ({ email })) }
            : {}),
          ...(input.headers ? { headers: input.headers } : {}),
          ...(input.tags ? { custom_args: input.tags } : {}),
        },
      ],
      from: { email: input.from, name: "ThinkWork" },
      ...(input.replyTo ? { reply_to: { email: input.replyTo } } : {}),
      subject: input.subject,
      content: [
        ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
        ...(input.html ? [{ type: "text/html", value: input.html }] : []),
      ],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new EmailProviderError(
      "sendgrid",
      "SENDGRID_SEND_FAILED",
      "SendGrid email send failed; invitation email must fail closed.",
      {
        retryable: response.status >= 500,
        metadata: {
          status: response.status,
          error: safeString(errorMessage(body)),
        },
      },
    );
  }

  return {
    provider: "sendgrid",
    providerMessageId:
      response.headers.get("x-message-id") ||
      `sendgrid:${input.idempotencyKey ?? Date.now()}`,
    status: "sent",
    metadata: {
      status: response.status,
      messageIdHeader: response.headers.get("x-message-id"),
    },
  };
}

async function unsupportedWebhook(
  _input: EmailProviderWebhookInput,
): Promise<NormalizedProviderEvent> {
  throw new EmailProviderError(
    "sendgrid",
    "SENDGRID_WEBHOOK_UNSUPPORTED",
    "SendGrid inbound and event webhooks are outside this invitation-provider scope.",
  );
}

async function unsupportedInbound(
  _input: unknown,
): Promise<NormalizedInboundEmail> {
  throw new EmailProviderError(
    "sendgrid",
    "SENDGRID_INBOUND_UNSUPPORTED",
    "SendGrid inbound email is outside this invitation-provider scope.",
  );
}

function sendGridDomainInstructions(input: {
  domain: string;
  ownershipType: "thinkwork_owned" | "customer_owned";
}): EmailDomainInstructions {
  return {
    provider: "sendgrid",
    domain: input.domain,
    ownershipType: input.ownershipType,
    records: [],
    notes: [
      "Authenticate this domain in SendGrid, then save the SendGrid API key in ThinkWork so authenticated domains can be fetched.",
    ],
  };
}

function normalizeDomainList(value: unknown): SendGridAuthenticatedDomain[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) => normalizeDomainRow(record(row)));
}

function normalizeDomainRow(row: Record<string, unknown>) {
  return {
    id: safeString(row.id),
    domain: safeString(row.domain).toLowerCase(),
    subdomain: optionalString(row.subdomain),
    valid: Boolean(row.valid),
    default: Boolean(row.default),
    legacy: Boolean(row.legacy),
    username: optionalString(row.username),
    dns: record(row.dns),
    metadata: sanitize(row),
  };
}

function apiBase(value?: string): string {
  const base = value?.trim();
  if (base === "eu") return SENDGRID_EU_API_BASE;
  return (base || SENDGRID_API_BASE).replace(/\/$/, "");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function optionalString(value: unknown): string | undefined {
  const text = safeString(value);
  return text ? text : undefined;
}

function errorMessage(value: unknown): unknown {
  const body = record(value);
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const first = record(errors[0]);
  return first.message ?? body.message ?? body.error;
}

function sanitize(row: Record<string, unknown>): Record<string, unknown> {
  const { dns, ...rest } = row;
  return {
    ...rest,
    dnsRecordKeys: Object.keys(record(dns)),
  };
}
