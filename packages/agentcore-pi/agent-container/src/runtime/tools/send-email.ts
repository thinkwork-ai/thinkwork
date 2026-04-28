import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import type { PiInvocationPayload } from "./types.js";

interface SendEmailConfig {
  agentId: string;
  tenantId: string;
  apiUrl: string;
  apiSecret: string;
  threadId?: string;
  inboundMessageId?: string;
  inboundFrom?: string;
  inboundBody?: string;
}

function resolveConfig(payload: PiInvocationPayload): SendEmailConfig | null {
  const value = payload.send_email_config;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const agentId = typeof record.agentId === "string" ? record.agentId : "";
  const tenantId = typeof record.tenantId === "string" ? record.tenantId : "";
  const apiUrl =
    typeof record.apiUrl === "string" ? record.apiUrl.replace(/\/+$/, "") : "";
  const apiSecret =
    typeof record.apiSecret === "string" ? record.apiSecret : "";
  if (!agentId || !tenantId || !apiUrl || !apiSecret) return null;
  return {
    agentId,
    tenantId,
    apiUrl,
    apiSecret,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    inboundMessageId:
      typeof record.inboundMessageId === "string"
        ? record.inboundMessageId
        : undefined,
    inboundFrom:
      typeof record.inboundFrom === "string" ? record.inboundFrom : undefined,
    inboundBody:
      typeof record.inboundBody === "string" ? record.inboundBody : undefined,
  };
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function normalizeRecipients(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

export function buildSendEmailTool(
  payload: PiInvocationPayload,
): AgentTool<any> | null {
  const config = resolveConfig(payload);
  if (!config) return null;
  return {
    name: "send_email",
    label: "Send Email",
    description:
      "Send a plain text email from the agent email address. Use outbound for new emails and reply for inbound email responses.",
    parameters: Type.Object({
      to: Type.Union([Type.String(), Type.Array(Type.String())]),
      subject: Type.String(),
      body: Type.String(),
      thread_id: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([Type.Literal("outbound"), Type.Literal("reply")])),
      in_reply_to: Type.Optional(Type.String()),
      quoted_from: Type.Optional(Type.String()),
      quoted_body: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      const input = paramsRecord(params);
      const recipients = normalizeRecipients(input.to);
      const mode = input.mode === "reply" ? "reply" : "outbound";
      if (recipients.length === 0) throw new Error("send_email requires at least one recipient");
      if (recipients.length > 5) throw new Error("send_email supports at most 5 recipients");
      if (
        mode === "outbound" &&
        (input.in_reply_to || input.quoted_from || input.quoted_body)
      ) {
        throw new Error("mode='outbound' forbids reply threading fields");
      }

      const body: Record<string, unknown> = {
        agentId: config.agentId,
        to: recipients.join(", "),
        subject: String(input.subject || ""),
        body: String(input.body || ""),
      };
      const threadId =
        typeof input.thread_id === "string" && input.thread_id
          ? input.thread_id
          : config.threadId;
      if (threadId) body.threadId = threadId;
      if (mode === "reply") {
        const inReplyTo =
          typeof input.in_reply_to === "string" && input.in_reply_to
            ? input.in_reply_to
            : config.inboundMessageId;
        const quotedFrom =
          typeof input.quoted_from === "string" && input.quoted_from
            ? input.quoted_from
            : config.inboundFrom;
        const quotedBody =
          typeof input.quoted_body === "string" && input.quoted_body
            ? input.quoted_body
            : config.inboundBody;
        if (inReplyTo) body.inReplyTo = inReplyTo;
        if (quotedFrom) body.quotedFrom = quotedFrom;
        if (quotedBody) body.quotedBody = quotedBody;
      }

      const response = await fetch(`${config.apiUrl}/api/email/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiSecret}`,
          "x-tenant-id": config.tenantId,
          "x-agent-id": config.agentId,
          "user-agent": "Thinkwork-PiRuntime/1.0",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Email send failed: HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      const result = text ? JSON.parse(text) : {};
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, ...result }) }],
        details: { ok: true, ...result },
      };
    },
  };
}
