import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Message } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SessionConflictError,
  openDurableSession,
  sessionKey,
  type SessionManagerFactories,
  type SessionManagerLike,
  type SessionStore,
} from "../src/durable-session-manager.js";

/** In-memory SessionStore with ETag-style optimistic concurrency. */
function makeFakeStore(seed?: Record<string, string>) {
  const objects = new Map<string, { body: string; version: number }>();
  if (seed) {
    for (const [key, body] of Object.entries(seed)) {
      objects.set(key, { body, version: 1 });
    }
  }
  const store: SessionStore & {
    raw: Map<string, { body: string; version: number }>;
  } = {
    raw: objects,
    async read(key) {
      const found = objects.get(key);
      return found
        ? { body: found.body, version: String(found.version) }
        : null;
    },
    async write(key, body, expectedVersion) {
      const current = objects.get(key);
      if (expectedVersion === null) {
        if (current) {
          throw new SessionConflictError(`${key} already exists`);
        }
        objects.set(key, { body, version: 1 });
        return "1";
      }
      if (!current || String(current.version) !== expectedVersion) {
        throw new SessionConflictError(`${key} version mismatch`);
      }
      const next = current.version + 1;
      objects.set(key, { body, version: next });
      return String(next);
    },
  };
  return store;
}

/** Fake SessionManager factories backed by real temp files so persist()'s
 *  readFile works. `open` throws when the stored body is the CORRUPT marker. */
function makeFakeFactories(): SessionManagerFactories {
  let counter = 0;
  function managerForFile(file: string): SessionManagerLike {
    return {
      getSessionFile: () => file,
      appendMessage: (message: Message) => {
        appendFileSync(
          file,
          `${JSON.stringify({ type: "message", message })}\n`,
        );
        return `entry-${++counter}`;
      },
      getEntries: () =>
        readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              return null;
            }
          })
          .filter((entry) => entry !== null),
    };
  }
  return {
    open(sessionFile) {
      const body = readFileSync(sessionFile, "utf8");
      if (body.includes("CORRUPT")) {
        throw new Error("malformed session file");
      }
      return managerForFile(sessionFile);
    },
    create(_cwd, sessionDir) {
      const file = path.join(
        sessionDir ?? tmpdir(),
        `created-${++counter}.jsonl`,
      );
      writeFileSync(file, `${JSON.stringify({ type: "session", id: "s" })}\n`);
      return managerForFile(file);
    },
  };
}

function msg(role: "user" | "assistant", text: string): Message {
  return { role, content: text } as unknown as Message;
}

let sessionDir: string;
beforeEach(() => {
  sessionDir = mkdtempSync(path.join(tmpdir(), "pi-sessions-"));
});
afterEach(() => {
  // tmp dirs are left for the OS to reap; tests use unique dirs.
});

describe("sessionKey", () => {
  it("produces a filesystem-safe per-thread key", () => {
    expect(sessionKey("abc-123")).toBe("abc-123.jsonl");
    expect(sessionKey("a/b:c d")).toBe("a_b_c_d.jsonl");
    expect(sessionKey("")).toBe("thread.jsonl");
  });
});

