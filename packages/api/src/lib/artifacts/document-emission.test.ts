import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDocumentCard,
  deriveDocumentArtifactId,
  handleDocumentEmission,
  parseDocumentEmitInput,
  DOCUMENT_CARD_PAYLOAD_KIND,
  type DocumentEmissionDeps,
  type DocumentRow,
} from "./document-emission.js";
import { DOCUMENT_CARD_MAX_BYTES } from "./document-preflight.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "22222222-2222-2222-2222-222222222222";
const TURN_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SPACE_ID = "66666666-6666-6666-6666-666666666666";
const MESSAGE_ID = "77777777-7777-7777-7777-777777777777";

const VALID_DOCUMENT = {
  documentId: "doc-1",
  genre: "report",
  title: "Q3 Report",
  abstract: "Numbers are up.",
  digestMarkdown: "# Q3 Report\n\nNumbers are up.",
  renderHtml:
    '<!DOCTYPE html><html><head><title>Q3</title></head><body><h1 id="t">Q3</h1></body></html>',
  status: "draft",
};

interface Recorded {
  s3Writes: Array<{ key: string; contentType: string; bytes: number }>;
  upserts: Array<Record<string, unknown>>;
  pins: Array<Record<string, unknown>>;
  cards: Array<Record<string, unknown>>;
}

function makeDeps(overrides: Partial<DocumentEmissionDeps> = {}): {
  deps: DocumentEmissionDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = { s3Writes: [], upserts: [], pins: [], cards: [] };
  const row: DocumentRow = {
    id: deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    tenant_id: TENANT_ID,
    thread_id: THREAD_ID,
    space_id: null,
    status: "draft",
    head_version: 0,
    head_write_seq: 0,
    metadata: { kind: "document", genre: "report", documentId: "doc-1" },
  };
  const deps: DocumentEmissionDeps = {
    preflight: vi.fn(() => ({ ok: true }) as const),
    writePayload: vi.fn(async (args) => {
      recorded.s3Writes.push({
        key: args.key,
        contentType: (args as { contentType: string }).contentType,
        bytes: Buffer.byteLength((args as { body: string }).body, "utf8"),
      });
    }),
    resolveActingUserId: vi.fn(async ({ triggeringMessageId }) =>
      triggeringMessageId ? USER_ID : null,
    ),
    findExistingDraftDocument: vi.fn(async () => null),
    upsertDocumentRow: vi.fn(async (input) => {
      recorded.upserts.push(input as unknown as Record<string, unknown>);
    }),
    loadDocumentRow: vi.fn(async () => row),
    hasSpaceWriteRole: vi.fn(async () => true),
    pinDocumentHead: vi.fn(async (input) => {
      recorded.pins.push(input as unknown as Record<string, unknown>);
      return { headVersion: 1, contentHash: "hash", pinned: true };
    }),
    appendCardEvent: vi.fn(async (input) => {
      recorded.cards.push(input as unknown as Record<string, unknown>);
    }),
    ...overrides,
  };
  return { deps, recorded };
}

function emit(
  document: unknown,
  deps: DocumentEmissionDeps,
  triggeringMessageId: string | null = MESSAGE_ID,
) {
  return handleDocumentEmission(
    {
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      turnId: TURN_ID,
      triggeringMessageId,
      raw: document,
    },
    deps,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseDocumentEmitInput", () => {
  it("rejects bad genres, missing bodies, and spaceId on drafts", () => {
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, genre: "novel" }).ok,
    ).toBe(false);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, digestMarkdown: "" }).ok,
    ).toBe(false);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, renderHtml: " " }).ok,
    ).toBe(false);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, spaceId: SPACE_ID }).ok,
    ).toBe(false);
    expect(parseDocumentEmitInput(VALID_DOCUMENT).ok).toBe(true);
  });
});

