import { describe, expect, it, vi } from "vitest";
import type { PageSectionDeclaration } from "../ontology/twin-declarations.js";
import { projectEntityPage } from "./page-projection.js";
import { fetchLive, isLiveRoutable } from "./live-fetch-registry.js";
import { softLayerNodeId, upsertSoftLayerNodes } from "./soft-layer-writer.js";

const SECTIONS: PageSectionDeclaration[] = [
  {
    slug: "aging",
    heading: "Aging",
    kind: "facet_backed",
    facetSlug: "aging",
    sourceSystem: null,
    visibility: "all_members",
    position: 0,
  },
  {
    slug: "activity",
    heading: "Activity",
    kind: "live_routed",
    facetSlug: null,
    sourceSystem: "lastmile",
    visibility: "all_members",
    position: 1,
  },
  {
    slug: "knowledge",
    heading: "Knowledge",
    kind: "knowledge",
    facetSlug: null,
    sourceSystem: null,
    visibility: "all_members",
    position: 2,
  },
  {
    slug: "ops",
    heading: "Ops",
    kind: "facet_backed",
    facetSlug: "aging",
    sourceSystem: null,
    visibility: "operators_only",
    position: 3,
  },
];

const FACETS = [
  { slug: "aging", clonePolicy: "deep_clone", sourceSystem: "lastmile" },
];

function fakeDbWithWikiRow(row: unknown) {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row ? [row] : []),
  };
  return chain;
}

const twinQuery = vi.fn(async (args: { request: { kind: string } }) => {
  if (args.request.kind === "entity_get") {
    return {
      ok: true as const,
      results: [
        {
          node: {
            "~properties": {
              f_aging__synced_at: "2026-07-21T10:00:00.000Z",
              f_aging__batch: "b1",
              f_aging__seq: 9,
              f_aging__state: "synced",
              f_aging__daysPastDue: 31,
            },
          },
        },
      ],
    };
  }
  return {
    ok: true as const,
    results: [{ systems: [{ systemSlug: "lastmile", externalId: "77-4432" }] }],
  };
});

describe("projectEntityPage (KTD-8)", () => {
  const base = {
    tenantId: "tenant-1",
    entityTypeSlug: "customer",
    canonicalId: "can-777",
    facets: FACETS,
    db: fakeDbWithWikiRow({ title: "777", summary: "s", body_md: "notes" }),
    now: new Date("2026-07-21T11:00:00.000Z"),
    gate: {
      projected: true as const,
      sections: SECTIONS,
      reason: "projected" as const,
    },
    twinQuery: twinQuery as never,
  };

  it("renders sections independently; lastmile live section is STALE never live (AE2/KTD-8)", async () => {
    const page = await projectEntityPage({ ...base, viewerIsOperator: false });
    if (!page.projected) throw new Error("expected projected");
    const bySlug = Object.fromEntries(page.sections.map((s) => [s.slug, s]));
    expect(bySlug.aging.state).toBe("OK");
    expect(bySlug.aging.ageSeconds).toBe(3600);
    expect(bySlug.aging.provenance).toBe("source_backed");
    // lastmile is VPC-egress-only → not live-routable → STALE, page intact.
    expect(bySlug.activity.state).toBe("STALE");
    expect(bySlug.activity.detail).toBe("not_live_routable");
    expect(bySlug.knowledge.state).toBe("OK");
    expect(bySlug.knowledge.provenance).toBe("knowledge");
    expect(bySlug.knowledge.data).toMatchObject({ bodyMd: "notes" });
  });

  it("operators_only sections are absent for members, present for operators (R14)", async () => {
    const member = await projectEntityPage({
      ...base,
      viewerIsOperator: false,
    });
    const operator = await projectEntityPage({
      ...base,
      viewerIsOperator: true,
    });
    if (!member.projected || !operator.projected) throw new Error("projected");
    expect(member.sections.map((s) => s.slug)).not.toContain("ops");
    expect(operator.sections.map((s) => s.slug)).toContain("ops");
  });

  it("a failing section resolves ERROR while the rest of the page renders (F4)", async () => {
    const failing = vi.fn(async (args: { request: { kind: string } }) => {
      if (args.request.kind === "entity_get") throw new Error("boom");
      return { ok: true as const, results: [] };
    });
    const page = await projectEntityPage({
      ...base,
      viewerIsOperator: false,
      twinQuery: (async (args: never) => {
        try {
          return await failing(args as { request: { kind: string } });
        } catch {
          return { ok: false as const, reason: "unavailable" as const };
        }
      }) as never,
    });
    if (!page.projected) throw new Error("projected");
    const bySlug = Object.fromEntries(page.sections.map((s) => [s.slug, s]));
    // Facet section degrades (no stamps → STALE via pending), knowledge OK.
    expect(bySlug.knowledge.state).toBe("OK");
    expect(page.sections).toHaveLength(3);
  });

  it("returns the compiled fallback marker when the gate is closed (AE8)", async () => {
    const page = await projectEntityPage({
      ...base,
      viewerIsOperator: false,
      gate: {
        projected: false,
        sections: [],
        reason: "no_sections_declared",
      },
    });
    expect(page).toEqual({ projected: false, reason: "no_sections_declared" });
  });
});

describe("live-fetch registry", () => {
  it("lastmile is declared not live-routable; unknown systems too", async () => {
    expect(isLiveRoutable("lastmile")).toBe(false);
    expect(isLiveRoutable("mystery")).toBe(false);
    expect(isLiveRoutable("twenty")).toBe(true);
    const result = await fetchLive({
      tenantId: "t",
      systemSlug: "lastmile",
      externalId: "x",
    });
    expect(result).toEqual({ state: "STALE", reason: "not_live_routable" });
  });
});

describe("soft-layer writer (R11)", () => {
  it("upserts Topic/Decision nodes with softLayer provenance and skips bad slugs", async () => {
    const ops: Array<{ query: string; parameters: Record<string, unknown> }> =
      [];
    const neptune = {
      execute: async (query: string, parameters: Record<string, unknown>) => {
        ops.push({ query, parameters });
        return {};
      },
    };
    const result = await upsertSoftLayerNodes({
      tenantId: "tenant-1",
      pages: [
        { kind: "topic", slug: "pricing-strategy", title: "Pricing" },
        { kind: "decision", slug: "neptune-adoption", title: "Neptune" },
        { kind: "topic", slug: "bad) DELETE (n", title: "evil" },
      ],
      neptune,
    });
    expect(result).toEqual({ written: 2, skipped: 1 });
    expect(ops[0].query).toContain("MERGE (n:Topic");
    expect(ops[0].query).toContain("n.softLayer = true");
    expect(ops[0].parameters.nodeId).toBe(
      softLayerNodeId("tenant-1", "topic", "pricing-strategy"),
    );
    expect(ops[1].query).toContain("MERGE (n:Decision");
    // The hostile slug never reached query text.
    expect(ops.some((op) => op.query.includes("DELETE (n"))).toBe(false);
  });
});