describe("openDurableSession", () => {
  const base = (
    store: SessionStore,
    extra: Partial<Parameters<typeof openDurableSession>[0]> = {},
  ) => ({
    store,
    threadId: "thread-1",
    cwd: "/work",
    sessionDir,
    factories: makeFakeFactories(),
    ...extra,
  });

  it("creates and seeds a new session when none is stored (lazy migration)", async () => {
    const store = makeFakeStore();
    const durable = await openDurableSession(
      base(store, {
        seedHistory: [msg("user", "hi"), msg("assistant", "hello")],
      }),
    );
    expect(durable.resumed).toBe(false);

    const body = readFileSync(durable.sessionManager.getSessionFile()!, "utf8");
    expect(body).toContain("hi");
    expect(body).toContain("hello");

    await durable.persist();
    const stored = await store.read(sessionKey("thread-1"));
    expect(stored).not.toBeNull();
    expect(stored?.body).toContain("hello");
  });

  it("resumes a stored session without seeding history", async () => {
    const store = makeFakeStore({
      [sessionKey("thread-1")]:
        `${JSON.stringify({ type: "session", id: "s" })}\n${JSON.stringify({ type: "message", message: { role: "user", content: "prior" } })}\n`,
    });
    const durable = await openDurableSession(
      base(store, { seedHistory: [msg("user", "should be ignored")] }),
    );
    expect(durable.resumed).toBe(true);
    const body = readFileSync(durable.sessionManager.getSessionFile()!, "utf8");
    expect(body).toContain("prior");
    expect(body).not.toContain("should be ignored");
  });

  it("persists a resumed session with the held version (optimistic concurrency)", async () => {
    const store = makeFakeStore({
      [sessionKey("thread-1")]:
        `${JSON.stringify({ type: "session", id: "s" })}\n`,
    });
    const durable = await openDurableSession(base(store));
    durable.sessionManager.appendMessage(msg("assistant", "new turn"));
    await durable.persist();
    const stored = store.raw.get(sessionKey("thread-1"));
    expect(stored?.version).toBe(2);
    expect(stored?.body).toContain("new turn");
  });

  it("throws SessionConflictError when the stored session changed underneath the turn", async () => {
    const store = makeFakeStore({
      [sessionKey("thread-1")]:
        `${JSON.stringify({ type: "session", id: "s" })}\n`,
    });
    const durable = await openDurableSession(base(store));
    // A concurrent turn writes the same thread's session before we persist.
    store.raw.set(sessionKey("thread-1"), {
      body: "concurrent",
      version: 2,
    });
    await expect(durable.persist()).rejects.toBeInstanceOf(
      SessionConflictError,
    );
  });

  it("fails create when another writer created the thread session first", async () => {
    const store = makeFakeStore();
    const durable = await openDurableSession(base(store));
    store.raw.set(sessionKey("thread-1"), { body: "x", version: 1 });
    await expect(durable.persist()).rejects.toBeInstanceOf(
      SessionConflictError,
    );
  });

  it("rebuilds from history when a stored session opens to zero entries (SDK silent-fresh)", async () => {
    const logs: { level: string; event: string }[] = [];
    // Non-empty body whose lines do not parse to entries → fake open yields 0
    // entries (mirrors the real SDK skipping malformed lines and starting fresh).
    const store = makeFakeStore({
      [sessionKey("thread-1")]: "not-json-line\n",
    });
    const durable = await openDurableSession(
      base(store, {
        seedHistory: [msg("user", "recovered")],
        log: (e) => logs.push({ level: e.level, event: e.event }),
      }),
    );
    expect(durable.resumed).toBe(false);
    expect(logs).toContainEqual({
      level: "error",
      event: "durable_session_empty_rebuilding",
    });
    expect(
      readFileSync(durable.sessionManager.getSessionFile()!, "utf8"),
    ).toContain("recovered");
  });

  it("round-trips two turns: turn 1 seeds+persists, turn 2 resumes with prior content (AE2)", async () => {
    const store = makeFakeStore();
    // Turn 1: brand-new thread, seeds from history, runs, persists.
    const t1 = await openDurableSession(
      base(store, { seedHistory: [msg("user", "first question")] }),
    );
    expect(t1.resumed).toBe(false);
    t1.sessionManager.appendMessage(msg("assistant", "first answer"));
    await t1.persist();

    // Turn 2: same thread + store, resumes the persisted session.
    const t2 = await openDurableSession(base(store));
    expect(t2.resumed).toBe(true);
    const body = readFileSync(t2.sessionManager.getSessionFile()!, "utf8");
    expect(body).toContain("first question");
    expect(body).toContain("first answer");
    t2.sessionManager.appendMessage(msg("assistant", "second answer"));
    await t2.persist();
    expect(store.raw.get(sessionKey("thread-1"))?.version).toBe(2);
  });

  it("persist throws when the manager is not file-backed", async () => {
    const store = makeFakeStore();
    const durable = await openDurableSession(
      base(store, {
        factories: {
          open: () => ({
            getSessionFile: () => undefined,
            appendMessage: () => "e",
            getEntries: () => [],
          }),
          create: () => ({
            getSessionFile: () => undefined,
            appendMessage: () => "e",
            getEntries: () => [],
          }),
        },
      }),
    );
    await expect(durable.persist()).rejects.toThrow(/no session file/);
  });

  it("rebuilds from history on a corrupt stored session (never silent-empty)", async () => {
    const logs: { level: string; event: string }[] = [];
    const store = makeFakeStore({
      [sessionKey("thread-1")]: "CORRUPT garbage",
    });
    const durable = await openDurableSession(
      base(store, {
        seedHistory: [msg("user", "recovered context")],
        log: (e) => logs.push({ level: e.level, event: e.event }),
      }),
    );
    expect(durable.resumed).toBe(false);
    expect(logs).toContainEqual({
      level: "error",
      event: "durable_session_corrupt_rebuilding",
    });
    const body = readFileSync(durable.sessionManager.getSessionFile()!, "utf8");
    expect(body).toContain("recovered context");
    // Overwrite uses the held (corrupt) version, so it still succeeds (no
    // concurrent writer) rather than silently dropping context.
    await durable.persist();
    expect(store.raw.get(sessionKey("thread-1"))?.body).toContain(
      "recovered context",
    );
  });
});
