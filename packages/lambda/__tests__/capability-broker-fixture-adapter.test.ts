/**
 * Fixture capability adapter tests (THINK-280 U6 — AE7).
 *
 * The hermetic-validation adapter serves RECORDED broker results and makes
 * ZERO external calls — no network, no credential resolution. A global
 * `fetch` spy proves the adapter never reaches a provider.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFixtureAdapter,
  createFixtureAdapterRegistry,
  type RecordedBrokerFixture,
} from "../lib/capability-broker/adapters/fixture.js";
import type { AdapterDispatchContext } from "../lib/capability-broker/adapters/registry.js";

const FIXTURES: RecordedBrokerFixture[] = [
  {
    operationRef: "twcap://acme/connection/github/repos.get",
    input: { owner: "o", repo: "r" },
    result: { stars: 42, open_issues: 3 },
  },
];

function ctx(
  overrides: Partial<AdapterDispatchContext>,
): AdapterDispatchContext {
  return {
    tenantId: "t",
    operationRef: "twcap://acme/connection/github/repos.get",
    contract: { operationId: "repos.get" } as never,
    input: { owner: "o", repo: "r" },
    principal: { mode: "service", subjectId: "sp" },
    credentialRefs: {},
    credentials: {},
    provenance: {
      routineExecutionId: null,
      threadTurnId: null,
      brokerCallId: "c",
    },
    deadlineEpochMs: Date.now() + 1000,
    ...overrides,
  };
}

describe("fixture adapter (AE7)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it("serves a recorded result for a matching operation + input, with zero external calls", async () => {
    const adapter = createFixtureAdapter(FIXTURES);
    const outcome = await adapter.dispatch(ctx({}));
    expect(outcome).toEqual({
      status: "completed",
      data: { stars: 42, open_issues: 3 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(adapter.served).toEqual([
      "twcap://acme/connection/github/repos.get",
    ]);
  });

  it("fails closed for an operation with no recorded fixture (never falls through to a provider)", async () => {
    const adapter = createFixtureAdapter(FIXTURES);
    const outcome = await adapter.dispatch(
      ctx({ operationRef: "twcap://acme/connection/github/repos.delete" }),
    );
    expect(outcome.status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the input differs from the recorded call", async () => {
    const adapter = createFixtureAdapter(FIXTURES);
    const outcome = await adapter.dispatch(
      ctx({ input: { owner: "o", repo: "OTHER" } }),
    );
    expect(outcome.status).toBe("failed");
  });

  it("createFixtureAdapterRegistry exposes only the fixture adapter", async () => {
    const registry = createFixtureAdapterRegistry(FIXTURES);
    const adapter = registry.lookup("fixture" as never);
    expect(adapter).toBeDefined();
    expect(registry.lookup("http_openapi")).toBeUndefined();
    expect(registry.lookup("platform")).toBeUndefined();
  });
});
