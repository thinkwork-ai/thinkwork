import { describe, expect, it, vi } from "vitest";

const { mockRequireThreadPinCaller, mockLoadPinnedThreads } = vi.hoisted(() => ({
  mockRequireThreadPinCaller: vi.fn(async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
  })),
  mockLoadPinnedThreads: vi.fn(async () => [
    {
      thread: { id: "thread-1", title: "Pinned" },
      pinnedAt: "2026-05-28T12:00:00.000Z",
      pinOrder: 1,
    },
  ]),
}));

vi.mock("./threadPins.shared.js", () => ({
  requireThreadPinCaller: mockRequireThreadPinCaller,
  loadPinnedThreads: mockLoadPinnedThreads,
}));

import { pinnedThreads } from "./pinnedThreads.query.js";

describe("pinnedThreads query", () => {
  it("loads server-backed pins for the authenticated caller", async () => {
    const result = await pinnedThreads(
      {},
      { tenantId: "tenant-1", limit: 20 },
      { auth: { authType: "cognito" } } as any,
    );

    expect(mockRequireThreadPinCaller).toHaveBeenCalledWith(
      { auth: { authType: "cognito" } },
      "tenant-1",
    );
    expect(mockLoadPinnedThreads).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      limit: 20,
    });
    expect(result).toEqual([
      {
        thread: { id: "thread-1", title: "Pinned" },
        pinnedAt: "2026-05-28T12:00:00.000Z",
        pinOrder: 1,
      },
    ]);
  });
});
