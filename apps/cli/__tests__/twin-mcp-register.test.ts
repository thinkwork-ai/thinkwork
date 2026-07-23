import { describe, it, expect } from "vitest";

import {
  registerTwinMcp,
  isActiveTwinRegistration,
  type TwinMcpClient,
} from "../src/lib/twin-mcp-register.js";

function client(overrides: Partial<TwinMcpClient> = {}): TwinMcpClient & {
  provisionCalls: number;
} {
  const c = {
    provisionCalls: 0,
    listServers: async () => [],
    provision: async () => {
      c.provisionCalls++;
      return { provisioned: "created" };
    },
    ...overrides,
  };
  if (overrides.provision) {
    const orig = overrides.provision;
    c.provision = async () => {
      c.provisionCalls++;
      return orig();
    };
  }
  return c;
}

describe("registerTwinMcp (KTD-4)", () => {
  it("AE4: existing active registration + no --rotate → no POST, adopted", async () => {
    const c = client({
      listServers: async () => [{ slug: "digital-twin", enabled: true }],
    });
    const out = await registerTwinMcp(c, { rotate: false });
    expect(out.state).toBe("found");
    expect(out.detail).toMatch(/adopted/);
    expect(c.provisionCalls).toBe(0);
  });

  it("no registration → POST issued once, created reported verbatim", async () => {
    const c = client();
    const out = await registerTwinMcp(c, { rotate: false });
    expect(out.state).toBe("created");
    expect(out.detail).toMatch(/created/);
    expect(c.provisionCalls).toBe(1);
  });

  it("--rotate → POST even when registration exists; rotated reported", async () => {
    const c = client({
      listServers: async () => [{ slug: "digital-twin", enabled: true }],
      provision: async () => ({ provisioned: "rotated" }),
    });
    const out = await registerTwinMcp(c, { rotate: true });
    expect(out.state).toBe("created");
    expect(out.detail).toMatch(/rotated/);
    expect(c.provisionCalls).toBe(1);
  });

  it("409 twin_not_deployed → failed with the deploy-first message; no retry", async () => {
    const c = client({
      provision: async () => {
        throw { status: 409, body: { error: "twin_not_deployed" } };
      },
    });
    const out = await registerTwinMcp(c, { rotate: false });
    expect(out.state).toBe("failed");
    expect(out.detail).toMatch(/NEPTUNE_ENDPOINT/);
    expect(c.provisionCalls).toBe(1);
  });

  it("a disabled digital-twin registration does not count as active", () => {
    expect(
      isActiveTwinRegistration({ slug: "digital-twin", enabled: false }),
    ).toBe(false);
    expect(
      isActiveTwinRegistration({ slug: "digital-twin", status: "disabled" }),
    ).toBe(false);
    expect(isActiveTwinRegistration({ slug: "digital-twin" })).toBe(true);
    expect(isActiveTwinRegistration({ slug: "other" })).toBe(false);
  });

  it("list failure fails the step without provisioning", async () => {
    const c = client({
      listServers: async () => {
        throw new Error("network down");
      },
    });
    const out = await registerTwinMcp(c, { rotate: false });
    expect(out.state).toBe("failed");
    expect(c.provisionCalls).toBe(0);
  });
});
