/**
 * THINK-909 — container-side runtime session verification.
 *
 * The dispatcher may present the v1 per-thread session id or the v2 per-user
 * id (per-stage `AGENTCORE_SESSION_SCOPE`), and during a rollout both are in
 * flight. The container must accept EITHER and 403 anything else. Both ids
 * bind tenant + agent + user, so dual-accept does not widen the tenant/user
 * boundary — only the thread component differs.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  acceptedRuntimeSessionIds,
  verifyRuntimeSessionHeader,
} from "../src/server.js";

const payload = {
  tenant_id: "tenant-1",
  assistant_id: "agent-1",
  user_id: "user-1",
  thread_id: "thread-1",
  message: "hello",
};

const v1 = createHash("sha256")
  .update("session:tenant-1:agent-1:user-1:thread-1")
  .digest("hex");
const v2 = createHash("sha256")
  .update("session:v2:tenant-1:agent-1:user-1")
  .digest("hex");

describe("acceptedRuntimeSessionIds", () => {
  it("derives the v1 per-thread and v2 per-user ids, in that order", () => {
    expect(
      acceptedRuntimeSessionIds({
        tenantId: "tenant-1",
        agentId: "agent-1",
        userId: "user-1",
        threadId: "thread-1",
      }),
    ).toEqual([v1, v2]);
  });
});

describe("verifyRuntimeSessionHeader (dual-accept)", () => {
  it("accepts the v1 per-thread session id", () => {
    expect(verifyRuntimeSessionHeader(v1, payload)).toBe("accept");
  });

  it("accepts the v2 per-user session id", () => {
    expect(verifyRuntimeSessionHeader(v2, payload)).toBe("accept");
  });

  it("accepts v2 for a DIFFERENT thread of the same user (the point of v2)", () => {
    expect(
      verifyRuntimeSessionHeader(v2, { ...payload, thread_id: "thread-9" }),
    ).toBe("accept");
  });

  it("rejects a garbage or foreign session id", () => {
    expect(verifyRuntimeSessionHeader("not-a-session-id", payload)).toBe(
      "reject",
    );
    expect(verifyRuntimeSessionHeader("f".repeat(64), payload)).toBe("reject");
    // Another user's v2 id must not ride this envelope.
    const otherUserV2 = createHash("sha256")
      .update("session:v2:tenant-1:agent-1:user-2")
      .digest("hex");
    expect(verifyRuntimeSessionHeader(otherUserV2, payload)).toBe("reject");
    // Another tenant's v1 id likewise.
    const otherTenantV1 = createHash("sha256")
      .update("session:tenant-2:agent-1:user-1:thread-1")
      .digest("hex");
    expect(verifyRuntimeSessionHeader(otherTenantV1, payload)).toBe("reject");
    // A v1 id for a different thread is still rejected: v1 stays per-thread.
    const otherThreadV1 = createHash("sha256")
      .update("session:tenant-1:agent-1:user-1:thread-9")
      .digest("hex");
    expect(verifyRuntimeSessionHeader(otherThreadV1, payload)).toBe("reject");
  });

  it("skips verification without a header (the Lambda path) or identity", () => {
    expect(verifyRuntimeSessionHeader(undefined, payload)).toBe("skip");
    expect(verifyRuntimeSessionHeader(v1, { ...payload, user_id: "" })).toBe(
      "skip",
    );
    expect(
      verifyRuntimeSessionHeader(v1, { ...payload, tenant_id: undefined }),
    ).toBe("skip");
  });
});
