import { describe, it, expect } from "vitest";
import { shapeRow } from "./sandbox-invocation-log.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AGENT = "ffffffff-1111-2222-3333-444444444444";
const RUN = "cccccccc-dddd-eeee-ffff-000000000000";

function base(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tenant_id: TENANT,
    user_id: USER,
    environment_id: "default-public",
    ...overrides,
  };
}

describe("shapeRow — required fields", () => {
  it("rejects missing tenant_id", () => {
    const r = shapeRow({ ...base(), tenant_id: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tenant_id/);
  });

  it("rejects non-UUID tenant_id", () => {
    const r = shapeRow({ ...base(), tenant_id: "not-a-uuid" });
    expect(r.ok).toBe(false);
  });

  it("rejects missing user_id", () => {
    const r = shapeRow({ ...base(), user_id: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/user_id/);
  });

  it("rejects unknown environment_id", () => {
    const r = shapeRow({ ...base(), environment_id: "vpc-gated" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/environment_id/);
  });

  it("accepts both allowed environments", () => {
    expect(shapeRow(base({ environment_id: "default-public" })).ok).toBe(true);
    expect(shapeRow(base({ environment_id: "internal-only" })).ok).toBe(true);
  });
});

describe("shapeRow — enum validation", () => {
  it("rejects unknown exit_status", () => {
    const r = shapeRow(base({ exit_status: "panic" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exit_status/);
  });

  it("accepts every defined exit_status", () => {
    const values = [
      "ok",
      "error",
      "timeout",
      "oom",
      "cap_exceeded",
      "provisioning",
    ];
    for (const v of values) {
      expect(shapeRow(base({ exit_status: v })).ok).toBe(true);
    }
  });

  it("rejects the retired connection_revoked exit_status", () => {
    // Regression guard: the OAuth preamble path was retired
    // (docs/plans/2026-04-23-006). If it ever comes back, this
    // allowlist entry has to be a deliberate add, not a silent revert.
    const r = shapeRow(base({ exit_status: "connection_revoked" }));
    expect(r.ok).toBe(false);
  });

  it("rejects unknown invocation_source", () => {
    const r = shapeRow(base({ invocation_source: "cron" }));
    expect(r.ok).toBe(false);
  });

  it("accepts chat / scheduled / composition", () => {
    for (const v of ["chat", "scheduled", "composition"]) {
      expect(shapeRow(base({ invocation_source: v })).ok).toBe(true);
    }
  });
});

describe("shapeRow — optional UUID validation", () => {
  it("accepts omitted agent_id", () => {
    const r = shapeRow(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.agent_id).toBeNull();
  });

  it("accepts a valid agent_id UUID", () => {
    const r = shapeRow(base({ agent_id: AGENT }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.agent_id).toBe(AGENT);
  });

  it("rejects malformed agent_id", () => {
    const r = shapeRow(base({ agent_id: "agent-1" }));
    expect(r.ok).toBe(false);
  });

  it("accepts a valid run_id and passes it through", () => {
    const r = shapeRow(base({ run_id: RUN }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.run_id).toBe(RUN);
  });
});

describe("shapeRow — coercion and defaults", () => {
  it("coerces started_at from ISO string", () => {
    const r = shapeRow(base({ started_at: "2026-04-22T12:00:00Z" }));
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.started_at.toISOString()).toBe("2026-04-22T12:00:00.000Z");
  });

  it("defaults started_at to now when omitted", () => {
    const r = shapeRow(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.started_at).toBeInstanceOf(Date);
  });

  it("coerces truncation flags from truthy inputs", () => {
    const r = shapeRow(base({ stdout_truncated: true, stderr_truncated: 0 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stdout_truncated).toBe(true);
      expect(r.value.stderr_truncated).toBe(false);
    }
  });

  it("keeps integer byte counts + drops non-finite numbers", () => {
    const r = shapeRow(
      base({
        stdout_bytes: 42,
        stderr_bytes: Number.NaN,
        duration_ms: 1234,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stdout_bytes).toBe(42);
      expect(r.value.stderr_bytes).toBeNull();
      expect(r.value.duration_ms).toBe(1234);
    }
  });

  it("preserves executed_code_hash + failure_reason", () => {
    const r = shapeRow(
      base({
        executed_code_hash: "abc123",
        failure_reason: "timeout at step 3",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.executed_code_hash).toBe("abc123");
      expect(r.value.failure_reason).toBe("timeout at step 3");
    }
  });
});
