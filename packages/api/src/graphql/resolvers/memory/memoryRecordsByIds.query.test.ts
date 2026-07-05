import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryServices } from "../../../lib/memory/index.js";
import {
  requireMemoryUserScope,
  UserScopeAuthError,
} from "../core/require-user-scope.js";
import { memoryRecordsByIds } from "./memoryRecordsByIds.query.js";

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", async () => {
  const actual = await vi.importActual<
    typeof import("../core/require-user-scope.js")
  >("../core/require-user-scope.js");
  return {
    ...actual,
    requireMemoryUserScope: vi.fn(),
  };
});

const getMemoryServicesMock = vi.mocked(getMemoryServices);
const requireMemoryUserScopeMock = vi.mocked(requireMemoryUserScope);

describe("memoryRecordsByIds", () => {
  const inspectMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireMemoryUserScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    inspectMock.mockResolvedValue([
      record({
        id: "owned-newer",
        ownerId: "user-1",
        text: "Newer owned memory",
        createdAt: "2026-06-27T11:00:00.000Z",
      }),
      record({
        id: "owned-older",
        ownerId: "user-1",
        text: "Older owned memory",
        createdAt: "2026-06-27T10:00:00.000Z",
      }),
    ]);
    getMemoryServicesMock.mockReturnValue({
      inspect: {
        inspect: inspectMock,
      },
    } as any);
  });

  it("returns owned requested ids from the inspected set", async () => {
    const rows = await memoryRecordsByIds(
      null,
      { tenantId: "tenant-1", ids: ["owned-older", "owned-newer"] },
      { auth: {} } as any,
    );

    expect(requireMemoryUserScopeMock).toHaveBeenCalledWith(
      { auth: {} },
      {
        tenantId: "tenant-1",
        allowTenantAdmin: true,
      },
    );
    expect(inspectMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-1",
    });
    expect(rows.map((row) => row.memoryRecordId)).toEqual([
      "owned-newer",
      "owned-older",
    ]);
    expect(rows[0]).toMatchObject({
      memoryRecordId: "owned-newer",
      content: { text: "Newer owned memory" },
      ownerType: "user",
      ownerId: "user-1",
      factType: "world",
      namespace: "user_user-1",
    });
  });

  it("silently omits requested ids absent from the inspected set", async () => {
    const rows = await memoryRecordsByIds(
      null,
      {
        tenantId: "tenant-1",
        ids: ["owned-older", "purged-id", "other-user-id"],
      },
      { auth: {} } as any,
    );

    expect(rows.map((row) => row.memoryRecordId)).toEqual(["owned-older"]);
  });

  it("returns an empty list without fetching for empty ids", async () => {
    const rows = await memoryRecordsByIds(
      null,
      { tenantId: "tenant-1", ids: [] },
      { auth: {} } as any,
    );

    expect(rows).toEqual([]);
    expect(requireMemoryUserScopeMock).not.toHaveBeenCalled();
    expect(getMemoryServicesMock).not.toHaveBeenCalled();
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("returns an empty list for tenant mismatch scope failures", async () => {
    requireMemoryUserScopeMock.mockRejectedValue(
      new UserScopeAuthError("Access denied: tenant mismatch"),
    );

    await expect(
      memoryRecordsByIds(null, { tenantId: "tenant-2", ids: ["owned-older"] }, {
        auth: {},
      } as any),
    ).resolves.toEqual([]);
    expect(getMemoryServicesMock).not.toHaveBeenCalled();
    expect(inspectMock).not.toHaveBeenCalled();
  });
});

function record(args: {
  id: string;
  ownerId: string;
  text: string;
  createdAt: string;
}) {
  return {
    id: args.id,
    tenantId: "tenant-1",
    ownerType: "user",
    ownerId: args.ownerId,
    kind: "unit",
    sourceType: "thread_turn",
    status: "active",
    content: { text: args.text },
    backendRefs: [{ backend: "hindsight", ref: args.id }],
    createdAt: args.createdAt,
    metadata: {
      bankId: `user_${args.ownerId}`,
      factType: "world",
    },
  };
}
