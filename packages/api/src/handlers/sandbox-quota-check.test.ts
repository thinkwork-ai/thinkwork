import { describe, it, expect } from "vitest";
import { resolveCapsFromEnv } from "./sandbox-quota-check.js";

describe("resolveCapsFromEnv", () => {
  it("returns documented defaults when env has neither override", () => {
    expect(resolveCapsFromEnv({})).toEqual({
      tenantDailyCap: 500,
      agentHourlyCap: 20,
    });
  });

  it("honors SANDBOX_TENANT_DAILY_CAP override", () => {
    const caps = resolveCapsFromEnv({
      SANDBOX_TENANT_DAILY_CAP: "2000",
    });
    expect(caps.tenantDailyCap).toBe(2000);
  });

  it("honors SANDBOX_AGENT_HOURLY_CAP override", () => {
    const caps = resolveCapsFromEnv({
      SANDBOX_AGENT_HOURLY_CAP: "50",
    });
    expect(caps.agentHourlyCap).toBe(50);
  });

  it("treats cap=0 as a legitimate kill switch", () => {
    const caps = resolveCapsFromEnv({
      SANDBOX_TENANT_DAILY_CAP: "0",
      SANDBOX_AGENT_HOURLY_CAP: "0",
    });
    expect(caps).toEqual({ tenantDailyCap: 0, agentHourlyCap: 0 });
  });

  it("falls back to default when override is non-numeric", () => {
    expect(resolveCapsFromEnv({ SANDBOX_TENANT_DAILY_CAP: "bogus" })).toEqual({
      tenantDailyCap: 500,
      agentHourlyCap: 20,
    });
  });

  it("falls back to default on negative value (defensive)", () => {
    expect(resolveCapsFromEnv({ SANDBOX_TENANT_DAILY_CAP: "-1" })).toEqual({
      tenantDailyCap: 500,
      agentHourlyCap: 20,
    });
  });
});
