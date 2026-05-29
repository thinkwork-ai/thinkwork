// Session/memory store for the harness.
//
// v1 ships an in-memory implementation behind an interface; the device-backed
// implementation (expo-sqlite) and the "sync to server when online" reconciliation with
// platform threads + Hindsight are later units that implement the same SessionStore shape.

import type { Message } from "./types";

export interface SessionRecord {
  id: string;
  messages: Message[];
  /** Caller-supplied monotonic timestamp (ms). Passed in rather than read so the store stays pure/testable. */
  updatedAt: number;
}

export interface SessionStore {
  load(sessionId: string): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
  append(
    sessionId: string,
    messages: Message[],
    at: number,
  ): Promise<SessionRecord>;
  list(): Promise<SessionRecord[]>;
}

/** Non-persistent store for tests and offline UI development. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async load(sessionId: string): Promise<SessionRecord | null> {
    const found = this.sessions.get(sessionId);
    return found ? { ...found, messages: [...found.messages] } : null;
  }

  async save(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, { ...record, messages: [...record.messages] });
  }

  async append(
    sessionId: string,
    messages: Message[],
    at: number,
  ): Promise<SessionRecord> {
    const existing = this.sessions.get(sessionId);
    const next: SessionRecord = {
      id: sessionId,
      messages: [...(existing?.messages ?? []), ...messages],
      updatedAt: at,
    };
    this.sessions.set(sessionId, next);
    return { ...next, messages: [...next.messages] };
  }

  async list(): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => ({ ...r, messages: [...r.messages] }));
  }
}
