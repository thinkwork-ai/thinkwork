/**
 * Gmail email-source adapter tests (THINK-193 U6).
 *
 * Pure pieces (quote stripping, address parsing, thread normalization, the
 * content-free skeleton) run unmocked; the acquisition loop runs against an
 * in-memory Gmail REST fake with mocked evidence/checkpoint/snapshot
 * modules. AE3 (unapproved label excluded + visibly reported) and the AE4
 * storage boundary (S3-first snapshot, content-free inline skeleton,
 * sensitivity tag) are asserted here at the adapter layer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../oauth-token.js", () => ({
  markConnectionExpired: vi.fn(),
  resolveConnectionForUserById: vi.fn(),
  resolveOAuthTokenDetails: vi.fn(),
}));
vi.mock("../evidence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../evidence.js")>()),
  recordAcquiredPage: vi.fn(),
  recordRunItem: vi.fn(),
}));
vi.mock("../repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repository.js")>()),
  ensureCheckpoint: vi.fn(),
  getCheckpoint: vi.fn(),
  advanceCheckpoint: vi.fn(),
}));
vi.mock("../erase-fence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../erase-fence.js")>()),
  assertSourceWritable: vi.fn(),
  rearmEraseCleanup: vi.fn(),
}));
vi.mock("../snapshots.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../snapshots.js")>()),
  putEvidenceSnapshot: vi.fn(),
  resolveSnapshotBucket: vi.fn(() => "test-bucket"),
  deleteEvidenceSnapshotVersion: vi.fn(),
  verifyNoSnapshotVersions: vi.fn(),
}));

import { recordAcquiredPage, recordRunItem } from "../evidence.js";
import { advanceCheckpoint, ensureCheckpoint } from "../repository.js";
import { putEvidenceSnapshot } from "../snapshots.js";
import type { EvidenceUpsert } from "../types.js";
import type { AdapterAcquireArgs } from "./registry.js";
import {
  buildEmailSkeleton,
  decodeBase64Url,
  emailEvidenceVersionFor,
  normalizeGmailThread,
  parseAddressList,
  runGmailAcquire,
  stripQuotedHistory,
  EMAIL_SENSITIVITY,
  type GmailClient,
  type NormalizedEmailThread,
} from "./gmail.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const USER = "b7de6c4a-8f2e-45cf-a231-5a5f9a3f6c1a";
const SOURCE = "9b1de2c4-1111-4222-8333-444455556666";

const SECRET_BODY = "Confidential: the Acme renewal is at risk.";
const SECRET_SUBJECT = "Acme renewal — private";

function b64url(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function rawMessage(args: {
  id: string;
  labelIds: string[];
  subject?: string;
  from?: string;
  to?: string;
  body?: string;
  internalDate?: string;
  attachments?: Array<{ filename: string; size: number }>;
}): Record<string, unknown> {
  return {
    id: args.id,
    threadId: "thread-1",
    labelIds: args.labelIds,
    internalDate: args.internalDate ?? "1767225600000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "Subject", value: args.subject ?? SECRET_SUBJECT },
        { name: "From", value: args.from ?? `Ada Lovelace <ada@example.com>` },
        {
          name: "To",
          value: args.to ?? "bob@example.com, Carol <carol@example.com>",
        },
      ],
      parts: [
        {
          mimeType: "text/plain",
          body: { data: b64url(args.body ?? SECRET_BODY) },
        },
        ...(args.attachments ?? []).map((attachment) => ({
          mimeType: "application/pdf",
          filename: attachment.filename,
          body: { size: attachment.size, attachmentId: "att-1" },
        })),
      ],
    },
  };
}

function rawThread(
  messages: Array<Record<string, unknown>>,
  threadId = "thread-1",
): Record<string, unknown> {
  return { id: threadId, historyId: "9000", messages };
}

// ---------------------------------------------------------------------------
// Pure normalization
// ---------------------------------------------------------------------------

describe("stripQuotedHistory", () => {
  it("drops quote lines and cuts at the attribution line", () => {
    const text = [
      "Thanks, sounds good.",
      "",
      "On Tue, Jul 7, 2026 at 9:00 AM Ada <ada@example.com> wrote:",
      "> earlier message",
      "> more quoted",
    ].join("\n");
    expect(stripQuotedHistory(text)).toBe("Thanks, sounds good.");
  });

  it("cuts at forwarded/original-message markers", () => {
    const text = "New content\n---- Original Message ----\nold stuff";
    expect(stripQuotedHistory(text)).toBe("New content");
  });

  it("drops interleaved quote lines", () => {
    const text = "> quoted\nreply line\n> quoted again\nsecond line";
    expect(stripQuotedHistory(text)).toBe("reply line\nsecond line");
  });
});

describe("parseAddressList / decodeBase64Url", () => {
  it("parses names, angle addresses, and bare addresses", () => {
    expect(
      parseAddressList("Ada Lovelace <ADA@Example.com>, bob@example.com"),
    ).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "bob@example.com" },
    ]);
  });

  it("returns [] for null/junk", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList("no-address-here")).toEqual([]);
  });

  it("decodes base64url", () => {
    expect(decodeBase64Url(b64url("hello ✓"))).toBe("hello ✓");
  });
});

describe("normalizeGmailThread", () => {
  it("keeps only messages carrying an effective label (AE3 boundary)", () => {
    const thread = rawThread([
      rawMessage({ id: "m1", labelIds: ["INBOX", "Label_work"] }),
      rawMessage({ id: "m2", labelIds: ["Label_private"] }),
    ]);
    const normalized = normalizeGmailThread(thread, ["Label_work"]);
    expect(normalized).not.toBeNull();
    expect(normalized!.messages.map((message) => message.id)).toEqual(["m1"]);
    // The kept message's labelIds are the INTERSECTION with the envelope.
    expect(normalized!.messages[0]!.labelIds).toEqual(["Label_work"]);
  });

  it("returns null when no message is inside the label envelope", () => {
    const thread = rawThread([
      rawMessage({ id: "m1", labelIds: ["Label_private"] }),
    ]);
    expect(normalizeGmailThread(thread, ["Label_work"])).toBeNull();
  });

  it("normalizes subject, participants, text, timestamps, and attachments as metadata only", () => {
    const thread = rawThread([
      rawMessage({
        id: "m1",
        labelIds: ["INBOX"],
        body: "Latest reply\n\nOn Mon someone wrote:\n> old quoted text",
        attachments: [{ filename: "contract.pdf", size: 1234 }],
      }),
    ]);
    const normalized = normalizeGmailThread(thread, ["INBOX"])!;
    expect(normalized.subject).toBe(SECRET_SUBJECT);
    expect(
      normalized.participants.map((participant) => participant.email),
    ).toEqual(["ada@example.com", "bob@example.com", "carol@example.com"]);
    const message = normalized.messages[0]!;
    expect(message.text).toBe("Latest reply");
    expect(message.from).toBe("ada@example.com");
    expect(message.sentAt).toBe(new Date(1767225600000).toISOString());
    expect(message.attachments).toEqual([
      {
        filename: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
      },
    ]);
    // Attachment CONTENT never survives normalization.
    expect(JSON.stringify(normalized)).not.toContain("attachmentId");
    expect(normalized.latestMessageAt).toBe(
      new Date(1767225600000).toISOString(),
    );
  });

  it("is deterministic and bounded for identical hostile input", () => {
    const thread = rawThread([
      rawMessage({
        id: "m1",
        labelIds: ["INBOX"],
        body: `# heading\n<script>alert(1)</script>\n${"x".repeat(10_000)}`,
      }),
    ]);
    const a = normalizeGmailThread(thread, ["INBOX"])!;
    const b = normalizeGmailThread(thread, ["INBOX"])!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.messages[0]!.text.length).toBeLessThanOrEqual(4000);
  });
});

describe("buildEmailSkeleton (AE4 content-free inline record)", () => {
  it("carries ids/labels/counts/hash — never subject, bodies, or addresses", () => {
    const thread = rawThread([
      rawMessage({ id: "m1", labelIds: ["INBOX"] }),
      rawMessage({ id: "m2", labelIds: ["INBOX"] }),
    ]);
    const normalized = normalizeGmailThread(thread, ["INBOX"])!;
    const skeleton = buildEmailSkeleton(normalized, "hash-abc");
    expect(skeleton).toMatchObject({
      contentFree: true,
      threadId: "thread-1",
      messageIds: ["m1", "m2"],
      labelIds: ["INBOX"],
      participantCount: 3,
      messageCount: 2,
      contentHash: "hash-abc",
    });
    const serialized = JSON.stringify(skeleton);
    expect(serialized).not.toContain(SECRET_SUBJECT);
    expect(serialized).not.toContain(SECRET_BODY);
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("Lovelace");
  });
});

describe("emailEvidenceVersionFor", () => {
  it("is content-hash based (unchanged content dedupes across historyIds)", () => {
    expect(emailEvidenceVersionFor("abcdef0123456789deadbeef")).toBe(
      "hash#abcdef012345",
    );
  });
});

// ---------------------------------------------------------------------------
// Acquisition orchestration
// ---------------------------------------------------------------------------

type FetchRoute = (url: URL) => { status: number; body: unknown } | null;

function fakeFetch(routes: FetchRoute[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    for (const route of routes) {
      const hit = route(url);
      if (hit) {
        return new Response(JSON.stringify(hit.body), { status: hit.status });
      }
    }
    return new Response(JSON.stringify({ error: "no route" }), {
      status: 500,
    });
  }) as typeof fetch;
}

function buildAcquireArgs(overrides: {
  fetchImpl: typeof fetch;
  labels?: string[];
  maxMessages?: number;
  onAuthFailure?: (reason: string) => Promise<void>;
  cursorHistoryId?: string | null;
}): {
  args: AdapterAcquireArgs;
  revalidateGrant: ReturnType<typeof vi.fn>;
} {
  const client: GmailClient = {
    provider: "gmail",
    tenantId: TENANT,
    connectionId: "conn-1",
    accessToken: "token",
    seedHistoryId: "1000",
    fetchImpl: overrides.fetchImpl,
    onAuthFailure: overrides.onAuthFailure,
  };
  const revalidateGrant = vi.fn(async () => undefined);
  const args: AdapterAcquireArgs = {
    db: {} as never,
    client,
    processor: {
      id: "proc-1",
      tenant_id: TENANT,
      mode: "personal",
      target_scope: "user",
      target_id: USER,
      created_by_user_id: USER,
      budget: {},
    } as never,
    source: {
      id: SOURCE,
      tenant_id: TENANT,
      source_family: "email",
      source_binding_key: "conn-1",
      erase_generation: 0,
    } as never,
    workflowRunId: "run-1",
    boundary: {
      labels: overrides.labels ?? ["INBOX"],
      ...(overrides.maxMessages ? { maxMessages: overrides.maxMessages } : {}),
    },
    budget: {},
    options: {},
    override: null,
    grantBoundary: { labels: overrides.labels ?? ["INBOX"] },
    revalidateGrant,
    eraseFence: { expectedEraseGeneration: 0 },
    counts: { changed: 0, seen: 0, pages: 0 },
  };
  vi.mocked(ensureCheckpoint).mockResolvedValue({
    id: "cp-1",
    tenant_id: TENANT,
    source_config_id: SOURCE,
    partition_key: "history",
    cursor: overrides.cursorHistoryId
      ? { historyId: overrides.cursorHistoryId }
      : {},
    version: 3,
  } as never);
  vi.mocked(advanceCheckpoint).mockImplementation(
    async (_db, a) =>
      ({
        id: "cp-1",
        cursor: a.cursor,
        version: a.expectedVersion + 1,
      }) as never,
  );
  vi.mocked(putEvidenceSnapshot).mockResolvedValue({
    ref: "s3://test-bucket/evidence-snapshots/x.json",
    expiresAt: new Date(),
    versionId: "v1",
  });
  vi.mocked(recordAcquiredPage).mockImplementation(async (_db, a) => ({
    changed: a.items as never,
    seen: 0,
    checkpoint: { version: 3, cursor: {} } as never,
  }));
  return { args, revalidateGrant };
}

const historyRoute =
  (threads: string[], historyId = "2000"): FetchRoute =>
  (url) =>
    url.pathname.endsWith("/history")
      ? {
          status: 200,
          body: {
            historyId,
            history: threads.map((threadId, index) => ({
              id: String(1500 + index),
              messages: [{ id: `hm-${index}`, threadId }],
            })),
          },
        }
      : null;

const threadRoute =
  (thread: Record<string, unknown>): FetchRoute =>
  (url) =>
    url.pathname.includes(`/threads/${thread.id as string}`)
      ? { status: 200, body: thread }
      : null;

describe("runGmailAcquire", () => {
  beforeEach(() => {
    vi.mocked(recordAcquiredPage).mockReset();
    vi.mocked(recordRunItem).mockReset();
    vi.mocked(ensureCheckpoint).mockReset();
    vi.mocked(advanceCheckpoint).mockReset();
    vi.mocked(putEvidenceSnapshot).mockReset();
  });

  it("an empty label set reads nothing (visible no-op, fail closed)", async () => {
    const { args } = buildAcquireArgs({ fetchImpl: fakeFetch([]), labels: [] });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(true);
    expect(
      (outcome as { summary: Record<string, unknown> }).summary.note,
    ).toMatch(/empty label set reads nothing/);
    expect(recordAcquiredPage).not.toHaveBeenCalled();
  });

  it("incremental history walk: S3-first snapshot, content-free skeleton, user-scoped evidence, cursor advance", async () => {
    const thread = rawThread([rawMessage({ id: "m1", labelIds: ["INBOX"] })]);
    const { args, revalidateGrant } = buildAcquireArgs({
      fetchImpl: fakeFetch([historyRoute(["thread-1"]), threadRoute(thread)]),
    });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(true);

    // Grant revalidated before EVERY provider read (history page + thread).
    expect(revalidateGrant.mock.calls.length).toBeGreaterThanOrEqual(2);

    // S3-first: the full snapshot went to the bucket…
    expect(putEvidenceSnapshot).toHaveBeenCalledTimes(1);
    const uploaded = vi.mocked(putEvidenceSnapshot).mock.calls[0]![1]
      .snapshot as NormalizedEmailThread;
    expect(uploaded.subject).toBe(SECRET_SUBJECT);

    // …and the committed evidence row is content-free inline.
    expect(recordAcquiredPage).toHaveBeenCalledTimes(1);
    const recorded = vi.mocked(recordAcquiredPage).mock.calls[0]![1];
    expect(recorded.skipCheckpointAdvance).toBe(true);
    const item = recorded.items[0] as EvidenceUpsert;
    expect(item.targetScope).toBe("user");
    expect(item.targetId).toBe(USER);
    expect(item.sensitivity).toBe(EMAIL_SENSITIVITY);
    expect(item.snapshotRef).toMatch(/^s3:\/\//);
    expect(item.normalizedSnapshot).toBeNull();
    expect(item.inlineSkeleton).toMatchObject({ contentFree: true });
    const inline = JSON.stringify(item.inlineSkeleton);
    expect(inline).not.toContain(SECRET_SUBJECT);
    expect(inline).not.toContain(SECRET_BODY);
    expect(inline).not.toContain("ada@example.com");
    expect(item.sourceVersion).toMatch(/^hash#/);

    // The durable cursor advanced to the settled page's history id.
    expect(advanceCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: { historyId: "2000" } }),
    );
  });

  it("AE3: a thread outside the approved labels is excluded AND visibly reported", async () => {
    const offScope = rawThread([
      rawMessage({ id: "m1", labelIds: ["Label_private"] }),
    ]);
    const { args } = buildAcquireArgs({
      fetchImpl: fakeFetch([historyRoute(["thread-1"]), threadRoute(offScope)]),
    });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(true);
    expect(recordAcquiredPage).not.toHaveBeenCalled();
    expect(putEvidenceSnapshot).not.toHaveBeenCalled();
    expect(recordRunItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceItemId: "thread-1",
        stage: "acquire",
        result: "noop",
        detail: expect.objectContaining({
          reason: expect.stringMatching(
            /no messages within the approved label set/,
          ),
        }),
      }),
    );
    expect(
      (outcome as { summary: Record<string, unknown> }).summary.excluded,
    ).toBe(1);
  });

  it("history 404 falls back to a bounded label resync with a visible run item and a fresh cursor", async () => {
    const thread = rawThread([rawMessage({ id: "m1", labelIds: ["INBOX"] })]);
    const routes: FetchRoute[] = [
      (url) =>
        url.pathname.endsWith("/history")
          ? { status: 404, body: { error: "expired" } }
          : null,
      (url) =>
        url.pathname.endsWith("/messages")
          ? {
              status: 200,
              body: { messages: [{ id: "m1", threadId: "thread-1" }] },
            }
          : null,
      threadRoute(thread),
      (url) =>
        url.pathname.endsWith("/profile")
          ? { status: 200, body: { historyId: "5000" } }
          : null,
    ];
    const { args } = buildAcquireArgs({ fetchImpl: fakeFetch(routes) });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(true);
    expect(
      (outcome as { summary: Record<string, unknown> }).summary.resync,
    ).toBe(true);
    expect(recordAcquiredPage).toHaveBeenCalledTimes(1);
    expect(advanceCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: { historyId: "5000" } }),
    );
    expect(recordRunItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceItemId: "resync:5000",
        result: "changed",
        detail: expect.objectContaining({
          reason: expect.stringMatching(/expired the history window/),
        }),
      }),
    );
  });

  it("a 401 marks the connection expired and fails the stage visibly", async () => {
    const onAuthFailure = vi.fn(async () => undefined);
    const { args } = buildAcquireArgs({
      fetchImpl: fakeFetch([
        (url) =>
          url.pathname.endsWith("/history")
            ? { status: 401, body: { error: "expired token" } }
            : null,
      ]),
      onAuthFailure,
    });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toMatch(/marked expired/);
    expect(onAuthFailure).toHaveBeenCalledWith("gmail_unauthorized");
    expect(advanceCheckpoint).not.toHaveBeenCalled();
  });

  it("budget exhaustion stops before unread threads and never advances the cursor", async () => {
    const thread1 = rawThread(
      [rawMessage({ id: "m1", labelIds: ["INBOX"] })],
      "thread-1",
    );
    const threadFetches: string[] = [];
    const routes: FetchRoute[] = [
      historyRoute(["thread-1", "thread-2"]),
      (url) => {
        const match = /\/threads\/([^/?]+)/.exec(url.pathname);
        if (!match) return null;
        threadFetches.push(match[1]!);
        return { status: 200, body: { ...thread1, id: match[1] } };
      },
    ];
    const { args } = buildAcquireArgs({
      fetchImpl: fakeFetch(routes),
      maxMessages: 1,
    });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(true);
    expect(threadFetches).toEqual(["thread-1"]);
    expect(
      (outcome as { summary: Record<string, unknown> }).summary.budgetExhausted,
    ).toBe(true);
    // Cursor untouched: the unread thread is re-seen next run.
    expect(advanceCheckpoint).not.toHaveBeenCalled();
  });

  it("provider errors (429) fail visibly without advancing anything", async () => {
    const { args } = buildAcquireArgs({
      fetchImpl: fakeFetch([
        (url) =>
          url.pathname.endsWith("/history")
            ? { status: 429, body: { error: "rate limited" } }
            : null,
      ]),
    });
    const outcome = await runGmailAcquire(args);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toMatch(/429/);
    expect(advanceCheckpoint).not.toHaveBeenCalled();
    expect(recordAcquiredPage).not.toHaveBeenCalled();
  });
});
