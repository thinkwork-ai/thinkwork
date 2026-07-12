import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  const handle = () => ({ execute: executeMock });
  return {
    getDb: handle,
    getHindsightDb: handle,
    resolveHindsightDb: <T,>(primary: T) => primary,
    hindsightSql: actual.hindsightSql,
  };
});

import { HindsightAdapter, HindsightRetainError } from "./hindsight-adapter.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SPACE_ID = "c9f50dd6-5616-4812-b2ac-81b8d130f795";
const SOURCE_CONFIG_ID = "7f4b2a90-11a2-4a5f-9d1b-3c8e5f6a7b8c";

// U1 contract (external memory compounding plan, KTD "Stable Hindsight
// identity"): one replaceable Hindsight document per durable projection with
// document_id=external:<sourceConfigId>:<projectionKey> and
// update_mode=replace, targeted at exactly one shared (space_/tenant_) bank.
// Destructive retraction (document delete) stays DISABLED until U2 lands the
// pinned 0.8.4 saga — the retain path must never issue a delete.
describe("Hindsight document lifecycle contract (U1)", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function adapter() {
    return new HindsightAdapter({ endpoint: "https://hindsight.example" });
  }

  const documentId = `external:${SOURCE_CONFIG_ID}:company:twenty-co-1`;

  it("projects a stable replaceable document into exactly one tenant bank", async () => {
    const fetchMock = okFetch();

    await adapter().upsertMarkdownMemoryDocument!({
      tenantId: TENANT_ID,
      ownerType: "tenant",
      ownerId: TENANT_ID,
      path: `memory-sources/twenty/company/twenty-co-1.md`,
      documentId,
      context: "external_source_projection",
      content: "# Acme Corp\n\nDossier v1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://hindsight.example/v1/default/banks/tenant_${TENANT_ID}/memories`,
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].document_id).toBe(documentId);
    expect(body.items[0].update_mode).toBe("replace");
    expect(body.items[0].content).toContain("Dossier v1");
  });

  it("resolves a space owner to the space_ bank", async () => {
    const fetchMock = okFetch();

    await adapter().upsertMarkdownMemoryDocument!({
      tenantId: TENANT_ID,
      ownerType: "space",
      ownerId: SPACE_ID,
      path: "memory-sources/twenty/company/twenty-co-1.md",
      documentId,
      context: "external_source_projection",
      content: "# Acme Corp",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://hindsight.example/v1/default/banks/space_${SPACE_ID}/memories`,
    );
  });

  it("re-projection reuses the identical document_id with replace (idempotent, no append)", async () => {
    const fetchMock = okFetch();
    const a = adapter();

    const req = {
      tenantId: TENANT_ID,
      ownerType: "tenant" as const,
      ownerId: TENANT_ID,
      path: "memory-sources/twenty/company/twenty-co-1.md",
      documentId,
      context: "external_source_projection",
      content: "# Acme Corp\n\nDossier v1",
    };
    await a.upsertMarkdownMemoryDocument!(req);
    await a.upsertMarkdownMemoryDocument!({
      ...req,
      content: "# Acme Corp\n\nDossier v2",
    });

    const bodies = fetchMock.mock.calls.map((c) =>
      JSON.parse(c[1]?.body as string),
    );
    expect(bodies[0].items[0].document_id).toBe(documentId);
    expect(bodies[1].items[0].document_id).toBe(documentId);
    expect(bodies[1].items[0].update_mode).toBe("replace");
    expect(bodies[1].items[0].content).toContain("Dossier v2");
  });

  it("supports synchronous replace for workflow-deterministic retains", async () => {
    const fetchMock = okFetch();

    await adapter().upsertMarkdownMemoryDocument!({
      tenantId: TENANT_ID,
      ownerType: "tenant",
      ownerId: TENANT_ID,
      path: "memory-sources/twenty/company/twenty-co-1.md",
      documentId,
      context: "external_source_projection",
      content: "# Acme Corp",
      async: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).not.toHaveProperty("async");
  });

  it("never issues a destructive request from the projection path (retraction disabled until U2)", async () => {
    const fetchMock = okFetch();
    const a = adapter();

    await a.upsertMarkdownMemoryDocument!({
      tenantId: TENANT_ID,
      ownerType: "tenant",
      ownerId: TENANT_ID,
      path: "memory-sources/twenty/company/twenty-co-1.md",
      documentId,
      context: "external_source_projection",
      content: "# Acme Corp",
    });
    await a.upsertMarkdownMemoryDocument!({
      tenantId: TENANT_ID,
      ownerType: "tenant",
      ownerId: TENANT_ID,
      path: "memory-sources/twenty/company/twenty-co-1.md",
      documentId,
      context: "external_source_projection",
      content: "",
    });

    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.method).toBe("POST");
    }
    // Empty content is an upstream no-op, not a delete.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("surfaces a retryable retain error on 5xx so checkpoints stay unadvanced", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "upstream unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      adapter().upsertMarkdownMemoryDocument!({
        tenantId: TENANT_ID,
        ownerType: "tenant",
        ownerId: TENANT_ID,
        path: "memory-sources/twenty/company/twenty-co-1.md",
        documentId,
        context: "external_source_projection",
        content: "# Acme Corp",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HindsightRetainError && err.retryable === true,
    );
  });
});
