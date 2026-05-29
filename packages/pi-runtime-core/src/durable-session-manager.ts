import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Message } from "@earendil-works/pi-ai";

/**
 * Durable per-thread session storage. The cloud host implements this over S3
 * (one object per thread, optimistic concurrency via the object's ETag); the
 * desktop host can implement it over its own workspace store (U9). The store is
 * intentionally a plain blob interface — the Pi SDK's `SessionManager` is a
 * concrete, filesystem-coupled class (private constructor, JSONL on disk), not a
 * pluggable backend, so durability is achieved by syncing its session file to
 * and from this store around each turn rather than by reimplementing it.
 */
export interface SessionStore {
  /**
   * Read the stored session body for `key`, with an opaque `version` token
   * (e.g. the S3 ETag) used for optimistic concurrency. Returns null when no
   * session exists yet for the thread.
   */
  read(key: string): Promise<{ body: string; version: string } | null>;
  /**
   * Write `body` for `key`.
   * - `expectedVersion === null` means "create only if absent" (a brand-new
   *   thread session); the write must fail if the key already exists.
   * - a non-null `expectedVersion` means "overwrite only if the stored version
   *   still matches"; the write must fail if it has changed underneath us.
   * On a precondition failure the implementation throws {@link SessionConflictError}.
   * Returns the new version token.
   */
  write(
    key: string,
    body: string,
    expectedVersion: string | null,
  ): Promise<string>;
}

/** Structured logger used by the durable-session path and the loop's
 *  persist-failure handling. No-op by default. */
export type SessionLog = (entry: {
  level: "info" | "warn" | "error";
  event: string;
  [key: string]: unknown;
}) => void;

/** Thrown by a {@link SessionStore} write when the optimistic-concurrency
 *  precondition fails (a concurrent turn wrote the same thread's session). */
export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

/** The minimal `SessionManager` surface the durable wrapper drives. Matches the
 *  Pi SDK `SessionManager`; declared locally so this module stays free of a
 *  load-time SDK import (the host injects the real factories). */
export interface SessionManagerLike {
  getSessionFile(): string | undefined;
  appendMessage(message: Message): string;
  /** Loaded session entries. Used to detect an opened-but-empty session (the
   *  SDK silently starts fresh on a malformed/empty file rather than throwing),
   *  which must rebuild from history instead of resuming an empty context. */
  getEntries(): unknown[];
}

export interface SessionManagerFactories<
  TManager extends SessionManagerLike = SessionManagerLike,
> {
  /** `SessionManager.open(path, sessionDir?, cwdOverride?)` — resume an existing
   *  session file. Throws if the file is missing or malformed. */
  open(
    sessionFile: string,
    sessionDir?: string,
    cwdOverride?: string,
  ): TManager;
  /** `SessionManager.create(cwd, sessionDir?)` — start a fresh session. */
  create(cwd: string, sessionDir?: string): TManager;
}

export interface OpenDurableSessionArgs<
  TManager extends SessionManagerLike = SessionManagerLike,
> {
  store: SessionStore;
  /** Stable per-thread identity; also the basis for the store key. */
  threadId: string;
  /** Workspace dir recorded in the session header (the agent's cwd). */
  cwd: string;
  /** Local scratch directory the SDK reads/writes the session file in. */
  sessionDir: string;
  /** Pi SDK SessionManager factories (injected; real ones in the host). */
  factories: SessionManagerFactories<TManager>;
  /** Prior conversation, used ONLY to seed a brand-new session (lazy migration
   *  of a pre-durable thread). Ignored when a stored session is resumed. */
  seedHistory?: Message[];
  /** Optional structured logger; defaults to no-op. */
  log?: SessionLog;
}

export interface DurableSession<
  TManager extends SessionManagerLike = SessionManagerLike,
