import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const { mockDb, threadParticipants, captured, shared } = vi.hoisted(() => {
  const cap: {
    set: Record<string, unknown> | undefined;
    selectRows: Record<string, unknown>[];
  } = { set: undefined, selectRows: [] };
  const col = (name: string) => ({ __col: name });
  const db = {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        cap.set = values;
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => cap.selectRows),
        })),
      })),
    })),
  };
  return {
    mockDb: db,
    threadParticipants: {
      id: col("id"),
      notification_preference: col("notification_preference"),
    },
    captured: cap,
    shared: {
      requireThreadPinCaller: vi.fn(async () => ({
        tenantId: "tenant-1",
        userId: "user-1",
      })),
      loadVisibleThreadForPin: vi.fn(async () => ({
        id: "thread-1",
        space_id: "space-1",
        user_id: "user-1",
      })),
      ensureUserThreadParticipant: vi.fn(async () => "participant-1"),
    },
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: (field: unknown, value: unknown) => ({ __eq: { field, value } }),
  threadParticipants,
}));
vi.mock("./threadPins.shared.js", () => shared);
vi.mock("./types.js", () => ({
  threadParticipantToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    threadId: row.thread_id,
    notificationPreference:
      typeof row.notification_preference === "string"
        ? row.notification_preference.toUpperCase()
        : row.notification_preference,
  }),
}));

import { setThreadNotificationPreference } from "./setThreadNotificationPreference.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

describe("setThreadNotificationPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.set = undefined;
    captured.selectRows = [
      {
        id: "participant-1",
        thread_id: "thread-1",
        notification_preference: "muted",
      },
    ];
  });

  it("rejects an unknown preference with BAD_USER_INPUT before touching auth", async () => {
    await expect(
      setThreadNotificationPreference(
        null,
        { tenantId: "tenant-1", threadId: "thread-1", preference: "LOUD" },
        ctx,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    expect(shared.requireThreadPinCaller).not.toHaveBeenCalled();
  });

  it("writes the lowercased preference to the caller's participant row", async () => {
    const result = await setThreadNotificationPreference(
      null,
      { tenantId: "tenant-1", threadId: "thread-1", preference: "MUTED" },
      ctx,
    );

    expect(shared.requireThreadPinCaller).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(shared.loadVisibleThreadForPin).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callerUserId: "user-1",
      threadId: "thread-1",
    });
    expect(shared.ensureUserThreadParticipant).toHaveBeenCalled();
    expect(captured.set).toMatchObject({ notification_preference: "muted" });
    expect(captured.set?.updated_at).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      id: "participant-1",
      threadId: "thread-1",
      notificationPreference: "MUTED",
    });
  });

  it("surfaces a missing participant row as INTERNAL_SERVER_ERROR", async () => {
    captured.selectRows = [];
    await expect(
      setThreadNotificationPreference(
        null,
        { tenantId: "tenant-1", threadId: "thread-1", preference: "SUBSCRIBED" },
        ctx,
      ),
    ).rejects.toBeInstanceOf(GraphQLError);
  });
});