describe("handleDocumentEmission", () => {
  it("persists both heads, upserts the row, and appends a card (AE2 shape)", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(VALID_DOCUMENT, deps);

    expect(result.statusCode).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(
      deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    );

    expect(recorded.s3Writes).toHaveLength(2);
    expect(recorded.s3Writes[0].key).toContain("/content.md");
    expect(recorded.s3Writes[0].contentType).toContain("markdown");
    expect(recorded.s3Writes[1].key).toContain("/render.html");
    expect(recorded.s3Writes[1].contentType).toContain("text/html");

    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.upserts[0].actingUserId).toBe(USER_ID);
    expect(recorded.upserts[0].genre).toBe("report");

    expect(recorded.cards).toHaveLength(1);
    const card = recorded.cards[0].card as Record<string, unknown>;
    expect(card.title).toBe("Q3 Report");
    expect(Buffer.byteLength(JSON.stringify(card), "utf8")).toBeLessThanOrEqual(
      DOCUMENT_CARD_MAX_BYTES,
    );
    // The full bodies never appear in the card.
    expect(JSON.stringify(recorded.cards[0])).not.toContain("<!DOCTYPE");
  });

  it("returns diagnostics and persists nothing on preflight reject (AE1/F2)", async () => {
    const diagnostics = [
      { code: "EXTERNAL_REF" as const, message: "x", location: "line 1" },
    ];
    const { deps, recorded } = makeDeps({
      preflight: vi.fn(() => ({ ok: false, diagnostics }) as const),
    });
    const result = await emit(VALID_DOCUMENT, deps);

    expect(result.statusCode).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("PREFLIGHT_REJECTED");
    expect(result.body.diagnostics).toEqual(diagnostics);
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.cards).toHaveLength(0);
  });

  it("re-emit with the same documentId targets the same artifact id", async () => {
    const { deps, recorded } = makeDeps();
    await emit(VALID_DOCUMENT, deps);
    await emit({ ...VALID_DOCUMENT, title: "Q3 Report v2" }, deps);
    expect(recorded.upserts).toHaveLength(2);
    expect(recorded.upserts[0].artifactId).toBe(recorded.upserts[1].artifactId);
  });

  it("falls back to the thread's existing draft when documentId is absent", async () => {
    const { deps } = makeDeps({
      findExistingDraftDocument: vi.fn(async () => ({ documentId: "doc-1" })),
    });
    const { documentId: _omitted, ...withoutId } = VALID_DOCUMENT;
    const result = await emit(withoutId, deps);
    expect(result.body.artifactId).toBe(
      deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    );
    expect(result.body.documentId).toBe("doc-1");
  });

  it("finalize pins both bodies and reports the new head version (AE3)", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit({ ...VALID_DOCUMENT, status: "final" }, deps);
    expect(result.body.status).toBe("final");
    expect(result.body.headVersion).toBe(1);
    expect(recorded.pins).toHaveLength(1);
    expect(recorded.pins[0].userId).toBe(USER_ID);
  });

  it("rejects finalize into a space the acting user is not a member of", async () => {
    const { deps, recorded } = makeDeps({
      hasSpaceWriteRole: vi.fn(async () => false),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("FORBIDDEN");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.pins).toHaveLength(0);
  });

  it("rejects finalize-with-space when no acting user is derivable", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("FORBIDDEN");
    expect(recorded.pins).toHaveLength(0);
  });

  it("card append failure never fails the emission (best-effort)", async () => {
    const { deps } = makeDeps({
      appendCardEvent: vi.fn(async () => {
        throw new Error("appsync down");
      }),
    });
    const result = await emit(VALID_DOCUMENT, deps);
    expect(result.body.ok).toBe(true);
  });
});

describe("buildDocumentCard", () => {
  it("truncates a huge abstract to stay under the card ceiling", () => {
    const card = buildDocumentCard({
      artifactId: "a",
      title: "T",
      genre: "report",
      abstract: "z".repeat(DOCUMENT_CARD_MAX_BYTES * 2),
      status: "draft",
      headVersion: 0,
    });
    expect(Buffer.byteLength(JSON.stringify(card), "utf8")).toBeLessThanOrEqual(
      DOCUMENT_CARD_MAX_BYTES,
    );
    expect(card.abstract).toContain("…");
  });

  it("uses the payload kind the web fold matches on", () => {
    expect(DOCUMENT_CARD_PAYLOAD_KIND).toBe("document.card");
  });
});
