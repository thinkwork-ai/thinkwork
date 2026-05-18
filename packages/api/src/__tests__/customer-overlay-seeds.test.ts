import { describe, expect, it } from "vitest";
import {
  buildCustomerOverlayEvalRows,
  CUSTOMER_OVERLAY_EVAL_SOURCE,
  parseCustomerOverlayEvalPack,
  planCustomerOverlayEvalApply,
} from "../lib/customer-overlay-seeds";

describe("customer overlay eval seeds", () => {
  it("parses customer eval packs and labels rows with customer-overlay source", () => {
    const seeds = parseCustomerOverlayEvalPack(
      [
        {
          name: "Support refund answer",
          category: "support-quality",
          query: "How do refunds work?",
          assertions: [{ type: "contains", value: "policy" }],
          agentcore_evaluator_ids: ["Builtin.Helpfulness"],
        },
      ],
      "support",
    );
    const rows = buildCustomerOverlayEvalRows({
      tenantId: "tenant-1",
      packName: "support",
      seeds,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: "tenant-1",
      source: CUSTOMER_OVERLAY_EVAL_SOURCE,
      tags: expect.arrayContaining([
        "source:customer-overlay",
        "customer-overlay:pack:support",
        "customer-overlay:key:support/support-refund-answer",
      ]),
    });
  });

  it("plans customer overlay rows separately from built-in yaml seeds", () => {
    const [row] = buildCustomerOverlayEvalRows({
      tenantId: "tenant-1",
      packName: "support",
      seeds: parseCustomerOverlayEvalPack(
        [
          {
            name: "Support refund answer",
            category: "support-quality",
            query: "How do refunds work?",
            assertions: [{ type: "contains", value: "policy" }],
          },
        ],
        "support",
      ),
    });
    const plan = planCustomerOverlayEvalApply({
      rows: [row],
      existing: [
        {
          id: "built-in-1",
          name: row.name,
          source: "yaml-seed",
          tags: row.tags,
        },
      ],
    });

    expect(plan.insert).toEqual([row]);
    expect(plan.update).toEqual([]);
  });

  it("rejects invalid eval JSON before mutation planning", () => {
    expect(() =>
      parseCustomerOverlayEvalPack(
        [{ name: "Broken", query: "missing category", assertions: [] }],
        "broken",
      ),
    ).toThrow(/category is required/);
  });
});
