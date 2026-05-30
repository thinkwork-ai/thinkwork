import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SendEmailConfig {
  apiUrl?: unknown;
  apiSecret?: unknown;
  agentId?: unknown;
  tenantId?: unknown;
  threadId?: unknown;
  threadTurnId?: unknown;
  inboundMessageId?: unknown;
  inboundFrom?: unknown;
  inboundBody?: unknown;
}

export interface SendEmailExtensionOptions {
  sendEmailConfig?: SendEmailConfig | null;
  payload: Record<string, unknown>;
  fetchImpl?: FetchLike;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRecipients(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

const CURRENT_USER_RECIPIENT_ALIASES = new Set([
  "me",
  "myself",
  "my email",
  "current user",
  "current requester",
  "the user",
]);

const PLACEHOLDER_RECIPIENTS = new Set([
  "user@example.com",
  "me@example.com",
  "example@example.com",
]);

function resolveRecipients(value: unknown, currentUserEmail: string): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const recipient of normalizeRecipients(value)) {
    const normalized = recipient.toLowerCase();
    const resolvedRecipient =
      CURRENT_USER_RECIPIENT_ALIASES.has(normalized) ||
      PLACEHOLDER_RECIPIENTS.has(normalized)
        ? currentUserEmail
        : recipient;
    if (!resolvedRecipient) {
      throw new Error(
        `send_email cannot resolve recipient "${recipient}" because the current user email is unavailable.`,
      );
    }
    const dedupeKey = resolvedRecipient.toLowerCase();
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      resolved.push(resolvedRecipient);
    }
  }
  return resolved;
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body
    ? `HTTP ${response.status}: ${body.slice(0, 500)}`
    : `HTTP ${response.status}`;
}

export function createSendEmailExtension(
  options: SendEmailExtensionOptions,
): ThinkworkExtension {
  const config = options.sendEmailConfig;
  const apiUrl = asString(config?.apiUrl).replace(/\/+$/, "");
  const apiSecret = asString(config?.apiSecret);
  const agentId = asString(config?.agentId);
  const tenantId = asString(config?.tenantId);
  const enabled = Boolean(apiUrl && apiSecret && agentId && tenantId);

  return defineExtension({
    name: "thinkwork-send-email",
    toolNames: enabled ? ["send_email"] : [],
    register(pi) {
      if (!enabled || !config) return;

      const defaultThreadId = asString(config.threadId);
      const threadTurnId = asString(config.threadTurnId);
      const inboundMessageId = asString(config.inboundMessageId);
      const inboundFrom = asString(config.inboundFrom);
      const inboundBody = asString(config.inboundBody);
      const currentUserEmail = asString(options.payload.current_user_email);
      const turnContext = objectValue(options.payload.turn_context);
      const activeSpaceTenantSlug =
        asString(turnContext.spaceTenantSlug) ||
        asString(options.payload.tenant_slug);
      const activeSpaceSlug =
        asString(turnContext.spaceSlug) || asString(options.payload.space_slug);
      const fetchImpl = options.fetchImpl ?? fetch;

      const tool: ToolDefinition = {
        name: "send_email",
        label: "Send Email",
        description:
          "Send a plain text email from the active Space email address. " +
          "Use this when the user asks you to email, forward, or share results by email. " +
          'Use recipient "me" for the signed-in user when they ask you to email them.',
        parameters: Type.Object({
          to: Type.Union([
            Type.String({
              description:
                'Recipient email address, "me" for the signed-in user, or comma-separated recipients.',
            }),
            Type.Array(Type.String(), {
              description: "Recipient email addresses. Maximum 5 recipients.",
            }),
          ]),
          subject: Type.String({ description: "Email subject line." }),
          body: Type.String({ description: "Plain text email body." }),
          thread_id: Type.Optional(
            Type.String({
              description:
                "Optional Thinkwork thread id. Defaults to the current thread.",
            }),
          ),
          mode: Type.Optional(
            Type.String({
              description:
                "'outbound' for new emails, or 'reply' for inbound email replies.",
            }),
          ),
          in_reply_to: Type.Optional(
            Type.String({ description: "Message-ID being replied to." }),
          ),
          quoted_from: Type.Optional(
            Type.String({ description: "Original sender for quoted replies." }),
          ),
          quoted_body: Type.Optional(
            Type.String({ description: "Original body for quoted replies." }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const started = Date.now();
          const typedParams = objectValue(params);
          const recipients = resolveRecipients(
            typedParams.to,
            currentUserEmail,
          );
          const subject = asString(typedParams.subject);
          const body = asString(typedParams.body);
          const mode = asString(typedParams.mode) || "outbound";

          if (mode !== "outbound" && mode !== "reply") {
            throw new Error("send_email mode must be 'outbound' or 'reply'.");
          }
          if (recipients.length === 0) {
            throw new Error("send_email requires at least one recipient.");
          }
          if (recipients.length > 5) {
            throw new Error("send_email supports a maximum of 5 recipients.");
          }
          if (!subject) throw new Error("send_email requires a subject.");
          if (!body) throw new Error("send_email requires a body.");
          if (!activeSpaceTenantSlug || !activeSpaceSlug) {
            throw new Error(
              "send_email requires active Space email context, but this turn did not include spaceTenantSlug and spaceSlug.",
            );
          }
          if (
            mode === "outbound" &&
            (asString(typedParams.in_reply_to) ||
              asString(typedParams.quoted_from) ||
              asString(typedParams.quoted_body))
          ) {
            throw new Error(
              "send_email mode='outbound' forbids reply threading fields.",
            );
          }

          const inReplyTo =
            mode === "reply"
              ? asString(typedParams.in_reply_to) || inboundMessageId
              : "";
          const quotedFrom =
            mode === "reply"
              ? asString(typedParams.quoted_from) || inboundFrom
              : "";
          const quotedBody =
            mode === "reply"
              ? asString(typedParams.quoted_body) || inboundBody
              : "";

          const requestPayload: Record<string, unknown> = {
            agentId,
            to: recipients.join(", "),
            subject,
            body,
            spaceTenantSlug: activeSpaceTenantSlug,
            spaceSlug: activeSpaceSlug,
          };
          const threadId = asString(typedParams.thread_id) || defaultThreadId;
          if (threadId) requestPayload.threadId = threadId;
          if (inReplyTo) requestPayload.inReplyTo = inReplyTo;
          if (quotedFrom) requestPayload.quotedFrom = quotedFrom;
          if (quotedBody) requestPayload.quotedBody = quotedBody;

          const response = await fetchImpl(`${apiUrl}/api/email/send`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiSecret}`,
              "Content-Type": "application/json",
              "x-tenant-id": tenantId,
              "x-agent-id": agentId,
              ...(threadTurnId ? { "x-thread-turn-id": threadTurnId } : {}),
              "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
            },
            body: JSON.stringify(requestPayload),
          });

          if (!response.ok) {
            throw new Error(`Email send failed: ${await readError(response)}`);
          }

          const result = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          return {
            content: [
              {
                type: "text",
                text: `Email sent to ${recipients.join(", ")}.`,
              },
            ],
            details: {
              ok: true,
              runtime: "pi",
              provider: "thinkwork-email",
              recipient_count: recipients.length,
              duration_ms: Date.now() - started,
              ...result,
            },
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}
