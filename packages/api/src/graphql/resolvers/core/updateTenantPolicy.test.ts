import { describe, it, expect } from "vitest";
import { computeTransition } from "./updateTenantPolicy.mutation.js";

const ACTOR = "00000000-0000-0000-0000-aaaaaaaaaaaa";

describe("computeTransition — no-op cases", () => {
  it("returns no events when nothing changes", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: true,
      currentComplianceTier: "standard",
      requested: { sandboxEnabled: true, complianceTier: "standard" },
      actorUserId: ACTOR,
    });
    expect(events).toHaveLength(0);
    expect(next.sandbox_enabled).toBe(true);
  });

  it("returns no events when inputs are absent", () => {
    const { events } = computeTransition({
      currentSandboxEnabled: false,
      currentComplianceTier: "standard",
      requested: {},
      actorUserId: ACTOR,
    });
    expect(events).toHaveLength(0);
  });
});

describe("computeTransition — sandbox_enabled toggle", () => {
  it("flips false -> true on a standard tenant", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: false,
      currentComplianceTier: "standard",
      requested: { sandboxEnabled: true },
      actorUserId: ACTOR,
    });
    expect(next.sandbox_enabled).toBe(true);
    expect(events).toEqual([
      {
        event_type: "sandbox_enabled",
        before_value: "false",
        after_value: "true",
      },
    ]);
  });

  it("rejects enabling sandbox on a regulated tenant", () => {
    expect(() =>
      computeTransition({
        currentSandboxEnabled: false,
        currentComplianceTier: "regulated",
        requested: { sandboxEnabled: true },
        actorUserId: ACTOR,
      }),
    ).toThrow(/Cannot enable sandbox while compliance_tier is 'regulated'/);
  });

  it("rejects enabling sandbox on an hipaa tenant", () => {
    expect(() =>
      computeTransition({
        currentSandboxEnabled: false,
        currentComplianceTier: "hipaa",
        requested: { sandboxEnabled: true },
        actorUserId: ACTOR,
      }),
    ).toThrow(/'hipaa'/);
  });

  it("allows disabling sandbox unconditionally", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: true,
      currentComplianceTier: "standard",
      requested: { sandboxEnabled: false },
      actorUserId: ACTOR,
    });
    expect(next.sandbox_enabled).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].after_value).toBe("false");
  });
});

describe("computeTransition — compliance_tier changes", () => {
  it("changes standard -> regulated and coerces sandbox_enabled off", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: true,
      currentComplianceTier: "standard",
      requested: { complianceTier: "regulated" },
      actorUserId: ACTOR,
    });
    expect(next.compliance_tier).toBe("regulated");
    expect(next.sandbox_enabled).toBe(false);
    expect(events).toEqual([
      {
        event_type: "compliance_tier",
        before_value: "standard",
        after_value: "regulated",
      },
      {
        event_type: "sandbox_enabled",
        before_value: "true",
        after_value: "false",
      },
    ]);
  });

  it("changes standard -> hipaa on a sandbox-off tenant without adding a sandbox event", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: false,
      currentComplianceTier: "standard",
      requested: { complianceTier: "hipaa" },
      actorUserId: ACTOR,
    });
    expect(next.compliance_tier).toBe("hipaa");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("compliance_tier");
  });

  it("changes regulated -> standard without touching sandbox_enabled", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: false,
      currentComplianceTier: "regulated",
      requested: { complianceTier: "standard" },
      actorUserId: ACTOR,
    });
    expect(next.compliance_tier).toBe("standard");
    expect(next.sandbox_enabled).toBe(false);
    expect(events).toHaveLength(1);
  });
});

describe("computeTransition — composite requests", () => {
  it("applies tier first then sandbox — both-on-hipaa is rejected", () => {
    // The user tried to enable sandbox AND set tier to hipaa in the same call.
    // The invariant must win regardless of ordering.
    expect(() =>
      computeTransition({
        currentSandboxEnabled: false,
        currentComplianceTier: "standard",
        requested: { sandboxEnabled: true, complianceTier: "hipaa" },
        actorUserId: ACTOR,
      }),
    ).toThrow(/Cannot enable sandbox while compliance_tier is 'hipaa'/);
  });

  it("tier -> standard + sandbox -> true together succeeds", () => {
    const { events, next } = computeTransition({
      currentSandboxEnabled: false,
      currentComplianceTier: "regulated",
      requested: { sandboxEnabled: true, complianceTier: "standard" },
      actorUserId: ACTOR,
    });
    expect(next.compliance_tier).toBe("standard");
    expect(next.sandbox_enabled).toBe(true);
    expect(events.map((e) => e.event_type)).toEqual([
      "compliance_tier",
      "sandbox_enabled",
    ]);
  });
});
