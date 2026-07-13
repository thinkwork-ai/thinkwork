import { describe, it, expect } from "vitest";

import type {
  CanonicalJson,
  OperationContract,
} from "@thinkwork/capability-contracts";

import {
  createPlatformAdapter,
  platformArtifactCreateInputSchema,
  PLATFORM_ARTIFACT_CREATE_OPERATION_ID,
  type PlatformArtifactInsert,
  type PlatformArtifactWriter,
} from "../lib/capability-broker/adapters/platform.js";
import type { AdapterDispatchContext } from "../lib/capability-broker/adapters/registry.js";

function artifactCreateContract(
  overrides: Partial<OperationContract> = {},
): OperationContract {
  return {
    operationId: PLATFORM_ARTIFACT_CREATE_OPERATION_ID,
    summary: "Create a platform artifact",
    effect: "create",
    targetScope: { kind: "closed", resourceSelector: { platform: "artifact" } },
    reversibility: "reversible",
    idempotency: "non_idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: platformArtifactCreateInputSchema(),
    outputSchema: { type: "object" },
    inputDataClass: "internal",
    outputDataClass: "internal",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "artifact",
    ...overrides,
  };
}

function ctx(
  contract: OperationContract,
  input: CanonicalJson,
  overrides: Partial<AdapterDispatchContext> = {},
): AdapterDispatchContext {
  return {
    tenantId: "tenant-1",
    operationRef:
      "twcap://platform/capability/artifact/versions/1/operations/artifact.create?contract=sha256:" +
      "b".repeat(64),
    contract,
    input,
    principal: { mode: "service", subjectId: "svc-broker" },
    credentialRefs: {},
    credentials: {},
    provenance: {
      routineExecutionId: "run-9",
      threadTurnId: "turn-9",
      brokerCallId: "call-9",
    },
    deadlineEpochMs: Date.now() + 10_000,
    ...overrides,
  };
}

function recordingWriter(): {
  writer: PlatformArtifactWriter;
  calls: PlatformArtifactInsert[];
} {
  const calls: PlatformArtifactInsert[] = [];
  const writer: PlatformArtifactWriter = {
    async create(input) {
      calls.push(input);
      return { id: "artifact-123" };
    },
  };
  return { writer, calls };
}

describe("platform adapter", () => {
  it("records tenant, service principal, operation ref, source run, and broker evidence ref", async () => {
    const { writer, calls } = recordingWriter();
    const adapter = createPlatformAdapter({ artifactWriter: writer });

    const out = await adapter.dispatch(
      ctx(artifactCreateContract(), {
        title: "Issue health digest",
        summary: "3 stale issues",
      }),
    );

    expect(out.status).toBe("completed");
    if (out.status === "completed") {
      // Durable, attributable identity — never an inline body.
      expect(out.data).toBeUndefined();
      expect(out.durable).toEqual({ kind: "artifact", ref: "artifact-123" });
    }

    expect(calls).toHaveLength(1);
    const rec = calls[0]!;
    expect(rec.tenantId).toBe("tenant-1");
    // Service principal → created_by_user_id NULL (system, not a user).
    expect(rec.createdByUserId).toBeNull();
    expect(rec.operationRef).toContain("artifact.create");
    expect(rec.routineExecutionId).toBe("run-9");
    expect(rec.threadTurnId).toBe("turn-9");
    expect(rec.brokerCallId).toBe("call-9");
    expect(rec.title).toBe("Issue health digest");
  });

  it("stamps the resolved user id for a user-bearing principal (never a service NULL)", async () => {
    const { writer, calls } = recordingWriter();
    const adapter = createPlatformAdapter({ artifactWriter: writer });
    await adapter.dispatch(
      ctx(
        artifactCreateContract(),
        { title: "t" },
        { principal: { mode: "requester", subjectId: "user-42" } },
      ),
    );
    expect(calls[0]!.createdByUserId).toBe("user-42");
  });

  it("rejects an operation that is not the registered platform operation", async () => {
    const { writer } = recordingWriter();
    const adapter = createPlatformAdapter({ artifactWriter: writer });
    const out = await adapter.dispatch(
      ctx(artifactCreateContract({ operationId: "database.query" }), {
        title: "t",
      }),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed")
      expect(out.category).toBe("unavailable_adapter");
  });

  it("rejects input that fails schema validation", async () => {
    const { writer, calls } = recordingWriter();
    const adapter = createPlatformAdapter({ artifactWriter: writer });
    const out = await adapter.dispatch(
      ctx(artifactCreateContract(), {
        notATitle: true,
      } as unknown as CanonicalJson),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("invalid_request");
    expect(calls).toHaveLength(0);
  });

  it("returns adapter_error when the insert throws (no partial side effect surfaced)", async () => {
    const adapter = createPlatformAdapter({
      artifactWriter: {
        async create() {
          throw new Error("db down");
        },
      },
    });
    const out = await adapter.dispatch(
      ctx(artifactCreateContract(), { title: "t" }),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("adapter_error");
  });
});
