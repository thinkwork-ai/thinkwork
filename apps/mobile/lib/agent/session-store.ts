// Session/memory store for the harness.
//
// v1 ships an in-memory implementation behind an interface; the device-backed
// implementation (expo-sqlite) and the "sync to server when online" reconciliation with
// platform threads + Hindsight are later units that implement the same SessionStore shape.

import type { AgentEvent, AgentStopReason, Message } from "./types";

export const DEFAULT_SESSION_COMPACTION_MESSAGE_THRESHOLD = 80;

export interface SessionCompaction {
  /** Short deterministic summary of messages removed from the live context. */
  summary: string;
  /** Count of transcript messages covered by the summary. */
  messageCount: number;
  /** Caller-supplied monotonic timestamp (ms). */
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  messages: Message[];
  /** Stable activity transcript captured from the Pi-shaped event stream. */
  events?: AgentEvent[];
  stopReason?: AgentStopReason;
  compaction?: SessionCompaction;
  /** Caller-supplied monotonic timestamp (ms). Passed in rather than read so the store stays pure/testable. */
  updatedAt: number;
}

export interface SessionAppendMetadata {
  events?: AgentEvent[];
  stopReason?: AgentStopReason;
}

export interface SessionStore {
  load(sessionId: string): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
  append(
    sessionId: string,
    messages: Message[],
    at: number,
    metadata?: SessionAppendMetadata,
  ): Promise<SessionRecord>;
  list(): Promise<SessionRecord[]>;
}

function cloneRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    messages: [...record.messages],
    events: record.events ? [...record.events] : undefined,
    compaction: record.compaction ? { ...record.compaction } : undefined,
  };
}

export function shouldCompactSession(
  record: SessionRecord,
  threshold = DEFAULT_SESSION_COMPACTION_MESSAGE_THRESHOLD,
): boolean {
  return record.messages.length > threshold;
}

function summarizeMessage(message: Message): string {
  const content = message.content.trim().replace(/\s+/g, " ");
  const prefix = message.name
    ? `${message.role}:${message.name}`
    : message.role;
  return `${prefix}: ${content.slice(0, 160)}`;
}

export function compactSessionRecord(
  record: SessionRecord,
  options: {
    threshold?: number;
    keepMessages?: number;
    createdAt: number;
  },
): SessionRecord {
  const threshold =
    options.threshold ?? DEFAULT_SESSION_COMPACTION_MESSAGE_THRESHOLD;
  if (!shouldCompactSession(record, threshold)) return cloneRecord(record);

  const keepMessages = Math.max(2, options.keepMessages ?? 24);
  const preserved = record.messages.slice(-keepMessages);
  const compacted = record.messages.slice(0, -preserved.length);
  const summary = compacted.map(summarizeMessage).join("\n");
  return {
    ...cloneRecord(record),
    messages: preserved,
    compaction: {
      summary,
      messageCount: compacted.length,
      createdAt: options.createdAt,
    },
    updatedAt: options.createdAt,
  };
}

/** Non-persistent store for tests and offline UI development. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async load(sessionId: string): Promise<SessionRecord | null> {
    const found = this.sessions.get(sessionId);
    return found ? cloneRecord(found) : null;
  }

  async save(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, cloneRecord(record));
  }

  async append(
    sessionId: string,
    messages: Message[],
    at: number,
    metadata: SessionAppendMetadata = {},
  ): Promise<SessionRecord> {
    const existing = this.sessions.get(sessionId);
    const next: SessionRecord = {
      id: sessionId,
      messages: [...(existing?.messages ?? []), ...messages],
      events: [...(existing?.events ?? []), ...(metadata.events ?? [])],
      stopReason: metadata.stopReason ?? existing?.stopReason,
      compaction: existing?.compaction ? { ...existing.compaction } : undefined,
      updatedAt: at,
    };
    this.sessions.set(sessionId, cloneRecord(next));
    return cloneRecord(next);
  }

  async list(): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(cloneRecord);
  }
}
