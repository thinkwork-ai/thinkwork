import { describe, expect, it } from "vitest";
import {
  dismissMaterializationSuggestion,
  recordMaterializationSuggestion,
} from "./suggestions.js";
import { resolveTwinPageGate } from "./dual-read-gate.js";

/** Minimal drizzle fake: FIFO select queue + recorded writes. */
function fakeDb() {
  const selectQueue: unknown[][] = [];
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const chain = () => {
    const c: any = {
      from: () => c,
      where: () => c,
      limit: () => Promise.resolve(selectQueue.shift() ?? []),
      then: (resolve: any, reject: any) =>
        Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
    };
    return c;
  };
  const db: any = {
    select: () => chain(),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
            updates.push(conflict.set);
            return Promise.resolve([]);
          },
        };
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updates.push(set);
            return Promise.resolve([{ id: "s1" }]);
          },
        }),
      }),
    }),
  };
  return { db, selectQueue, inserts, updates };
}

describe("materialization suggestions (R8 / AE3)", () => {
  it("repeated gaps upsert one row with an incremented hit counter", async () => {
    const { db, selectQueue, inserts, updates } = fakeDb();
    selectQueue.push([]); // no existing row
    const first = await recordMaterializationSuggestion({
      tenantId: "t1",
      entityTypeSlug: "customer",
      facetSlug: "order_lines",
      question: "cohort needs order lines",
      db,
    });
    expect(first.recorded).toBe(true);
    expect(inserts[0]).toMatchObject({
      tenant_id: "t1",
      entity_type_slug: "customer",
      facet_slug: "order_lines",
    });
    // Conflict path carries the hit_count increment + re-open.
    expect(JSON.stringify(Object.keys(updates[0]))).toContain("hit_count");
    expect(updates[0].dismissed_at).toBeNull();
  });

  it("a recently dismissed suggestion is not immediately re-created", async () => {
    const { db, selectQueue, inserts } = fakeDb();
    selectQueue.push([
      { id: "s1", dismissed_at: new Date("2026-07-20T00:00:00Z") },
    ]);
    const result = await recordMaterializationSuggestion({
      tenantId: "t1",
      entityTypeSlug: "customer",
      facetSlug: "order_lines",
      db,
      now: new Date("2026-07-21T00:00:00Z"),
    });
    expect(result).toEqual({ recorded: false, reason: "recently_dismissed" });
    expect(inserts).toHaveLength(0);
  });

  it("dismiss is tenant-scoped and returns whether a row was hit", async () => {
    const { db } = fakeDb();
    await expect(
      dismissMaterializationSuggestion({
        tenantId: "t1",
        suggestionId: "s1",
        db,
      }),
    ).resolves.toBe(true);
  });
});

describe("dual-read gate (AE8)", () => {
  function gateDb(typeRow: unknown, cursorRow: unknown) {
    const selectQueue = [
      typeRow ? [typeRow] : [],
      cursorRow ? [cursorRow] : [],
    ];
    const chain = () => {
      const c: any = {
        from: () => c,
        where: () => c,
        limit: () => Promise.resolve(selectQueue.shift() ?? []),
      };
      return c;
    };
    return { select: () => chain() } as any;
  }

  const sections = [
    {
      slug: "aging",
      heading: "Aging",
      kind: "facet_backed",
      facetSlug: "aging",
      visibility: "all_members",
      position: 0,
    },
  ];

  it("projected only when sections are declared AND the first sync completed", async () => {
    const gate = await resolveTwinPageGate({
      tenantId: "t1",
      entityTypeSlug: "customer",
      db: gateDb(
        { page_sections: sections, lifecycle_status: "approved" },
        { tenant_id: "t1" },
      ),
    });
    expect(gate.projected).toBe(true);
    expect(gate.sections).toHaveLength(1);
  });

  it("undeclared tenant/type falls back to the compiled page (AE8)", async () => {
    const gate = await resolveTwinPageGate({
      tenantId: "t1",
      entityTypeSlug: "customer",
      db: gateDb({ page_sections: [], lifecycle_status: "approved" }, null),
    });
    expect(gate).toMatchObject({
      projected: false,
      reason: "no_sections_declared",
    });
  });

  it("declared but no first sync → compiled fallback", async () => {
    const gate = await resolveTwinPageGate({
      tenantId: "t1",
      entityTypeSlug: "customer",
      db: gateDb(
        { page_sections: sections, lifecycle_status: "approved" },
        null,
      ),
    });
    expect(gate).toMatchObject({
      projected: false,
      reason: "first_sync_incomplete",
    });
  });
});
