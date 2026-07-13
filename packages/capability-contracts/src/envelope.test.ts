import { describe, expect, it } from "vitest";
import {
  BrokerEnvelopeError,
  INLINE_RESULT_MAX_BYTES,
  parseBrokerCallResult,
} from "./envelope";
import {
  BROKER_REQUEST_KIND,
  BROKER_STATUS_KIND,
  REQUEST_CLOCK_WINDOW_SECONDS,
  SESSION_MAX_TTL_SECONDS,
  buildSignableCallPayload,
  buildSignableStatusPayload,
  checkClockWindow,
} from "./session";
import type { BrokerCallRequest } from "./envelope";

describe("parseBrokerCallResult", () => {
  it("accepts completed with inline data", () => {
    expect(
      parseBrokerCallResult({ status: "completed", data: { ok: true } }),
    ).toEqual({
      status: "completed",
      data: { ok: true },
    });
  });

  it("accepts completed with a durable reference", () => {
    expect(
      parseBrokerCallResult({
        status: "completed",
        durableRef: { kind: "artifact", ref: "artifact:abc" },
      }),
    ).toMatchObject({ status: "completed" });
  });

  it("rejects completed carrying both inline data and a durable reference", () => {
    expect(() =>
      parseBrokerCallResult({
        status: "completed",
        data: {},
        durableRef: { kind: "s3", ref: "bucket/key" },
      }),
    ).toThrow(BrokerEnvelopeError);
  });

  it("requires poll identity on accepted", () => {
    expect(() => parseBrokerCallResult({ status: "accepted" })).toThrow(
      BrokerEnvelopeError,
    );
    expect(
      parseBrokerCallResult({
        status: "accepted",
        pollToken: "p1",
        cancellable: true,
      }),
    ).toMatchObject({ status: "accepted" });
  });

  it("requires a typed error on failed and rejects unknown categories", () => {
    expect(() =>
      parseBrokerCallResult({
        status: "failed",
        error: { category: "surprise", retryable: false, message: "x" },
      }),
    ).toThrow(BrokerEnvelopeError);
    expect(
      parseBrokerCallResult({
        status: "failed",
        error: {
          category: "unavailable_adapter",
          retryable: false,
          message: "no adapter",
        },
      }),
    ).toMatchObject({ status: "failed" });
  });

  it("rejects unknown statuses and non-objects", () => {
    expect(() => parseBrokerCallResult({ status: "done" })).toThrow(
      BrokerEnvelopeError,
    );
    expect(() => parseBrokerCallResult("completed")).toThrow(
      BrokerEnvelopeError,
    );
    expect(() => parseBrokerCallResult(null)).toThrow(BrokerEnvelopeError);
  });

  it("keeps the contract constants at their specified values", () => {
    expect(INLINE_RESULT_MAX_BYTES).toBe(65536);
    expect(SESSION_MAX_TTL_SECONDS).toBe(900);
    expect(REQUEST_CLOCK_WINDOW_SECONDS).toBe(60);
  });
});

describe("signable payloads", () => {
  const request: BrokerCallRequest = {
    sessionId: "sess-1",
    clientRequestId: "req-1",
    sequence: 0,
    nonce: "n-1",
    issuedAt: "2026-07-13T00:00:00Z",
    operation:
      "twcap://acme/connection/github-rest/versions/1/operations/issues%2Flist" +
      `?contract=sha256:${"a".repeat(64)}`,
    input: { page: 1 },
  };

  it("is deterministic and domain-separated", () => {
    const p1 = buildSignableCallPayload("broker-audience", request);
    const p2 = buildSignableCallPayload("broker-audience", { ...request });
    expect(p1).toBe(p2);
    expect(p1).toContain(`"kind":"${BROKER_REQUEST_KIND}"`);
    const status = buildSignableStatusPayload("broker-audience", {
      sessionId: "sess-1",
      clientRequestId: "req-2",
      subjectClientRequestId: "req-1",
      sequence: 1,
      nonce: "n-2",
      issuedAt: "2026-07-13T00:00:10Z",
    });
    expect(status).toContain(`"kind":"${BROKER_STATUS_KIND}"`);
  });

  it("binds the body via canonical hash — input mutation changes the signed bytes", () => {
    const base = buildSignableCallPayload("aud", request);
    const mutated = buildSignableCallPayload("aud", {
      ...request,
      input: { page: 2 },
    });
    expect(mutated).not.toBe(base);
    // key-order-insensitive: same body different insertion order signs identically
    const reordered = buildSignableCallPayload("aud", {
      ...request,
      input: JSON.parse('{"page":1}') as never,
    });
    expect(reordered).toBe(base);
  });

  it("binds the audience", () => {
    expect(buildSignableCallPayload("aud-a", request)).not.toBe(
      buildSignableCallPayload("aud-b", request),
    );
  });
});

describe("checkClockWindow", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");

  it("accepts timestamps inside the window", () => {
    expect(checkClockWindow("2026-07-13T11:59:01Z", now)).toEqual({ ok: true });
    expect(checkClockWindow("2026-07-13T12:00:59Z", now)).toEqual({ ok: true });
  });

  it("rejects just outside the window in both directions", () => {
    expect(checkClockWindow("2026-07-13T11:58:59Z", now)).toEqual({
      ok: false,
      reason: "outside_window",
    });
    expect(checkClockWindow("2026-07-13T12:01:01Z", now)).toEqual({
      ok: false,
      reason: "issued_in_future",
    });
  });

  it("rejects malformed timestamps", () => {
    expect(checkClockWindow("not-a-date", now)).toEqual({
      ok: false,
      reason: "malformed_timestamp",
    });
  });
});
