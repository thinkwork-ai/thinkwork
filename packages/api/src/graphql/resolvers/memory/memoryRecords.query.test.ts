import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireTenantAdmin } from "../core/authz.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { memoryRecords } from "./memoryRecords.query.js";

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", () => ({
  requireMemoryUserScope: vi.fn(),
}));

const getMemoryServicesMock = vi.mocked(getMemoryServices);
const requireTenantAdminMock = vi.mocked(requireTenantAdmin);
const requireMemoryUserScopeMock = vi.mocked(requireMemoryUserScope);

describe("memoryRecords", () => {
  const inspectMock = vi.fn();
  const inspectTenantMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireTenantAdminMock.mockResolvedValue("admin");
    requireMemoryUserScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    inspectMock.mockResolvedValue([
      record({
        id: "requester-memory",
        ownerType: "user",
        ownerId: "user-1",
        text: "Requester memory",
        bankId: "user_user-1",
      }),
    ]);
    inspectTenantMock.mockResolvedValue([
      record({
        id: "user-memory",
        ownerType: "user",
        ownerId: "user-1",
        text: "User-bank memory",
        bankId: "user_user-1",
        createdAt: "2026-06-27T10:00:00.000Z",
      }),
      record({
        id: "space-memory",
        ownerType: "space",
        ownerId: "space-1",
        text: "Space-bank memory",
        bankId: "space_space-1",
        createdAt: "2026-06-27T11:00:00.000Z",
      }),
    ]);
    getMemoryServicesMock.mockReturnValue({
      inspect: {
        inspect: inspectMock,
        inspectTenant: inspectTenantMock,
      },
    } as any);
  });

  it("uses an admin-gated tenant inspection path for operator records", async () => {
    const rows = await memoryRecords(
      null,
      {
        tenantId: "tenant-1",
        namespace: "requester",
        scope: "OPERATOR",
        query: "bank",
        limit: 25,
      },
      { auth: {} } as any,
    );

    expect(requireTenantAdminMock).toHaveBeenCalledWith(
      { auth: {} },
      "tenant-1",
    );
    expect(requireMemoryUserScopeMock).not.toHaveBeenCalled();
    expect(inspectTenantMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      query: "bank",
      limit: 25,
    });
    expect(inspectMock).not.toHaveBeenCalled();
    expect(rows.map((row) => row.memoryRecordId)).toEqual([
      "space-memory",
      "user-memory",
    ]);
    expect(rows[0]).toMatchObject({
      bankId: "space_space-1",
      ownerType: "space",
      ownerId: "space-1",
      content: { text: "Space-bank memory" },
    });
  });

  it("keeps requester memory records on the existing user-scoped path", async () => {
    const rows = await memoryRecords(
      null,
      {
        tenantId: "tenant-1",
        userId: "user-2",
        namespace: "requester",
      },
      { auth: {} } as any,
    );

    expect(requireMemoryUserScopeMock).toHaveBeenCalledWith(
      { auth: {} },
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-2",
        allowTenantAdmin: true,
      }),
    );
    expect(requireTenantAdminMock).not.toHaveBeenCalled();
    expect(inspectMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-1",
    });
    expect(inspectTenantMock).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });
});

function record(args: {
  id: string;
  ownerType: "user" | "agent" | "space";
  ownerId: string;
  text: string;
  bankId: string;
  createdAt?: string;
}) {
  return {
    id: args.id,
    tenantId: "tenant-1",
    ownerType: args.ownerType,
    ownerId: args.ownerId,
    kind: "unit",
    sourceType: "thread_turn",
    status: "active",
    content: { text: args.text },
    backendRefs: [{ backend: "hindsight", ref: args.id }],
    createdAt: args.createdAt ?? "2026-06-27T09:00:00.000Z",
    metadata: {
      bankId: args.bankId,
      factType: "world",
    },
  };
}
