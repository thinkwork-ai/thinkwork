import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockRequireComputerReadAccess, mockListComputerEvents } =
  vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockRequireComputerReadAccess: vi.fn(),
    mockListComputerEvents: vi.fn(),
  }));

vi.mock("../../utils.js", () => ({
  db: {
    select: mockSelect,
  },
  computers: {
    id: "computers.id",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("./shared.js", () => ({
  requireComputerReadAccess: mockRequireComputerReadAccess,
}));

vi.mock("../../../lib/computers/events.js", () => ({
  listComputerEvents: mockListComputerEvents,
}));

let resolver: typeof import("./computerEvents.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireComputerReadAccess.mockReset();
  mockListComputerEvents.mockReset();

  mockSelect.mockReturnValue({
    from: () => ({
      where: () =>
        Promise.resolve([
          {
            id: "computer-1",
            tenant_id: "tenant-1",
            owner_user_id: "user-1",
          },
        ]),
    }),
  });
  mockListComputerEvents.mockResolvedValue([
    { id: "event-1", eventType: "computer_task_enqueued" },
  ]);

  resolver = await import("./computerEvents.query.js");
});

describe("computerEvents", () => {
  it("requires Computer read access before listing events", async () => {
    const ctx = { auth: { userId: "user-1" } } as any;

    const result = await resolver.computerEvents(
      null,
      { computerId: "computer-1", limit: 10 },
      ctx,
    );

    expect(mockRequireComputerReadAccess).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ id: "computer-1", tenant_id: "tenant-1" }),
    );
    expect(mockListComputerEvents).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      computerId: "computer-1",
      limit: 10,
    });
    expect(result).toEqual([
      { id: "event-1", eventType: "computer_task_enqueued" },
    ]);
  });

  it("returns not found when the Computer does not exist", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    });

    await expect(
      resolver.computerEvents(null, { computerId: "missing" }, {} as any),
    ).rejects.toThrow("Computer not found");

    expect(mockRequireComputerReadAccess).not.toHaveBeenCalled();
    expect(mockListComputerEvents).not.toHaveBeenCalled();
  });
});
