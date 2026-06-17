import type { EmailChannelProvider } from "@thinkwork/database-pg/schema";

export type EmailProviderKey = EmailChannelProvider;

export type EmailProviderEventType =
  | "sent"
  | "delivered"
  | "delayed"
  | "failed"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "received";

export type EmailReadinessCheckKey =
  | "credentials"
  | "sending_domain"
  | "inbound_receiving"
  | "webhook_signature"
  | "provider_events"
  | "loop_test";

export type EmailReadinessStatus = "pending" | "pass" | "fail" | "blocked";

export interface EmailProviderSendInput {
  tenantId?: string;
  providerInstallId?: string;
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  rawMessage?: Buffer | Uint8Array | string;
  messageId?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  idempotencyKey?: string;
  credential?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailProviderSendResult {
  provider: EmailProviderKey;
  providerMessageId: string;
  status: "sent";
  metadata: Record<string, unknown>;
}

export interface EmailProviderWebhookInput {
  rawBody: string | Buffer;
  headers: Record<string, string | string[] | undefined>;
  webhookSecret?: string;
  credential?: string;
}

export interface NormalizedEmailAttachment {
  id?: string;
  filename?: string;
  contentType?: string;
  contentLength?: number;
  metadata: Record<string, unknown>;
}

export interface NormalizedInboundEmail {
  provider: EmailProviderKey;
  providerEventId: string;
  providerMessageId: string;
  receivedAt: Date;
  fromEmail: string;
  toEmails: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  headers: Record<string, string>;
  attachments: NormalizedEmailAttachment[];
  bodyObjectRef?: string;
  metadata: Record<string, unknown>;
}

export interface NormalizedProviderEvent {
  provider: EmailProviderKey;
  providerEventId: string;
  providerMessageId: string;
  eventType: EmailProviderEventType;
  occurredAt: Date | null;
  inbound?: NormalizedInboundEmail;
  metadata: Record<string, unknown>;
}

export interface EmailReadinessCheckResult {
  checkKey: EmailReadinessCheckKey;
  status: EmailReadinessStatus;
  failureCode?: string;
  failureMessage?: string;
  metadata: Record<string, unknown>;
}

export interface EmailDomainInstructions {
  provider: EmailProviderKey;
  domain: string;
  ownershipType: "thinkwork_owned" | "customer_owned";
  records: Array<{
    type: string;
    host: string;
    value: string;
    priority?: number;
    ttl?: number;
  }>;
  notes: string[];
}

export interface EmailProviderAdapter {
  provider: EmailProviderKey;
  send(input: EmailProviderSendInput): Promise<EmailProviderSendResult>;
  verifyEvent(
    input: EmailProviderWebhookInput,
  ): Promise<NormalizedProviderEvent>;
  normalizeInbound(input: unknown): Promise<NormalizedInboundEmail>;
  readinessChecks(input: {
    credentialConfigured: boolean;
    webhookSecretConfigured: boolean;
    domainVerified: boolean;
    inboundVerified: boolean;
    providerEventsReachable: boolean;
    loopTestPassed: boolean;
  }): Promise<EmailReadinessCheckResult[]>;
  domainInstructions(input: {
    domain: string;
    ownershipType: "thinkwork_owned" | "customer_owned";
  }): EmailDomainInstructions;
}

export class EmailProviderError extends Error {
  readonly code: string;
  readonly provider: EmailProviderKey;
  readonly failClosed: true;
  readonly retryable: boolean;
  readonly metadata: Record<string, unknown>;

  constructor(
    provider: EmailProviderKey,
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EmailProviderError";
    this.provider = provider;
    this.code = code;
    this.failClosed = true;
    this.retryable = options.retryable ?? false;
    this.metadata = options.metadata ?? {};
  }
}

export function providerSafeError(error: unknown): {
  code: string;
  message: string;
  provider?: EmailProviderKey;
  retryable: boolean;
} {
  if (error instanceof EmailProviderError) {
    return {
      code: error.code,
      message: error.message,
      provider: error.provider,
      retryable: error.retryable,
    };
  }
  return {
    code: "EMAIL_PROVIDER_ERROR",
    message: "Email provider operation failed",
    retryable: false,
  };
}
