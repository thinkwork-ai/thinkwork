/**
 * Personal-scope stage gating (THINK-193 U6): personal (user-scoped)
 * processors run acquire for personal-capable families only; shared-only
 * families are rejected visibly, and a personal-capable adapter receives
 * the user scope + the owner's User Bank target.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakePersonalAdapter = vi.hoisted(() => ({
  family: "email",
  partitionKey: "history",
  pathSegment: "email",
  requiresOwnerUser: true,
  supportsPersonalScope: true,
  checkReadiness: vi.fn(async () => ({ ready: true, client: { fake: true } })),
  runAcquire: vi.fn(async () => ({ ok: true, summary: { fetched: 1 } })),
  projectionKeyFor: (id: string) => `thread:${id}`,
  subjectKeyFor: (id: string) => `email:thread:${id}`,
  buildProjection: () => ({ title: "t", markdown: "m" }),
  extractClaims: () => [],
  editionEffectiveFrom: () => null,
  focusLabelFor: (_s: unknown, id: string) => id,
}));

const fakeSharedOnlyAdapter = vi.hoisted(() => ({
  ...fakePersonalAdapter,
  family: "twenty",
  supportsPersonalScope: false,
  checkReadiness: vi.fn(async () => ({ ready: true, client: {} })),
  runAcquire: vi.fn(async () => ({ ok: true, summary: {} })),
}));

vi.mock("./adapters/registry.js", () => ({
  getMemorySourceAdapter: (family: string) =>
    family === "email"
      ? fakePersonalAdapter
      : family === "twenty"
        ? fakeSharedOnlyAdapter
        : null,
}));
vi.mock("./policy.js", () => {
  class MemoryAuthorizationError extends Error {}
  return {
    requireActiveGrant: vi.fn(async () => ({
      id: "grant-1",
      grant_version: 1,
      boundary: { labels: ["INBOX"] },
    })),
    revalidateGrant: vi.fn(async () => undefined),
    assertBoundaryWithin: vi.fn(),
    MemoryAuthorizationError,
  };
});
vi.mock("../memory/index.js", () => ({ getMemoryServices: vi.fn() }));
vi.mock("../brain/dream/runner.js", () => ({ runBrainDreamState: vi.fn() }));
vi.mock("./adapters/twenty.js", () => ({ hindsightDocumentIdFor: vi.fn() }));
vi.mock("./adapters/twenty-adapter.js", () => ({
  backscanTokenFrom: vi.fn(),
  cursorFromCheckpoint: vi.fn(),
}));
vi.mock("./evidence.js", () => ({
  listEvidenceForProjection: vi.fn(async () => []),
  recordAcquiredPage: vi.fn(),
  recordDerivation: vi.fn(),
  recordDerivationWithRunItem: vi.fn(),
  recordRunItem: vi.fn(),
}));
vi.mock("./repository.js", () => ({
  resolveTargetBankId: (processor: {
    target_scope: string;
    target_id: string;
  }) => `${processor.target_scope}_${processor.target_id}`,
  getCheckpoint: vi.fn(),
  ensureCheckpoint: vi.fn(),
  advanceCheckpoint: vi.fn(),
  CheckpointConflictError: class extends Error {},
}));
vi.mock("./wiki/repository.js", () => ({}));

import { runAcquire, type StageContext } from "./stages.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const USER = "b7de6c4a-8f2e-45cf-a231-5a5f9a3f6c1a";

function buildCtx(options: {
  targetScope: "user" | "tenant";
  family: "email" | "twenty";
  createdByUserId?: string | null;
}): StageContext {
  return {
    db: {} as never,
    event: {
      workflowRunId: "run-1",
      tenantId: TENANT,
      stepId: "acquire",
      iteration: 0,
      stage: "acquire",
      processorConfigId: "proc-1",
      sourceConfigId: null,
      options: null,
    },
    processor: {
      id: "proc-1",
      tenant_id: TENANT,
      mode: options.targetScope === "user" ? "personal" : "shared",
      target_scope: options.targetScope,
      target_id: options.targetScope === "user" ? USER : TENANT,
      created_by_user_id:
        options.createdByUserId === undefined ? USER : options.createdByUserId,
      enabled: true,
      status: "active",
      budget: {},
    } as never,
    sources: [
      {
        id: "src-1",
        tenant_id: TENANT,
        processor_config_id: "proc-1",
        source_family: options.family,
        source_binding_key: "conn-1",
        enabled: true,
        boundary: { labels: ["INBOX"] },
        erase_generation: 0,
      } as never,
    ],
  };
}

describe("runAcquire personal-scope gating (U6)", () => {
  beforeEach(() => {
    fakePersonalAdapter.runAcquire.mockClear();
    fakeSharedOnlyAdapter.runAcquire.mockClear();
  });

  it("rejects a shared-only family on a user-scoped processor", async () => {
    const result = await runAcquire(
      buildCtx({ targetScope: "user", family: "twenty" }),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/writes shared banks only/);
    expect(fakeSharedOnlyAdapter.runAcquire).not.toHaveBeenCalled();
  });

  it("runs a personal-capable family on a user-scoped processor with the owner's User Bank target", async () => {
    const result = await runAcquire(
      buildCtx({ targetScope: "user", family: "email" }),
    );
    expect(result.status).toBe("succeeded");
    expect(fakePersonalAdapter.runAcquire).toHaveBeenCalledTimes(1);
    const args = (
      fakePersonalAdapter.runAcquire.mock.calls[0] as unknown as [
        { processor: { target_scope: string; target_id: string } },
      ]
    )[0];
    expect(args.processor.target_scope).toBe("user");
    expect(args.processor.target_id).toBe(USER);
  });

  it("still fails visibly when a requiresOwnerUser family has no owning user", async () => {
    const result = await runAcquire(
      buildCtx({ targetScope: "user", family: "email", createdByUserId: null }),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/no owning user/);
    expect(fakePersonalAdapter.runAcquire).not.toHaveBeenCalled();
  });

  it("shared processors keep running shared families", async () => {
    const result = await runAcquire(
      buildCtx({ targetScope: "tenant", family: "twenty" }),
    );
    expect(result.status).toBe("succeeded");
    expect(fakeSharedOnlyAdapter.runAcquire).toHaveBeenCalledTimes(1);
  });
});
