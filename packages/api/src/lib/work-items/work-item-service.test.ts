import { describe, expect, it, vi } from "vitest";

import { parseAwsJson, updateWorkItem } from "./work-item-service.js";

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

describe("work-item-service", () => {
  it("clears blocked when a general update moves an item out of a blocked status", async () => {
    const now = new Date("2026-06-24T12:00:00.000Z");
    const current = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      status_id: "status-blocked",
      title: "Waiting on customer",
      blocked: true,
      completed_at: null,
      completed_by_user_id: null,
      completed_by_agent_id: null,
    };
    const nextStatus = {
      id: "status-active",
      tenant_id: "tenant-1",
      space_id: "space-1",
      name: "In Progress",
      category: "active",
      is_final: false,
    };
    const capturedSets: Record<string, unknown>[] = [];
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectRows([current]))
        .mockReturnValueOnce(selectRows([nextStatus])),
      update: vi.fn(() => ({
        set: (value: Record<string, unknown>) => {
          capturedSets.push(value);
          return {
            where: () => ({
              returning: async () => [
                {
                  ...current,
                  ...value,
                  status_id: "status-active",
                },
              ],
            }),
          };
        },
      })),
      insert: vi.fn(() => ({
        values: vi.fn(async () => undefined),
      })),
    };

    await updateWorkItem(
      {
        tenantId: "tenant-1",
        id: "work-item-1",
        statusId: "status-active",
      },
      {
        db: {
          transaction: async (callback: (innerTx: typeof tx) => unknown) =>
            callback(tx),
        },
        now: () => now,
      },
    );

    expect(capturedSets[0]).toMatchObject({
      status_id: "status-active",
      blocked: false,
      completed_at: null,
      updated_at: now,
    });
  });

  it("wraps invalid JSON strings in a work-item validation error", () => {
    expect(() => parseAwsJson("{not json")).toThrow(
      "JSON payload must be valid JSON",
    );
  });
});
