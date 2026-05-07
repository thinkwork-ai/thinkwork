import { describe, expect, it } from "vitest";
import { runAnchorPass } from "../compliance-anchor";

describe("compliance-anchor", () => {
  it("normalizes raw SQL timestamp strings before updating tenant anchor state", async () => {
    const recordedAt = "2026-05-07T22:10:00.123Z";
    const updates: Array<Record<string, unknown>> = [];
    let executeCalls = 0;

    const readerDb = {
      execute: async () => {
        executeCalls += 1;
        if (executeCalls === 1) {
          return {
            rows: [
              {
                tenant_id: "0015953e-aa13-4cab-8398-2e70f73dda63",
                event_id: "0196b0f2-0800-7000-8000-000000000001",
                event_hash:
                  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                recorded_at: recordedAt,
              },
            ],
          };
        }
        return { rows: [{ cnt: "1" }] };
      },
    };

    const drainerDb = {
      transaction: async (callback: (tx: unknown) => Promise<void>) => {
        await callback({
          insert: () => ({
            values: (value: Record<string, unknown>) => ({
              onConflictDoUpdate: async (input: {
                set: Record<string, unknown>;
              }) => {
                updates.push(value, input.set);
              },
            }),
          }),
        });
      },
    };

    const result = await runAnchorPass({
      readerDb: readerDb as never,
      drainerDb: drainerDb as never,
      cadenceId: "0196b0f2-0800-7000-8000-000000000002",
      anchorFn: () => ({ anchored: false }),
    });

    expect(result.tenant_count).toBe(1);
    expect(result.anchored_event_count).toBe(1);
    expect(updates).toHaveLength(2);
    expect(updates[0].last_anchored_recorded_at).toBeInstanceOf(Date);
    expect(updates[0].last_anchored_recorded_at).toEqual(new Date(recordedAt));
    expect(updates[1].last_anchored_recorded_at).toBeInstanceOf(Date);
    expect(updates[1].last_anchored_recorded_at).toEqual(new Date(recordedAt));
  });
});
