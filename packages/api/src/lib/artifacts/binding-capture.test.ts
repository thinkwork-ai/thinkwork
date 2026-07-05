import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  threadJsonRenderStateSnapshotPayload,
  type ThreadJsonRenderDataBindingDescriptor,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const OWNER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  bindingInserts: [] as Array<Record<string, unknown>>,
  onConflicts: [] as Array<Record<string, unknown>>,
  wherePredicates: [] as Array<{ table: string; predicate: unknown }>,
  // Per-table select results the mock db hands back at `.limit()`.
  mcpServerRow: null as { auth_type: string } | null,
  threadRow: null as { user_id: string | null } | null,
  checkoutRoutedRow: null as { id: string } | null,
}));

vi.mock("../../graphql/utils.js", () => {
  // Table identity markers so the select builder can branch on `.from()`.
  const artifactDataBindings = {
    __table: "artifact_data_bindings",
    id: { name: "id" },
    artifact_id: { name: "artifact_id" },
    part_id: { name: "part_id" },
    element_id: { name: "element_id" },
    tenant_id: { name: "tenant_id" },
  };
  const tenantMcpServers = {
    __table: "tenant_mcp_servers",
    tenant_id: { name: "tenant_id" },
    name: { name: "name" },
    slug: { name: "slug" },
    auth_type: { name: "auth_type" },
  };
  const threads = {
    __table: "threads",
    id: { name: "id" },
    user_id: { name: "user_id" },
  };
  const artifacts = {
    __table: "artifacts",
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
    type: { name: "type" },
    status: { name: "status" },
    content: { name: "content" },
    s3_key: { name: "s3_key" },
    head_version: { name: "head_version" },
    head_write_seq: { name: "head_write_seq" },
    metadata: { name: "metadata" },
  };
  const artifactVersions = { __table: "artifact_versions" };

  function selectBuilder() {
    let table = "";
    const builder: Record<string, any> = {
      from: (tbl: { __table: string }) => {
        table = tbl.__table;
        return builder;
      },
      where: (predicate: unknown) => {
        mocks.wherePredicates.push({ table, predicate });
        return builder;
      },
      limit: () => {
        if (table === "tenant_mcp_servers") {
          return Promise.resolve(
            mocks.mcpServerRow ? [mocks.mcpServerRow] : [],
          );
        }
        if (table === "threads") {
          return Promise.resolve(mocks.threadRow ? [mocks.threadRow] : []);
        }
        if (table === "artifacts") {
          return Promise.resolve(
            mocks.checkoutRoutedRow ? [mocks.checkoutRoutedRow] : [],
          );
        }
        return Promise.resolve([]);
      },
    };
    return builder;
  }

  const insertBuilder = {
    values: vi.fn((row: Record<string, unknown>) => {
      mocks.bindingInserts.push(row);
      return insertBuilder;
    }),
    onConflictDoUpdate: vi.fn((cfg: Record<string, unknown>) => {
      mocks.onConflicts.push(cfg);
      return insertBuilder;
    }),
    returning: vi.fn(() => Promise.resolve([{ id: "binding-1" }])),
  };

  return {
    artifactDataBindings,
    tenantMcpServers,
    threads,
    artifacts,
    artifactVersions,
    db: {
      select: vi.fn(() => selectBuilder()),
      insert: vi.fn(() => insertBuilder),
    },
    eq: (...a: unknown[]) => ({ eq: a }),
    and: (...a: unknown[]) => ({ and: a }),
    or: (...a: unknown[]) => ({ or: a }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
  };
});

import { upsertBindingFromActivityEvent } from "./binding-capture.js";
import { deriveCanvasArtifactId } from "./canvas-lifecycle.js";

function payloadWithBinding(
  part: ThreadJsonRenderPart,
  binding: ThreadJsonRenderDataBindingDescriptor,
) {
  return { ...threadJsonRenderStateSnapshotPayload(part), binding };
}

function descriptor(
  part: ThreadJsonRenderPart,
  overrides: Partial<ThreadJsonRenderDataBindingDescriptor> = {},
): ThreadJsonRenderDataBindingDescriptor {
  return {
    partId: part.id,
    elementId: "",
    serverRef: "aws-cost-explorer",
    serverName: "aws-cost-explorer",
    toolName: "get_cost_and_usage",
    frozenArgs: { region: "us-east-1" },
    resultShapeHash: "shape-fnv1a:deadbeef",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bindingInserts.length = 0;
  mocks.onConflicts.length = 0;
  mocks.wherePredicates.length = 0;
  mocks.mcpServerRow = null;
  mocks.threadRow = null;
  mocks.checkoutRoutedRow = null;
});

describe("upsertBindingFromActivityEvent", () => {
  it("returns null and writes nothing when the event carries no binding", async () => {
    const part = createTaskReviewJsonRenderFixture();
    const result = await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      // A plain snapshot payload — no `binding` field.
      payload: threadJsonRenderStateSnapshotPayload(part),
    });
    expect(result).toBeNull();
    expect(mocks.bindingInserts).toHaveLength(0);
  });

  it("upserts a binding row keyed on the derived artifact id", async () => {
    const part = createTaskReviewJsonRenderFixture();
    mocks.mcpServerRow = { auth_type: "tenant_api_key" };
    const result = await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      payload: payloadWithBinding(part, descriptor(part)),
    });
    const expectedArtifactId = deriveCanvasArtifactId(
      TENANT_ID,
      THREAD_ID,
      part.id,
    );
    expect(result).toEqual({ bindingId: "binding-1" });
    expect(mocks.bindingInserts).toHaveLength(1);
    expect(mocks.bindingInserts[0]).toMatchObject({
      tenant_id: TENANT_ID,
      artifact_id: expectedArtifactId,
      part_id: part.id,
      element_id: "",
      server_name: "aws-cost-explorer",
      tool_name: "get_cost_and_usage",
      auth_context: "tenant_mcp",
    });
    // Idempotent on the (artifact, part, element) unique key.
    expect(mocks.onConflicts[0].target).toBeDefined();
  });

  it("marks the binding fresh on capture — quality good + fetch timestamps (THINK-165)", async () => {
    // A binding descriptor only reaches capture when the runtime validated
    // sourceToolCallId against the CURRENT turn's completed MCP invocations,
    // so capture must stamp freshness on both the insert and re-capture paths.
    const part = createTaskReviewJsonRenderFixture();
    mocks.mcpServerRow = { auth_type: "tenant_api_key" };
    await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      payload: payloadWithBinding(part, descriptor(part)),
    });

    const inserted = mocks.bindingInserts[0] as Record<string, unknown>;
    expect(inserted.quality).toBe("good");
    expect(JSON.stringify(inserted.last_fetched_at)).toContain("now()");
    expect(JSON.stringify(inserted.last_good_at)).toContain("now()");

    // Re-capture (conflict) path: an agent-mediated refresh re-emit must flip
    // a STALE row back to GOOD — the last open THINK-145 seam.
    const set = (mocks.onConflicts[0] as { set: Record<string, unknown> }).set;
    expect(set.quality).toBe("good");
    expect(JSON.stringify(set.last_fetched_at)).toContain("now()");
    expect(JSON.stringify(set.last_good_at)).toContain("now()");
  });

  it("classifies an oauth MCP server as per_user_oauth and resolves the owner", async () => {
    const part = createTaskReviewJsonRenderFixture();
    mocks.mcpServerRow = { auth_type: "oauth" };
    mocks.threadRow = { user_id: OWNER_ID };
    await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      payload: payloadWithBinding(part, descriptor(part)),
    });
    expect(mocks.bindingInserts[0]).toMatchObject({
      auth_context: "per_user_oauth",
      owner_user_id: OWNER_ID,
    });
  });

  it("matches the MCP server registry by SLUG or name — the runtime sends the slug", async () => {
    // Regression (THINK-145 U11 live): the runtime identifies servers by slug
    // ("twenty--crm"); matching only tenant_mcp_servers.name ("Twenty CRM")
    // silently fell through to tenant_mcp with no owner.
    const part = createTaskReviewJsonRenderFixture();
    mocks.mcpServerRow = { auth_type: "oauth" };
    mocks.threadRow = { user_id: OWNER_ID };
    await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      payload: payloadWithBinding(
        part,
        descriptor(part, { serverName: "twenty--crm" }),
      ),
    });
    const mcpWhere = mocks.wherePredicates.find(
      (w) => w.table === "tenant_mcp_servers",
    );
    const flat = JSON.stringify(mcpWhere?.predicate);
    // The lookup must OR over both identity columns.
    expect(flat).toContain('"or"');
    expect(flat).toContain('"slug"');
    expect(flat).toContain('"name"');
    expect(mocks.bindingInserts[0]).toMatchObject({
      auth_context: "per_user_oauth",
      owner_user_id: OWNER_ID,
    });
  });

  it("defaults an unresolved server to tenant_mcp with no owner", async () => {
    const part = createTaskReviewJsonRenderFixture();
    mocks.mcpServerRow = null; // server name not in tenant registry
    await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      payload: payloadWithBinding(part, descriptor(part)),
    });
    expect(mocks.bindingInserts[0]).toMatchObject({
      auth_context: "tenant_mcp",
      owner_user_id: null,
    });
  });

  it("routes capture to the checked-out artifact instead of the thread-derived id (THINK-165)", async () => {
    // Regression (observed live): a re-emission in a CHECKOUT thread derived
    // artifact_id from (tenant, checkout thread, part) — an id with no
    // artifacts row — so the insert died on the FK and the binding never
    // refreshed. Capture must route via metadata.checkouts like the
    // born-artifact head-update path.
    const part = createTaskReviewJsonRenderFixture();
    const ORIGINAL_ARTIFACT_ID = "44444444-4444-4444-4444-444444444444";
    mocks.checkoutRoutedRow = { id: ORIGINAL_ARTIFACT_ID };
    mocks.mcpServerRow = { auth_type: "oauth" };
    mocks.threadRow = { user_id: OWNER_ID };
    const result = await upsertBindingFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      payload: payloadWithBinding(part, descriptor(part)),
    });
    expect(result).toEqual({ bindingId: "binding-1" });
    expect(mocks.bindingInserts[0]).toMatchObject({
      artifact_id: ORIGINAL_ARTIFACT_ID,
    });
    // The checkout lookup constrains on stablePartId + checkouts containment.
    const artifactWhere = mocks.wherePredicates.find(
      (w) => w.table === "artifacts",
    );
    const flat = JSON.stringify(artifactWhere?.predicate);
    expect(flat).toContain("stablePartId");
    expect(flat).toContain("checkouts");
  });
});
