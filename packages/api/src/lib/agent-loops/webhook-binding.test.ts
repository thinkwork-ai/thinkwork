import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let existing: unknown[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => existing }),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push(values);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => [] };
      },
    }),
  };
  return {
    db,
    inserts,
    updates,
    setExisting: (rows: unknown[]) => {
      existing = rows;
    },
  };
});

vi.mock("../../graphql/utils.js", () => ({ db: mocks.db, webhooks: {} }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));

const { syncAgentLoopWebhookBinding } = await import("./webhook-binding.js");

const base = {
  tenantId: "tenant-1",
  agentLoopId: "loop-1",
  name: "Twenty CRM",
  loopEnabled: true,
  actorId: "user-1",
};

describe("syncAgentLoopWebhookBinding", () => {
  beforeEach(() => {
    mocks.inserts.length = 0;
    mocks.updates.length = 0;
    mocks.setExisting([]);
  });

  it("mints a new webhook row for a webhook-trigger automation", async () => {
    await syncAgentLoopWebhookBinding({ ...base, triggerFamily: "webhook" });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      agent_loop_id: "loop-1",
      target_type: "automation",
      enabled: true,
      name: "Twenty CRM",
    });
    expect(typeof mocks.inserts[0].token).toBe("string");
    expect((mocks.inserts[0].token as string).length).toBeGreaterThan(20);
  });

  it("reuses the existing row (keeps the token) and mirrors enabled on re-save", async () => {
    mocks.setExisting([{ id: "hook-1", enabled: true }]);
    await syncAgentLoopWebhookBinding({
      ...base,
      triggerFamily: "webhook",
      loopEnabled: false,
    });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates[0]).toMatchObject({
      target_type: "automation",
      enabled: false,
      name: "Twenty CRM",
    });
    expect(mocks.updates[0]).not.toHaveProperty("token");
  });

  it("disables (not deletes) the row when the trigger family switches away from webhook", async () => {
    mocks.setExisting([{ id: "hook-1", enabled: true }]);
    await syncAgentLoopWebhookBinding({ ...base, triggerFamily: "schedule" });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    expect(mocks.updates[0]).not.toHaveProperty("token");
  });

  it("no-ops for a non-webhook automation that never had a webhook row", async () => {
    mocks.setExisting([]);
    await syncAgentLoopWebhookBinding({ ...base, triggerFamily: "schedule" });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });
});
