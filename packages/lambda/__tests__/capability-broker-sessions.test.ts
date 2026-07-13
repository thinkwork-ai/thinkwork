import { describe, it, expect } from "vitest";

import {
  createSession,
  loadSession,
  consumeSequence,
  recordNonce,
  requestCancellation,
  closeSession,
  _internals,
  type CreateSessionInput,
} from "../lib/capability-broker/sessions.js";
import { createFakeDynamo } from "./capability-broker-fakes.js";

const TABLE = "capability-broker-sessions-test";

function baseInput(
  overrides: Partial<CreateSessionInput> = {},
): CreateSessionInput {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    audience: "broker.example",
    publicKey: "cHVibGljS2V5",
    contextFingerprint: "fp-1",
    principalMode: "service",
    subjectId: "sp-1",
    grantSnapshot: { allowedEffects: ["read"] },
    budgets: { maxCalls: 5 },
    brokerSessionRowId: "row-1",
    createdEpochMs: 1_700_000_000_000,
    expiresEpochSeconds: 1_700_000_900,
    ...overrides,
  };
}

describe("capability-broker sessions store", () => {
  it("creates and loads a session round-trip with the TTL attribute set", async () => {
    const dynamo = createFakeDynamo();
    const created = await createSession(dynamo, TABLE, baseInput());
    expect(created.ok).toBe(true);

    const loaded = await loadSession(dynamo, TABLE, "sess-1");
    expect(loaded).not.toBeNull();
    expect(loaded).toMatchObject({
      sessionId: "sess-1",
      tenantId: "tenant-1",
      audience: "broker.example",
      publicKey: "cHVibGljS2V5",
      principalMode: "service",
      subjectId: "sp-1",
      nextSequence: 0,
      cancelled: false,
      status: "active",
      expiresEpochSeconds: 1_700_000_900,
    });
    expect(loaded!.grantSnapshot).toEqual({ allowedEffects: ["read"] });
    expect(loaded!.budgets).toEqual({ maxCalls: 5 });

    // The DynamoDB TTL attribute (`ttl`) carries the epoch-seconds expiry.
    const raw = dynamo.raw(_internals.sessionPk("sess-1"), _internals.META_SK);
    expect(raw?.[_internals.TTL_ATTR]).toBe(1_700_000_900);
  });

  it("rejects creating the same session id twice (never a widen path)", async () => {
    const dynamo = createFakeDynamo();
    expect((await createSession(dynamo, TABLE, baseInput())).ok).toBe(true);
    const again = await createSession(dynamo, TABLE, baseInput());
    expect(again).toEqual({ ok: false, conflict: true });
  });

  it("consumes a sequence exactly once — a reused sequence is a conflict", async () => {
    const dynamo = createFakeDynamo();
    await createSession(dynamo, TABLE, baseInput());

    const first = await consumeSequence(dynamo, TABLE, "sess-1", 0);
    expect(first).toEqual({ ok: true, nextSequence: 1 });

    // Replaying sequence 0 now fails: next sequence is 1.
    const replay = await consumeSequence(dynamo, TABLE, "sess-1", 0);
    expect(replay).toEqual({ ok: false, reason: "sequence_conflict" });

    // Out-of-order (skipping ahead) also fails.
    const skip = await consumeSequence(dynamo, TABLE, "sess-1", 5);
    expect(skip).toEqual({ ok: false, reason: "sequence_conflict" });

    // The correct next sequence succeeds.
    expect((await consumeSequence(dynamo, TABLE, "sess-1", 1)).ok).toBe(true);
  });

  it("concurrent sequence-0 requests produce exactly one consumed, one conflict", async () => {
    const dynamo = createFakeDynamo();
    await createSession(dynamo, TABLE, baseInput());

    const results = await Promise.all([
      consumeSequence(dynamo, TABLE, "sess-1", 0),
      consumeSequence(dynamo, TABLE, "sess-1", 0),
      consumeSequence(dynamo, TABLE, "sess-1", 0),
    ]);
    const consumed = results.filter((r) => r.ok);
    const conflicts = results.filter((r) => !r.ok);
    expect(consumed).toHaveLength(1);
    expect(conflicts).toHaveLength(2);

    const loaded = await loadSession(dynamo, TABLE, "sess-1");
    expect(loaded!.nextSequence).toBe(1);
  });

  it("rejects a reused nonce even with a fresh sequence", async () => {
    const dynamo = createFakeDynamo();
    await createSession(dynamo, TABLE, baseInput());

    const first = await recordNonce(
      dynamo,
      TABLE,
      "sess-1",
      "nonce-a",
      1_700_000_900,
    );
    expect(first).toEqual({ ok: true });

    const replay = await recordNonce(
      dynamo,
      TABLE,
      "sess-1",
      "nonce-a",
      1_700_000_900,
    );
    expect(replay).toEqual({ ok: false, reason: "replay_rejected" });

    // A different nonce is accepted.
    expect(
      (await recordNonce(dynamo, TABLE, "sess-1", "nonce-b", 1_700_000_900)).ok,
    ).toBe(true);

    // The nonce item carries the TTL attribute.
    const raw = dynamo.raw(
      _internals.sessionPk("sess-1"),
      _internals.nonceSk("nonce-a"),
    );
    expect(raw?.[_internals.TTL_ATTR]).toBe(1_700_000_900);
  });

  it("concurrent identical nonces resolve to exactly one accepted", async () => {
    const dynamo = createFakeDynamo();
    await createSession(dynamo, TABLE, baseInput());
    const results = await Promise.all([
      recordNonce(dynamo, TABLE, "sess-1", "n", 1_700_000_900),
      recordNonce(dynamo, TABLE, "sess-1", "n", 1_700_000_900),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("blocks sequence consumption once the session is cancelled", async () => {
    const dynamo = createFakeDynamo();
    await createSession(dynamo, TABLE, baseInput());

    const cancelled = await requestCancellation(dynamo, TABLE, "sess-1");
    expect(cancelled.ok).toBe(true);

    const loaded = await loadSession(dynamo, TABLE, "sess-1");
    expect(loaded!.cancelled).toBe(true);
    expect(loaded!.status).toBe("cancelled");

    const consume = await consumeSequence(dynamo, TABLE, "sess-1", 0);
    expect(consume).toEqual({ ok: false, reason: "sequence_conflict" });
  });

  it("blocks sequence consumption once the session is closed", async () => {
    const dynamo = createFakeDynamo();
    await createSession(dynamo, TABLE, baseInput());

    await closeSession(dynamo, TABLE, "sess-1", 1_700_000_500_000);
    const loaded = await loadSession(dynamo, TABLE, "sess-1");
    expect(loaded!.status).toBe("closed");

    const consume = await consumeSequence(dynamo, TABLE, "sess-1", 0);
    expect(consume).toEqual({ ok: false, reason: "sequence_conflict" });
  });

  it("returns null for an unknown (or TTL-expired) session", async () => {
    const dynamo = createFakeDynamo();
    expect(await loadSession(dynamo, TABLE, "nope")).toBeNull();
  });

  it("cancelling an unknown session reports notFound", async () => {
    const dynamo = createFakeDynamo();
    const res = await requestCancellation(dynamo, TABLE, "ghost");
    expect(res).toEqual({ ok: false, notFound: true });
  });
});
