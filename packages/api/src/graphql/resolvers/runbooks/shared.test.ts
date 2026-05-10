import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockSelect, mockRequireComputerReadAccess } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockRequireComputerReadAccess: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: mockSelect,
  },
  computers: {
    tenant_id: "computers.tenant_id",
    id: "computers.id",
  },
  computerRunbookRuns: {
    tenant_id: "computer_runbook_runs.tenant_id",
    id: "computer_runbook_runs.id",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  and: vi.fn((...conditions: unknown[]) => conditions),
}));

vi.mock("../computers/shared.js", () => ({
  requireComputerReadAccess: mockRequireComputerReadAccess,
}));

let shared: typeof import("./shared.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireComputerReadAccess.mockReset();
  shared = await import("./shared.js");
});

describe("runbook resolver access helpers", () => {
  it("allows service-auth confirmation when the asserted principal owns the Computer", async () => {
    mockRunbookRunAccessRows({
      run: {
        id: "run-1",
        tenant_id: "tenant-1",
        computer_id: "computer-1",
      },
      computer: {
        id: "computer-1",
        tenant_id: "tenant-1",
        owner_user_id: "user-1",
      },
    });

    const ctx = {
      auth: {
        authType: "apikey",
        tenantId: "tenant-1",
        principalId: "user-1",
      },
    } as any;

    await expect(
      shared.requireRunbookRunAccess(ctx, "tenant-1", "run-1"),
    ).resolves.toEqual(
      expect.objectContaining({ id: "run-1", computer_id: "computer-1" }),
    );
    expect(mockRequireComputerReadAccess).not.toHaveBeenCalled();
  });

  it("keeps non-owner service-auth callers on the normal Computer access path", async () => {
    mockRunbookRunAccessRows({
      run: {
        id: "run-1",
        tenant_id: "tenant-1",
        computer_id: "computer-1",
      },
      computer: {
        id: "computer-1",
        tenant_id: "tenant-1",
        owner_user_id: "user-1",
      },
    });
    mockRequireComputerReadAccess.mockRejectedValue(
      new Error("Tenant membership required"),
    );

    const ctx = {
      auth: {
        authType: "apikey",
        tenantId: "tenant-1",
        principalId: "user-2",
      },
    } as any;

    await expect(
      shared.requireRunbookRunAccess(ctx, "tenant-1", "run-1"),
    ).rejects.toThrow("Tenant membership required");
    expect(mockRequireComputerReadAccess).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ owner_user_id: "user-1" }),
    );
  });
});

function mockRunbookRunAccessRows(input: { run: unknown; computer: unknown }) {
  mockSelect
    .mockReturnValueOnce(selectRows([input.run]))
    .mockReturnValueOnce(selectRows([input.computer]));
}

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}
