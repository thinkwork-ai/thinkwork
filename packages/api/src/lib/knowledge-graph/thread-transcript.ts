import { sql } from "drizzle-orm";
import type { Database } from "../db.js";

export interface ThreadTranscriptMessage {
  id: string;
  role: string;
  senderType: string | null;
  senderId: string | null;
  speakerLabel: string;
  text: string;
  createdAt: Date;
  ordinal: number;
}

interface MessageRow {
  id: string;
  role: string;
  content: string | null;
  parts: unknown;
  sender_type: string | null;
  sender_id: string | null;
  created_at: Date | string;
}

export async function loadThreadTranscript(args: {
  db: Database;
  tenantId: string;
  threadId: string;
}): Promise<ThreadTranscriptMessage[]> {
  const result = await args.db.execute(sql`
    SELECT id, role, content, parts, sender_type, sender_id, created_at
      FROM messages
     WHERE tenant_id = ${args.tenantId}
       AND thread_id = ${args.threadId}
     ORDER BY created_at ASC, id ASC
  `);
  const rows = ((result as unknown as { rows?: MessageRow[] }).rows ?? []).map(
    (row, index) => toTranscriptMessage(row, index),
  );
  return rows.filter((message) => message.text.trim().length > 0);
}

export function renderThreadTranscript(
  messages: ThreadTranscriptMessage[],
): string {
  return messages
    .map((message) => {
      const createdAt = message.createdAt.toISOString();
      return [
        `<!-- message:${message.id} role:${message.role} speaker:${message.speakerLabel} created:${createdAt} -->`,
        `## ${message.speakerLabel} (${message.role})`,
        message.text,
      ].join("\n");
    })
    .join("\n\n");
}

export function toTranscriptMessage(
  row: MessageRow,
  index: number,
): ThreadTranscriptMessage {
  return {
    id: row.id,
    role: row.role,
    senderType: row.sender_type,
    senderId: row.sender_id,
    speakerLabel: speakerLabel(row),
    text: extractMessageText(row.content, row.parts),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at),
    ordinal: index,
  };
}

export function extractMessageText(
  content: string | null | undefined,
  parts: unknown,
): string {
  const fromParts = extractTextValues(parts).join("\n").trim();
  if (fromParts) return fromParts;
  return (content ?? "").trim();
}

function extractTextValues(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractTextValues);
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const direct =
    typeof record.text === "string"
      ? record.text
      : typeof record.content === "string"
        ? record.content
        : null;
  const nested = [
    ...extractTextValues(record.parts),
    ...extractTextValues(record.items),
    ...extractTextValues(record.content),
  ];
  return direct ? [direct, ...nested] : nested;
}

function speakerLabel(row: MessageRow): string {
  if (row.sender_type === "agent") return "Agent";
  if (row.sender_type === "user" || row.sender_type === "human") return "User";
  if (row.sender_type === "system") return "System";
  if (row.role === "assistant") return "Agent";
  if (row.role === "user") return "User";
  return row.role || "Message";
}
