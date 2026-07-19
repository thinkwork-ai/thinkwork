/**
 * Routing-map workspace projection tests (THINK-321 U4, KTD-4 —
 * R5/R6/AE6): deterministic rendering, the no-connector and
 * "No systems declared" lines, skip-when-unchanged writes, and the
 * nothing-declared noise guard.
 */

import { describe, expect, it } from "vitest";
import {
  NO_CONNECTOR_LINE,
  NO_SYSTEMS_DECLARED_LINE,
  ROUTING_MAP_FILE,
  refreshRoutingMapFile,
  renderRoutingMapMarkdown,
} from "./routing-map-file.js";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";

interface RecordedPut {
  Key: string;
  Body: string;
}

function createFakeS3(objects: Record<string, string> = {}) {
  const puts: RecordedPut[] = [];
  return {
    puts,
    objects,
    s3: {
      send: async (command: unknown) => {
        const input = (command as { input: Record<string, unknown> }).input;
        const key = String(input.Key);
        if ("Body" in input) {
          const body = String(input.Body);
          puts.push({ Key: key, Body: body });
          objects[key] = body;
          return {};
        }
        if (!(key in objects)) {
          const err = new Error("NoSuchKey");
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return {
          Body: { transformToString: async () => objects[key] },
        };
      },
    },
  };
}

const CUSTOMER_TYPE = {
  slug: "customer",
  name: "Customer",
  entries: [
    { facet: "touchpoints", sourceSystem: "twenty" },
    { facet: "invoices", sourceSystem: "lastmile", note: "billing of record" },
    { facet: "orders", sourceSystem: "lastmile" },
  ],
};

describe("renderRoutingMapMarkdown", () => {
  it("renders facets -> source system -> connector slug with stable ordering", () => {
    const content = renderRoutingMapMarkdown({
      entityTypes: [
        { slug: "vendor", name: "Vendor", entries: [] },
        CUSTOMER_TYPE,
      ],
      connectorBySourceSystem: new Map([["lastmile", "lastmile-pg"]]),
    });

    expect(content).toContain("### Customer (`customer`)");
    // Empty-map types are omitted from the declared section entirely.
    expect(content).not.toContain("Vendor");
    // Entries sort by facet: invoices, orders, touchpoints.
    const invoicesAt = content.indexOf("| invoices | lastmile |");
    const ordersAt = content.indexOf("| orders | lastmile |");
    const touchpointsAt = content.indexOf("| touchpoints | twenty |");
    expect(invoicesAt).toBeGreaterThan(-1);
    expect(ordersAt).toBeGreaterThan(invoicesAt);
    expect(touchpointsAt).toBeGreaterThan(ordersAt);
    // Linked source system renders the connector slug; note survives.
    expect(content).toContain(
      "| invoices | lastmile | `lastmile-pg` | billing of record |",
    );
  });

  it("renders the no-connector line for a source system with no link", () => {
    const content = renderRoutingMapMarkdown({
      entityTypes: [CUSTOMER_TYPE],
      connectorBySourceSystem: new Map([["lastmile", "lastmile-pg"]]),
    });
    expect(content).toContain(
      `| touchpoints | twenty | ${NO_CONNECTOR_LINE} |  |`,
    );
  });

  it("is deterministic: identical inputs in any order render identical bytes", () => {
    const shuffled = {
      ...CUSTOMER_TYPE,
      entries: [...CUSTOMER_TYPE.entries].reverse(),
    };
    const a = renderRoutingMapMarkdown({
      entityTypes: [
        CUSTOMER_TYPE,
        {
          slug: "asset",
          name: "Asset",
          entries: [{ facet: "location", sourceSystem: "lastmile" }],
        },
      ],
      connectorBySourceSystem: new Map([["lastmile", "lastmile-pg"]]),
    });
    const b = renderRoutingMapMarkdown({
      entityTypes: [
        {
          slug: "asset",
          name: "Asset",
          entries: [{ facet: "location", sourceSystem: "lastmile" }],
        },
        shuffled,
      ],
      connectorBySourceSystem: new Map([["lastmile", "lastmile-pg"]]),
    });
    expect(a).toBe(b);
    // Types sort by slug: asset before customer.
    expect(a.indexOf("### Asset")).toBeLessThan(a.indexOf("### Customer"));
  });

  it("renders the explicit no-systems-declared shell with the standing instruction", () => {
    const content = renderRoutingMapMarkdown({
      entityTypes: [{ slug: "customer", name: "Customer", entries: [] }],
      connectorBySourceSystem: new Map(),
    });
    expect(content).toContain(NO_SYSTEMS_DECLARED_LINE);
    // The standing instruction is always present (AE6's context source).
    expect(content).toContain("`resolve_entities`");
    expect(content).toContain("Never guess, construct, or recall keys");
    expect(content).toContain("no declared system");
  });
});

function queueRefreshSelects(
  fake: ReturnType<typeof createFakeIdentityDb>,
  input: {
    types?: Array<Record<string, unknown>>;
    links?: Array<Record<string, unknown>>;
    agents?: Array<Record<string, unknown>>;
  },
) {
  // Query order inside refreshRoutingMapFile: entity types, connector
  // links, agents.
  fake.selectQueue.push(input.types ?? []);
  fake.selectQueue.push(input.links ?? []);
  fake.selectQueue.push(input.agents ?? []);
}

const PREFIX = "tenants/acme/agents/main/";
const KEY = `${PREFIX}${ROUTING_MAP_FILE}`;

function refreshDeps(
  s3: ReturnType<typeof createFakeS3>,
  manifestCalls: string[] = [],
) {
  return {
    s3: s3.s3,
    bucket: "workspace-bucket",
    resolvePrefix: async () => PREFIX,
    regenerateManifest: async (_bucket: string, prefix: string) => {
      manifestCalls.push(prefix);
    },
  };
}

describe("refreshRoutingMapFile", () => {
  const typeRows = [
    {
      slug: "customer",
      name: "Customer",
      system_map: [
        { facet: "invoices", sourceSystem: "lastmile" },
        { facet: "touchpoints", sourceSystem: "twenty" },
      ],
    },
  ];
  const linkRows = [
    { source_system: "lastmile", connector_slug: "lastmile-pg" },
  ];

  it("writes the rendered map into each agent workspace", async () => {
    const fake = createFakeIdentityDb();
    queueRefreshSelects(fake, {
      types: typeRows,
      links: linkRows,
      agents: [{ id: "agent-1" }],
    });
    const s3 = createFakeS3();
    const manifestCalls: string[] = [];

    const result = await refreshRoutingMapFile(
      fake.db as never,
      "tenant-1",
      refreshDeps(s3, manifestCalls),
    );

    expect(result.agents).toBe(1);
    expect(result.written).toBe(1);
    expect(s3.puts).toHaveLength(1);
    expect(s3.puts[0].Key).toBe(KEY);
    expect(s3.puts[0].Body).toContain("### Customer (`customer`)");
    expect(s3.puts[0].Body).toContain(
      "| invoices | lastmile | `lastmile-pg` |",
    );
    expect(s3.puts[0].Body).toContain(
      `| touchpoints | twenty | ${NO_CONNECTOR_LINE} |`,
    );
    expect(manifestCalls).toEqual([PREFIX]);
  });

  it("skips the write when the rendered content is unchanged", async () => {
    // First pass computes the canonical bytes.
    const first = createFakeIdentityDb();
    queueRefreshSelects(first, {
      types: typeRows,
      links: linkRows,
      agents: [{ id: "agent-1" }],
    });
    const firstS3 = createFakeS3();
    const { content } = await refreshRoutingMapFile(
      first.db as never,
      "tenant-1",
      refreshDeps(firstS3),
    );

    // Second pass against a workspace already holding those bytes.
    const second = createFakeIdentityDb();
    queueRefreshSelects(second, {
      types: typeRows,
      links: linkRows,
      agents: [{ id: "agent-1" }],
    });
    const s3 = createFakeS3({ [KEY]: content });
    const manifestCalls: string[] = [];

    const result = await refreshRoutingMapFile(
      second.db as never,
      "tenant-1",
      refreshDeps(s3, manifestCalls),
    );

    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([
      { agentId: "agent-1", reason: "unchanged" },
    ]);
    expect(s3.puts).toHaveLength(0);
    expect(manifestCalls).toEqual([]);
  });

  it("rewrites a stale file when the map changes", async () => {
    const fake = createFakeIdentityDb();
    queueRefreshSelects(fake, {
      types: typeRows,
      links: linkRows,
      agents: [{ id: "agent-1" }],
    });
    const s3 = createFakeS3({ [KEY]: "# Entity Routing Map\n\nstale" });

    const result = await refreshRoutingMapFile(
      fake.db as never,
      "tenant-1",
      refreshDeps(s3),
    );

    expect(result.written).toBe(1);
    expect(s3.objects[KEY]).toContain("| invoices | lastmile |");
  });

  it("rewrites the explicit no-systems shell when declarations were emptied", async () => {
    const fake = createFakeIdentityDb();
    queueRefreshSelects(fake, {
      types: [{ slug: "customer", name: "Customer", system_map: [] }],
      links: [],
      agents: [{ id: "agent-1" }],
    });
    const s3 = createFakeS3({ [KEY]: "# Entity Routing Map\n\nstale" });

    const result = await refreshRoutingMapFile(
      fake.db as never,
      "tenant-1",
      refreshDeps(s3),
    );

    expect(result.written).toBe(1);
    expect(s3.objects[KEY]).toContain(NO_SYSTEMS_DECLARED_LINE);
    expect(s3.objects[KEY]).toContain("`resolve_entities`");
  });

  it("never creates the empty shell in a workspace with no file and no declarations", async () => {
    const fake = createFakeIdentityDb();
    queueRefreshSelects(fake, {
      types: [],
      links: [],
      agents: [{ id: "agent-1" }],
    });
    const s3 = createFakeS3();

    const result = await refreshRoutingMapFile(
      fake.db as never,
      "tenant-1",
      refreshDeps(s3),
    );

    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([
      { agentId: "agent-1", reason: "nothing_declared" },
    ]);
    expect(s3.puts).toHaveLength(0);
  });

  it("fails soft when no workspace bucket is configured", async () => {
    const fake = createFakeIdentityDb();
    const result = await refreshRoutingMapFile(fake.db as never, "tenant-1", {
      resolvePrefix: async () => PREFIX,
    });
    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([
      { agentId: "*", reason: "no_workspace_bucket" },
    ]);
  });
});
