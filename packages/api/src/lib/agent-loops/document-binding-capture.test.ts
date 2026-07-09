import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  updateConditions: [] as unknown[],
  updateSet: [] as Record<string, unknown>[],
  updateReturning: [] as Record<string, unknown>[][],
}));

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => mocks.selectRows() }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updateSet.push(values);
        return {
          where: (condition: unknown) => {
            mocks.updateConditions.push(condition);
            return {
              returning: () =>
                Promise.resolve(mocks.updateReturning.shift() ?? []),
            };
          },
        };
      },
    }),
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agentLoops: {
    id: "agent_loops.id",
    tenant_id: "agent_loops.tenant_id",
    current_version_id: "agent_loops.current_version_id",
  },
  agentLoopVersions: {
    id: "agent_loop_versions.id",
    tenant_id: "agent_loop_versions.tenant_id",
    target_spec: "agent_loop_versions.target_spec",
  },
}));

// eslint-disable-next-line import/first
import { captureDocumentBindingArtifact } from "./document-binding-capture.js";

beforeEach(() => {
  mocks.selectRows.mockReset();
  mocks.updateConditions.length = 0;
  mocks.updateSet.length = 0;
  mocks.updateReturning.length = 0;
});

describe("captureDocumentBindingArtifact (THINK-227 U3)", () => {
  it("captures when the conditional update matches (first writer)", async () => {
    mocks.selectRows.mockResolvedValue([{ current_version_id: "v-1" }]);
    mocks.updateReturning.push([{ id: "v-1" }]);

    const result = await captureDocumentBindingArtifact({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      artifactId: "art-42",
    });
    expect(result).toEqual({ captured: true });
    expect(mocks.updateSet).toHaveLength(1);
    expect(mocks.updateConditions).toHaveLength(1);
  });

  it("reports not-captured when the guard filters the row out (already captured / existing mode)", async () => {
    mocks.selectRows.mockResolvedValue([{ current_version_id: "v-1" }]);
    mocks.updateReturning.push([]); // conditional WHERE matched nothing

    const result = await captureDocumentBindingArtifact({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      artifactId: "art-43",
    });
    expect(result).toEqual({ captured: false });
  });

  it("no-ops when the loop has no current version", async () => {
    mocks.selectRows.mockResolvedValue([]);
    const result = await captureDocumentBindingArtifact({
      tenantId: "tenant-1",
      agentLoopId: "loop-9",
      artifactId: "art-44",
    });
    expect(result).toEqual({ captured: false });
    expect(mocks.updateSet).toHaveLength(0);
  });
});