> {
  /** Pass to `createAgentSession({ sessionManager })`; resumes prior context. */
  sessionManager: TManager;
  /** True when the turn resumed a stored session (vs. a freshly seeded one). */
  resumed: boolean;
  /** Persist the post-turn session file back to the store with optimistic
   *  concurrency. Throws {@link SessionConflictError} on a concurrent write. */
  persist(): Promise<void>;
}

/** Filesystem-safe object key for a thread's session. */
export function sessionKey(threadId: string): string {
  const safe = threadId.replace(/[^a-zA-Z0-9._-]/g, "_") || "thread";
  return `${safe}.jsonl`;
}

function localSessionPath(sessionDir: string, threadId: string): string {
  // Invocation-unique so two concurrent turns for the same thread on one warm
  // container do not share (and clobber) the same local scratch file. The S3
  // object key stays thread-stable; only this local copy needs to be unique.
  return path.join(sessionDir, `${randomUUID()}-${sessionKey(threadId)}`);
}

/**
 * Open (resume) or create a durable per-thread session backed by `store`.
 *
 * - Stored session present → download to a local file and `open` it; the agent
 *   resumes from `buildSessionContext()`. No full-history replay.
 * - No stored session → `create` a fresh session and seed it from `seedHistory`
 *   (lazy migration of a thread that predates durable sessions). The next turn
 *   resumes from the persisted session.
 * - Stored session present but unreadable/malformed → rebuild from `seedHistory`
 *   and overwrite with the held version on persist (logged, never a silent empty
 *   context). Concurrency safety is preserved because the held version still
 *   guards the overwrite.
 */
export async function openDurableSession<
  TManager extends SessionManagerLike = SessionManagerLike,
>(args: OpenDurableSessionArgs<TManager>): Promise<DurableSession<TManager>> {
  const log = args.log ?? (() => {});
  const key = sessionKey(args.threadId);
  await mkdir(args.sessionDir, { recursive: true });

  const stored = await args.store.read(key);
  let version: string | null = stored?.version ?? null;
  let sessionManager: TManager | undefined;
  let resumed = false;

  if (stored) {
    const localFile = localSessionPath(args.sessionDir, args.threadId);
    try {
      await writeFile(localFile, stored.body, "utf8");
      const opened = args.factories.open(localFile, args.sessionDir, args.cwd);
      // The SDK does not throw on a malformed/empty session file — it skips
      // unparseable lines and silently starts a fresh empty session. Detect
      // that here so we rebuild from history rather than resuming empty (which
      // would silently drop the whole transcript). An entry-bearing thread that
      // parsed to zero entries is treated as corrupt.
      if (opened.getEntries().length === 0) {
        log({
          level: "error",
          event: "durable_session_empty_rebuilding",
          threadId: args.threadId,
        });
        sessionManager = undefined;
      } else {
        sessionManager = opened;
        resumed = true;
        log({
          level: "info",
          event: "durable_session_resumed",
          threadId: args.threadId,
        });
      }
    } catch (error) {
      // Corrupt/unreadable stored session: rebuild from history rather than
      // resuming an empty context, but keep `version` so the overwrite still
      // races safely against a concurrent writer.
      log({
        level: "error",
        event: "durable_session_corrupt_rebuilding",
        threadId: args.threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      sessionManager = undefined;
    }
  }

  if (!sessionManager) {
    sessionManager = args.factories.create(args.cwd, args.sessionDir);
    for (const message of args.seedHistory ?? []) {
      sessionManager.appendMessage(message);
    }
    log({
      level: "info",
      event: "durable_session_created",
      threadId: args.threadId,
      seededMessages: args.seedHistory?.length ?? 0,
    });
  }

  const persist = async (): Promise<void> => {
    const sessionFile = sessionManager?.getSessionFile();
    if (!sessionFile) {
      throw new Error(
        "Durable session has no session file to persist; SessionManager is not file-backed.",
      );
    }
    const body = await readFile(sessionFile, "utf8");
    version = await args.store.write(key, body, version);
    log({
      level: "info",
      event: "durable_session_persisted",
      threadId: args.threadId,
    });
  };

  return { sessionManager, resumed, persist };
}
