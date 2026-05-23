/**
 * Vendored type stubs for Pi's `SessionStore` interface.
 *
 * Mirrored from `~/Projects/pi/packages/sdk/src/types.ts` (specifically the
 * `SessionData`, `SessionEntry`, and `SessionStore` declarations) so the
 * thinkwork monorepo can typecheck the AuroraSessionStore implementation
 * without taking a dependency on `@pi/sdk` while it's still maturing.
 *
 * When `@pi/sdk` is published and we depend on it directly, these stubs
 * should be replaced with `import type { SessionStore, SessionData } from "@pi/sdk"`.
 */

export interface SessionData {
  version: 2;
  entries: SessionEntry[];
  leafId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type SessionEntry = MessageEntry | CompactionEntry | BranchSummaryEntry;

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionEntryBase {
  type: "message";
  // Pi's AgentMessage shape — stubbed as opaque since the storage layer
  // never inspects the message payload.
  message: unknown;
  source?: "prompt" | "skill" | "shell" | "task" | "retry";
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: { readFiles: string[]; modifiedFiles: string[] };
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
}

export interface SessionStore {
  save(id: string, data: SessionData): Promise<void>;
  load(id: string): Promise<SessionData | null>;
  delete(id: string): Promise<void>;
}
