import {
  SESClient,
  SendEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import type { SESEvent } from "aws-lambda";
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

export interface SesProviderDeps {
  sesClient?: Pick<SESClient, "send">;
}

export function createSesProvider(
  deps: SesProviderDeps = {},
): EmailProviderAdapter {
  const ses = deps.sesClient ?? new SESClient({});
  return {
    provider: "ses",
    send: (input) => sendSesEmail(ses, input),
    verifyEvent: async (input) => normalizeSesProviderEvent(input),
    normalizeInbound: async (input) => normalizeSesInbound(input),
    readinessChecks: async (input) => buildReadinessChecks(input),
    domainInstructions: (input) => sesDomainInstructions(input),
  };
}

async function sendSesEmail(
  ses: Pick<SESClient, "send">,
  input: EmailProviderSendInput,
): Promise<EmailProviderSendResult> {
  try {
    if (input.rawMessage) {
      const result = await ses.send(
        new SendRawEmailCommand({
          Source: input.from,
          Destinations: input.to,
          RawMessage: { Data: toBytes(input.rawMessage) },
        }),
      );
      return {
        provider: "ses",
        providerMessageId: result.MessageId ?? "",
        status: "sent",
        metadata: { mode: "raw" },
      };
    }

    const result = await ses.send(
      new SendEmailCommand({
        Source: input.from,
        Destination: {
          ToAddresses: input.to,
          ...(input.cc?.length ? { CcAddresses: input.cc } : {}),
        },
        ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
        Message: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            ...(input.text
              ? { Text: { Data: input.text, Charset: "UTF-8" } }
              : {}),
            ...(input.html
              ? { Html: { Data: input.html, Charset: "UTF-8" } }
              : {}),
          },
        },
      }),
    );
    return {
      provider: "ses",
      providerMessageId: result.MessageId ?? "",
      status: "sent",
      metadata: { mode: "simple" },
    };
  } catch (cause) {
    throw new EmailProviderError(
      "ses",
      "SES_SEND_FAILED",
      "SES email send failed; production email must fail closed.",
      { retryable: true, cause },
    );
  }
}

async function normalizeSesProviderEvent(
  input: EmailProviderWebhookInput,
): Promise<NormalizedProviderEvent> {
  const event = parseSesEvent(input.rawBody);
  const record = event.Records[0];
  if (!record) {
    throw new EmailProviderError("ses", "SES_EVENT_EMPTY", "SES event empty");
  }
  const inbound = await normalizeSesInbound(record);
  return {
    provider: "ses",
    providerEventId: inbound.providerEventId,
    providerMessageId: inbound.providerMessageId,
    eventType: "received",
    occurredAt: inbound.receivedAt,
    inbound,
    metadata: { receipt: record.ses.receipt },
  };
}

export async function normalizeSesInbound(input: unknown) {
  const record = isSesRecord(input) ? input : parseSesEvent(input).Records[0];
  if (!record) {
    throw new EmailProviderError("ses", "SES_EVENT_EMPTY", "SES event empty");
  }
  const mail = record.ses.mail;
  return {
    provider: "ses",
    providerEventId: mail.messageId,
    providerMessageId: mail.messageId,
    receivedAt: new Date(mail.timestamp),
    fromEmail: extractEmailAddress(mail.source ?? ""),
    toEmails: record.ses.receipt.recipients ?? [],
    subject: headerValue(mail, "subject"),
    textBody: "",
    htmlBody: "",
    headers: headersRecord(mail.headers ?? []),
    attachments: [],
    metadata: {
      receipt: record.ses.receipt,
      s3Key: `email/inbound/${mail.messageId}`,
    },
  } satisfies NormalizedInboundEmail;
}

function sesDomainInstructions(input: {
  domain: string;
  ownershipType: "thinkwork_owned" | "customer_owned";
}): EmailDomainInstructions {
  return {
    provider: "ses",
    domain: input.domain,
    ownershipType: input.ownershipType,
    records: [],
    notes: [
      "SES domain verification, DKIM, MAIL FROM, receipt rules, and sandbox production access are managed through the AWS-native compatibility path.",
      "SES sandbox-to-production approval remains an external readiness gate.",
    ],
  };
}

function parseSesEvent(input: unknown): SESEvent {
  if (typeof input === "string" || Buffer.isBuffer(input)) {
    return JSON.parse(input.toString()) as SESEvent;
  }
  if (isRecord(input) && Array.isArray(input.Records)) {
    return input as unknown as SESEvent;
  }
  throw new EmailProviderError(
    "ses",
    "SES_EVENT_INVALID",
    "Invalid SES event shape",
  );
}

function isSesRecord(value: unknown): value is SESEvent["Records"][number] {
  return isRecord(value) && isRecord(value.ses) && isRecord(value.ses.mail);
}

function toBytes(value: Buffer | Uint8Array | string): Uint8Array {
  return typeof value === "string" ? Buffer.from(value) : value;
}

function headerValue(
  mail: SESEvent["Records"][number]["ses"]["mail"],
  name: string,
): string {
  return (
    mail.headers?.find((header) => header.name.toLowerCase() === name)?.value ??
    ""
  );
}

function headersRecord(
  headers: Array<{ name: string; value: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    result[header.name.toLowerCase()] = header.value;
  }
  return result;
}

function extractEmailAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return (angleMatch?.[1] || trimmed).trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
