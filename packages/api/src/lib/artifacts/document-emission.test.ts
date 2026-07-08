import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDocumentCard,
  deriveDocumentArtifactId,
  handleDocumentEmission,
  parseDocumentEmitInput,
  DOCUMENT_CARD_PAYLOAD_KIND,
  DocumentEmissionConflict,
  type DocumentEmissionDeps,
  type DocumentRow,
} from "./document-emission.js";
import { compileDocument } from "./document-compositor.js";
import { PLATFORM_PLATES } from "./plate-definitions.js";
import { resolvePlate, resolvePlatformPlate } from "./plate-registry.js";
import { summarizePlateWaivers } from "./document-waivers.js";
import {
  DOCUMENT_CARD_MAX_BYTES,
  runDocumentPreflight,
} from "./document-preflight.js";

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
  digestMarkdown: "## Summary\n\nNumbers are up 18% this quarter.",
  status: "draft",
};

/** THINK-154 retirement: the legacy dual-body shape, kept ONLY to prove it rejects. */
const LEGACY_DUAL_BODY = {
  ...VALID_DOCUMENT,
  renderHtml:
    '<!DOCTYPE html><html><head><title>Q3</title></head><body><h1 id="t">Q3</h1></body></html>',
};

interface Recorded {
  s3Writes: Array<{ key: string; contentType: string; bytes: number }>;
  renderBodies: string[];
  upserts: Array<Record<string, unknown>>;
  pins: Array<Record<string, unknown>>;
  cards: Array<Record<string, unknown>>;
  waiverWrites: Array<Record<string, unknown>>;
  conformanceRecords: Array<Record<string, unknown>>;
  memoryIngests: Array<Record<string, unknown>>;
  refreshSuccesses: Array<Record<string, unknown>>;
  refreshFailures: Array<Record<string, unknown>>;
}

function makeDeps(overrides: Partial<DocumentEmissionDeps> = {}): {
  deps: DocumentEmissionDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    s3Writes: [],
    renderBodies: [],
    upserts: [],
    pins: [],
    cards: [],
    waiverWrites: [],
    conformanceRecords: [],
    memoryIngests: [],
    refreshSuccesses: [],
    refreshFailures: [],
  };
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
    resolvePlate: vi.fn(async ({ slug }) => {
      const plate = resolvePlatformPlate(slug);
      const visibleSlugs = PLATFORM_PLATES.map((p) => p.slug);
      return plate
        ? ({ ok: true, plate, visibleSlugs } as const)
        : ({ ok: false, visibleSlugs } as const);
    }),
    compile: compileDocument,
    writePayload: vi.fn(async (args) => {
      recorded.s3Writes.push({
        key: args.key,
        contentType: (args as { contentType: string }).contentType,
        bytes: Buffer.byteLength((args as { body: string }).body, "utf8"),
      });
      if (args.key.includes("render")) {
        recorded.renderBodies.push((args as { body: string }).body);
      }
    }),
    resolveActingUserId: vi.fn(async ({ triggeringMessageId }) =>
      triggeringMessageId ? USER_ID : null,
    ),
    resolveTurnRunContext: vi.fn(async () => null),
    resolveBoundDocumentId: vi.fn(async () => null),
    markRefreshSucceeded: vi.fn(async (input) => {
      recorded.refreshSuccesses.push(
        input as unknown as Record<string, unknown>,
      );
    }),
    recordRefreshFailure: vi.fn(async (input) => {
      recorded.refreshFailures.push(
        input as unknown as Record<string, unknown>,
      );
    }),
    findThreadDocumentForRevision: vi.fn(async () => null),
    findDocumentByLogicalId: vi.fn(async () => null),
    upsertDocumentRow: vi.fn(async (input) => {
      recorded.upserts.push(input as unknown as Record<string, unknown>);
    }),
    replaceSectionWaivers: vi.fn(async (input) => {
      recorded.waiverWrites.push(input as unknown as Record<string, unknown>);
    }),
    recordConformance: vi.fn(async (input) => {
      recorded.conformanceRecords.push(
        input as unknown as Record<string, unknown>,
      );
    }),
    loadDocumentRow: vi.fn(async (id: string) => (id === row.id ? row : null)),
    hasSpaceWriteRole: vi.fn(async () => true),
    pinDocumentHead: vi.fn(async (input) => {
      recorded.pins.push(input as unknown as Record<string, unknown>);
      return { headVersion: 1, contentHash: "hash", pinned: true };
    }),
    ingestDocumentMemory: vi.fn(async (input) => {
      recorded.memoryIngests.push(input as unknown as Record<string, unknown>);
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
    // THINK-153: any well-formed slug parses — registry membership is
    // validated at emission time (UNKNOWN_GENRE), not at parse time.
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, genre: "novel" }).ok,
    ).toBe(true);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, genre: "Not A Slug" }).ok,
    ).toBe(false);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, genre: "-bad" }).ok,
    ).toBe(false);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, digestMarkdown: "" }).ok,
    ).toBe(false);
    // THINK-154 retirement: any renderHtml — even a non-empty one — rejects.
    expect(parseDocumentEmitInput(LEGACY_DUAL_BODY).ok).toBe(false);
    expect(
      parseDocumentEmitInput({ ...VALID_DOCUMENT, spaceId: SPACE_ID }).ok,
    ).toBe(false);
    expect(parseDocumentEmitInput(VALID_DOCUMENT).ok).toBe(true);
  });
});

describe("plate registry gate (THINK-153 KTD3)", () => {
  it("unregistered genre → COMPILE-stage rejection naming valid slugs (AE1)", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit({ ...VALID_DOCUMENT, genre: "roadmap" }, deps);
    expect(result.statusCode).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("COMPILE_REJECTED");
    const diag = (
      result.body.diagnostics as Array<{ code: string; message: string }>
    )[0];
    expect(diag.code).toBe("UNKNOWN_GENRE");
    expect(diag.message).toContain("report");
    expect(diag.message).toContain("qbr");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
  });

  it("hidden genre → rejected for a NEW document, accepted for a revision with an existing document_id", async () => {
    const hidden = resolvePlatformPlate("report")!;
    const { deps, recorded } = makeDeps({
      resolvePlate: vi.fn(async () => ({
        ok: true as const,
        plate: { ...hidden, hidden: true },
        visibleSlugs: ["plan", "brief"],
      })),
    });
    // New document (no documentId, no existing draft): rejected.
    const rejected = await emit(
      { ...VALID_DOCUMENT, documentId: undefined },
      deps,
    );
    expect(rejected.body.ok).toBe(false);
    const diag = (
      rejected.body.diagnostics as Array<{ code: string; message: string }>
    )[0];
    expect(diag.code).toBe("GENRE_HIDDEN");
    expect(recorded.upserts).toHaveLength(0);

    // Revision carrying an existing document_id: compiles (loadDocumentRow
    // returns the existing row in makeDeps).
    const revised = await emit(VALID_DOCUMENT, deps);
    expect(revised.body.ok).toBe(true);
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

  it("preflight failure on compiled output is a platform error and persists nothing (R6)", async () => {
    const diagnostics = [
      { code: "EXTERNAL_REF" as const, message: "x", location: "line 1" },
    ];
    const { deps, recorded } = makeDeps({
      preflight: vi.fn(() => ({ ok: false, diagnostics }) as const),
    });
    const result = await emit(VALID_DOCUMENT, deps);

    expect(result.statusCode).toBe(500);
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("COMPILER_DEFECT");
    expect(result.body.diagnostics).toBeUndefined();
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

  it("adopts the thread's existing document when documentId is absent", async () => {
    const existingRow: DocumentRow = {
      id: deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      space_id: null,
      status: "draft",
      head_version: 0,
      head_write_seq: 0,
      metadata: { kind: "document", genre: "report", documentId: "doc-1" },
    };
    const { deps } = makeDeps({
      findThreadDocumentForRevision: vi.fn(async () => existingRow),
    });
    const { documentId: _omitted, ...withoutId } = VALID_DOCUMENT;
    const result = await emit(withoutId, deps);
    expect(result.body.artifactId).toBe(existingRow.id);
    expect(result.body.documentId).toBe("doc-1");
  });

  it("a follow-up emit revises a FINALIZED document emitted into the thread by a bound run (no fork)", async () => {
    // Cross-thread continuity: the artifact row is homed in the automation's
    // own thread; this thread only shows the card. Adoption targets the row's
    // real id — never the (tenant, thread, documentId) derivation, which
    // would fork a copy.
    const boundRow: DocumentRow = {
      id: "11111111-2222-4333-8444-555555555555",
      tenant_id: TENANT_ID,
      thread_id: "99999999-9999-4999-8999-999999999999",
      space_id: null,
      status: "final",
      head_version: 2,
      head_write_seq: 2,
      metadata: { kind: "document", genre: "report", documentId: "doc-run" },
    };
    const { deps, recorded } = makeDeps({
      findThreadDocumentForRevision: vi.fn(async () => boundRow),
      loadDocumentRow: vi.fn(async (id: string) =>
        id === boundRow.id ? boundRow : null,
      ),
    });
    const { documentId: _omitted, ...withoutId } = VALID_DOCUMENT;
    const result = await emit({ ...withoutId, status: "final" }, deps);
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(boundRow.id);
    expect(result.body.documentId).toBe("doc-run");
    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.upserts[0].artifactId).toBe(boundRow.id);
    // The pin advances the SAME document's version chain.
    expect(recorded.pins).toHaveLength(1);
    expect((recorded.pins[0].row as DocumentRow).id).toBe(boundRow.id);
  });

  it("a carried documentId resolves to the existing document tenant-wide (no per-thread fork)", async () => {
    // The agent read document_id from the thread history of an automation-
    // emitted card; the row is homed in the run's own thread. Emitting from
    // this thread with that documentId must revise that row — the
    // (tenant, thread, documentId) derivation would mint a copy.
    const homedElsewhere: DocumentRow = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      tenant_id: TENANT_ID,
      thread_id: "99999999-9999-4999-8999-999999999999",
      space_id: SPACE_ID,
      status: "final",
      head_version: 2,
      head_write_seq: 2,
      metadata: { kind: "document", genre: "report", documentId: "doc-1" },
    };
    const { deps, recorded } = makeDeps({
      loadDocumentRow: vi.fn(async (id: string) =>
        id === homedElsewhere.id ? homedElsewhere : null,
      ),
      findDocumentByLogicalId: vi.fn(async ({ documentId }) =>
        documentId === "doc-1" ? homedElsewhere : null,
      ),
    });
    const result = await emit({ ...VALID_DOCUMENT, status: "final" }, deps);
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(homedElsewhere.id);
    expect(recorded.pins).toHaveLength(1);
    expect((recorded.pins[0].row as DocumentRow).id).toBe(homedElsewhere.id);
  });

  it("carried-documentId adoption into a space requires write access — else it falls back to the thread-local derivation", async () => {
    const homedElsewhere: DocumentRow = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      tenant_id: TENANT_ID,
      thread_id: "99999999-9999-4999-8999-999999999999",
      space_id: SPACE_ID,
      status: "final",
      head_version: 2,
      head_write_seq: 2,
      metadata: { kind: "document", genre: "report", documentId: "doc-1" },
    };
    const { deps } = makeDeps({
      loadDocumentRow: vi.fn(async (id: string) =>
        id === homedElsewhere.id ? homedElsewhere : null,
      ),
      findDocumentByLogicalId: vi.fn(async () => homedElsewhere),
      hasSpaceWriteRole: vi.fn(async () => false),
    });
    const result = await emit(VALID_DOCUMENT, deps);
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(
      deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    );
  });

  it("run-derived turns never adopt by logical documentId — derivation stays authoritative", async () => {
    const { deps } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => ({
        actingUserId: USER_ID,
        agentLoopId: "loop-1",
        loopName: "loop",
        runId: "run-1",
      })),
      findDocumentByLogicalId: vi.fn(async () => {
        throw new Error("must not be called on run-derived turns");
      }),
    });
    const result = await emit(VALID_DOCUMENT, deps, null);
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(
      deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    );
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

const RUN_AS_USER_ID = "88888888-8888-8888-8888-888888888888";
const RUN_ID = "99999999-9999-9999-9999-999999999999";
const LOOP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** A linked automation run whose run-as user passed the membership check. */
function runContext(actingUserId: string | null = RUN_AS_USER_ID) {
  return {
    runId: RUN_ID,
    agentLoopId: LOOP_ID,
    loopName: "Weekly pipeline report",
    actingUserId,
  };
}

describe("run-derived acting user (THINK-155 U1)", () => {
  it("scheduled finalize-with-space succeeds as the run-as user (AE1 identity leg)", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null, // no triggering user message — scheduled turn
    );
    expect(result.body.ok).toBe(true);
    expect(result.body.status).toBe("final");
    expect(deps.resolveTurnRunContext).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
    });
    expect(deps.hasSpaceWriteRole).toHaveBeenCalledWith(
      TENANT_ID,
      SPACE_ID,
      RUN_AS_USER_ID,
    );
    expect(recorded.upserts[0].actingUserId).toBe(RUN_AS_USER_ID);
    expect(recorded.pins[0].userId).toBe(RUN_AS_USER_ID);
  });

  it("triggering-message user wins over the run source (priority order)", async () => {
    const runResolver = vi.fn(async () => runContext());
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: runResolver,
    });
    const result = await emit(VALID_DOCUMENT, deps); // human turn
    expect(result.body.ok).toBe(true);
    expect(runResolver).not.toHaveBeenCalled();
    expect(recorded.upserts[0].actingUserId).toBe(USER_ID);
  });

  it("run context with a null acting user (stale/non-member run-as) keeps the guard firing", async () => {
    const runResolver = vi.fn(async () => runContext(null));
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: runResolver,
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(runResolver).toHaveBeenCalled();
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("FORBIDDEN");
    expect(recorded.pins).toHaveLength(0);
  });

  it("run-as user without space membership is rejected (AE3)", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      hasSpaceWriteRole: vi.fn(async () => false),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("FORBIDDEN");
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.pins).toHaveLength(0);
  });
});

describe("atomic keep-last-good for run-derived emission (THINK-155 U2)", () => {
  /** Deps where every mutating call appends to a shared op log. */
  function makeOrderedDeps(overrides: Partial<DocumentEmissionDeps> = {}) {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
    });
    const ops: string[] = [];
    const wrapped: DocumentEmissionDeps = {
      ...deps,
      writePayload: vi.fn(async (args) => {
        ops.push(
          (args as { key: string }).key.includes("render")
            ? "s3:render"
            : "s3:digest",
        );
        return deps.writePayload(args);
      }),
      upsertDocumentRow: vi.fn(async (input) => {
        ops.push("db:upsert");
        return deps.upsertDocumentRow(input);
      }),
      pinDocumentHead: vi.fn(async (input) => {
        ops.push("db:pin");
        return deps.pinDocumentHead(input);
      }),
      replaceSectionWaivers: vi.fn(async (input) => {
        ops.push("db:waivers");
        return deps.replaceSectionWaivers(input);
      }),
      ...overrides,
    };
    return { deps: wrapped, recorded, ops };
  }

  it("gate-rejected run-derived finalize changes nothing visible (AE2)", async () => {
    const { deps, recorded } = makeOrderedDeps({
      preflight: vi.fn(() => ({
        ok: false as const,
        diagnostics: [
          { code: "SKELETON" as const, message: "empty", location: "head" },
        ],
      })),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.pins).toHaveLength(0);
    expect(recorded.waiverWrites).toHaveLength(0);
  });

  it("run-derived refresh of an existing document swaps the head only after the pin (KTD2)", async () => {
    const { deps, recorded, ops } = makeOrderedDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(true);
    expect(result.body.status).toBe("final");
    expect(recorded.pins).toHaveLength(1);
    // Existing row (loadDocumentRow returns it): head bodies land after the pin.
    expect(ops.indexOf("db:pin")).toBeLessThan(ops.indexOf("s3:digest"));
    expect(ops.indexOf("db:pin")).toBeLessThan(ops.indexOf("s3:render"));
    expect(ops.indexOf("db:upsert")).toBeLessThan(ops.indexOf("db:pin"));
    // Status is never demoted mid-refresh.
    expect(recorded.upserts[0].preserveHeadOnConflict).toBe(true);
  });

  it("first run-derived emission (no prior row) writes head bodies before the pin", async () => {
    let created = false;
    const { deps, recorded, ops } = makeOrderedDeps();
    const baseLoad = deps.loadDocumentRow;
    deps.loadDocumentRow = vi.fn(async (artifactId: string) => {
      if (!created) {
        created = true; // first load: preexistence probe → not found
        return null;
      }
      return baseLoad(artifactId);
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(true);
    expect(ops.indexOf("s3:digest")).toBeLessThan(ops.indexOf("db:upsert"));
    expect(recorded.pins).toHaveLength(1);
  });

  it("run-derived pin conflict leaves the head bodies unwritten", async () => {
    const { deps, recorded } = makeOrderedDeps({
      pinDocumentHead: vi.fn(async () => {
        throw new DocumentEmissionConflict("concurrent head change");
      }),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("CONFLICT");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.waiverWrites).toHaveLength(0);
  });

  it("failure after staging then a successful retry converges (idempotent keys)", async () => {
    let attempts = 0;
    const { deps, recorded } = makeOrderedDeps({
      pinDocumentHead: vi.fn(async (input) => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient db failure");
        recorded.pins.push(input as unknown as Record<string, unknown>);
        return { headVersion: 2, contentHash: "hash", pinned: true };
      }),
    });
    await expect(
      emit({ ...VALID_DOCUMENT, status: "final" }, deps, null),
    ).rejects.toThrow("transient db failure");
    expect(recorded.s3Writes).toHaveLength(0); // head untouched by the failure
    const retry = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(retry.body.ok).toBe(true);
    expect(retry.body.headVersion).toBe(2);
    expect(recorded.s3Writes.length).toBeGreaterThan(0);
  });

  it("two sequential successful run-derived emissions keep a stable artifact id (R3)", async () => {
    const { deps, recorded } = makeOrderedDeps();
    const first = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    const second = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(first.body.artifactId).toBe(second.body.artifactId);
    expect(recorded.pins).toHaveLength(2);
  });

  it("run-derived draft emit stages nothing visible; continuity rides the returned documentId", async () => {
    const { deps, recorded } = makeOrderedDeps();
    const draft = await emit(
      { ...VALID_DOCUMENT, documentId: undefined },
      deps,
      null,
    );
    expect(draft.body.ok).toBe(true);
    expect(draft.body.status).toBe("draft");
    expect(typeof draft.body.documentId).toBe("string");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.cards).toHaveLength(0);
    // Stray rows are never adopted on run-derived turns.
    expect(deps.findThreadDocumentForRevision).not.toHaveBeenCalled();
  });

  it("run-derived draft emit then gate-rejected finalize leaves head, status, and versions unchanged", async () => {
    const { deps, recorded } = makeOrderedDeps();
    const draft = await emit(
      { ...VALID_DOCUMENT, documentId: undefined },
      deps,
      null,
    );
    const boundId = draft.body.documentId as string;
    deps.preflight = vi.fn(() => ({
      ok: false as const,
      diagnostics: [
        { code: "SKELETON" as const, message: "empty", location: "head" },
      ],
    }));
    const finalize = await emit(
      { ...VALID_DOCUMENT, documentId: boundId, status: "final" },
      deps,
      null,
    );
    expect(finalize.body.ok).toBe(false);
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.pins).toHaveLength(0);
  });

  it("human-turn emission keeps the draft-first write order (regression guard)", async () => {
    const { deps, recorded, ops } = makeOrderedDeps();
    const result = await emit({ ...VALID_DOCUMENT, status: "final" }, deps); // human turn
    expect(result.body.ok).toBe(true);
    expect(ops.indexOf("s3:digest")).toBeLessThan(ops.indexOf("db:upsert"));
    expect(ops.indexOf("db:upsert")).toBeLessThan(ops.indexOf("db:pin"));
    expect(recorded.upserts[0].preserveHeadOnConflict).toBeUndefined();
  });
});

describe("refresh state + failure observability (THINK-155 U3)", () => {
  it("run-derived finalize gate rejection records the failure against the automation", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      preflight: vi.fn(() => ({
        ok: false as const,
        diagnostics: [
          { code: "SKELETON" as const, message: "empty", location: "head" },
        ],
      })),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(recorded.refreshFailures).toHaveLength(1);
    expect(recorded.refreshFailures[0]).toMatchObject({
      tenantId: TENANT_ID,
      agentLoopId: LOOP_ID,
      loopName: "Weekly pipeline report",
      runId: RUN_ID,
      errorCode: "COMPILER_DEFECT",
    });
    expect(recorded.refreshFailures[0].artifactId).toBeTruthy();
    expect(recorded.refreshSuccesses).toHaveLength(0);
  });

  it("run-derived DRAFT gate rejection records nothing (in-turn self-correction loop)", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      resolvePlate: vi.fn(async () => ({
        ok: false as const,
        visibleSlugs: ["report"],
      })),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, genre: "novel" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(recorded.refreshFailures).toHaveLength(0);
  });

  it("space-membership rejection (AE3) records a FORBIDDEN failure naming the automation", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      hasSpaceWriteRole: vi.fn(async () => false),
    });
    await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(recorded.refreshFailures).toHaveLength(1);
    expect(recorded.refreshFailures[0].errorCode).toBe("FORBIDDEN");
    expect(String(recorded.refreshFailures[0].errorMessage)).toContain(
      "not a member of the target space",
    );
  });

  it("stale run-as rejection names the run-as user problem in the failure", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext(null)),
    });
    await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(recorded.refreshFailures).toHaveLength(1);
    expect(String(recorded.refreshFailures[0].errorMessage)).toContain(
      "run-as user",
    );
  });

  it("run-derived finalize success stamps the refresh (last_refresh_at path)", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(true);
    expect(recorded.refreshSuccesses).toHaveLength(1);
    expect(recorded.refreshSuccesses[0]).toMatchObject({
      tenantId: TENANT_ID,
      artifactId: result.body.artifactId,
    });
    expect(recorded.refreshFailures).toHaveLength(0);
  });

  it("human-turn emission failure records no refresh state and no item", async () => {
    const { deps, recorded } = makeDeps({
      hasSpaceWriteRole: vi.fn(async () => false),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
    );
    expect(result.body.ok).toBe(false);
    expect(recorded.refreshFailures).toHaveLength(0);
    expect(recorded.refreshSuccesses).toHaveLength(0);
  });

  it("human-turn successful finalize never stamps refresh state", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit({ ...VALID_DOCUMENT, status: "final" }, deps);
    expect(result.body.ok).toBe(true);
    expect(recorded.refreshSuccesses).toHaveLength(0);
  });

  it("a refresh-record fault never masks the emission response (best-effort)", async () => {
    const { deps } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      hasSpaceWriteRole: vi.fn(async () => false),
      recordRefreshFailure: vi.fn(async () => {
        throw new Error("inbox down");
      }),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
      null,
    );
    expect(result.body.code).toBe("FORBIDDEN");
  });
});

describe("bound-document target enforcement (THINK-155 U5)", () => {
  const BOUND_ARTIFACT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const boundRow: DocumentRow = {
    id: BOUND_ARTIFACT_ID,
    tenant_id: TENANT_ID,
    thread_id: "00000000-0000-0000-0000-000000000001", // an earlier run's thread
    space_id: SPACE_ID,
    status: "final",
    head_version: 3,
    head_write_seq: 3,
    metadata: { kind: "document", genre: "report", documentId: "doc-bound" },
  };

  function makeBoundDeps(overrides: Partial<DocumentEmissionDeps> = {}) {
    return makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      resolveBoundDocumentId: vi.fn(async () => BOUND_ARTIFACT_ID),
      loadDocumentRow: vi.fn(async (artifactId: string) =>
        artifactId === BOUND_ARTIFACT_ID ? boundRow : null,
      ),
      ...overrides,
    });
  }

  it("emit with no document_id revises the bound artifact across threads", async () => {
    const { deps, recorded } = makeBoundDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, documentId: undefined, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(BOUND_ARTIFACT_ID);
    expect(result.body.documentId).toBe("doc-bound");
    expect(recorded.upserts[0].artifactId).toBe(BOUND_ARTIFACT_ID);
    expect(recorded.pins[0]).toMatchObject({ row: boundRow });
  });

  it("emit with the bound document_id also revises the bound artifact", async () => {
    const { deps, recorded } = makeBoundDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, documentId: "doc-bound", status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(true);
    expect(recorded.upserts[0].artifactId).toBe(BOUND_ARTIFACT_ID);
  });

  it("emit attempting a different document is rejected with an actionable error", async () => {
    const { deps, recorded } = makeBoundDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, documentId: "some-other-doc", status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("BOUND_DOCUMENT_MISMATCH");
    expect(String(result.body.error)).toContain("doc-bound");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.pins).toHaveLength(0);
  });

  it("a bound artifact in a different tenant is rejected with no write", async () => {
    const { deps, recorded } = makeBoundDeps({
      loadDocumentRow: vi.fn(async () => ({
        ...boundRow,
        tenant_id: "00000000-0000-0000-0000-00000000dead",
      })),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("BOUND_DOCUMENT_INVALID");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.pins).toHaveLength(0);
    // Finalize attempt on a broken binding is a recorded refresh failure.
    expect(recorded.refreshFailures).toHaveLength(1);
    expect(recorded.refreshFailures[0].errorCode).toBe(
      "BOUND_DOCUMENT_INVALID",
    );
  });

  it("a dangling bound id (no artifact row) is rejected with no write", async () => {
    const { deps, recorded } = makeBoundDeps({
      loadDocumentRow: vi.fn(async () => null),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("BOUND_DOCUMENT_INVALID");
    expect(recorded.upserts).toHaveLength(0);
  });

  it("no documentId in the payload (all production paths today) leaves behavior unchanged", async () => {
    const { deps, recorded } = makeDeps({
      resolveTurnRunContext: vi.fn(async () => runContext()),
      resolveBoundDocumentId: vi.fn(async () => null),
    });
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final" },
      deps,
      null,
    );
    expect(result.body.ok).toBe(true);
    expect(result.body.artifactId).toBe(
      deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    );
    expect(recorded.pins).toHaveLength(1);
  });

  it("human turns never consult the bound-document seam", async () => {
    const boundResolver = vi.fn(async () => BOUND_ARTIFACT_ID);
    const { deps } = makeDeps({ resolveBoundDocumentId: boundResolver });
    const result = await emit(VALID_DOCUMENT, deps); // human turn
    expect(result.body.ok).toBe(true);
    expect(boundResolver).not.toHaveBeenCalled();
  });
});

describe("documents-as-memory ingest (THINK-152 / THINK-193 P3)", () => {
  it("draft emission ingests the digest with acting user and no space", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(VALID_DOCUMENT, deps);
    expect(result.body.ok).toBe(true);
    expect(recorded.memoryIngests).toHaveLength(1);
    const ingest = recorded.memoryIngests[0];
    expect(ingest.artifactId).toBe(
      deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
    );
    expect(ingest.genre).toBe("report");
    expect(ingest.title).toBe("Q3 Report");
    expect(ingest.digestMarkdown).toBe(VALID_DOCUMENT.digestMarkdown);
    expect(ingest.status).toBe("draft");
    expect(ingest.actingUserId).toBe(USER_ID);
    expect(ingest.spaceId).toBeNull();
    expect(typeof ingest.emittedAt).toBe("string");
  });

  it("finalize-with-space ingests with the space owner and final status", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, status: "final", spaceId: SPACE_ID },
      deps,
    );
    expect(result.body.ok).toBe(true);
    expect(recorded.memoryIngests).toHaveLength(1);
    const ingest = recorded.memoryIngests[0];
    expect(ingest.status).toBe("final");
    expect(ingest.headVersion).toBe(1);
    expect(ingest.spaceId).toBe(SPACE_ID);
  });

  it("a re-emitted draft of a space-assigned document keeps the row's space", async () => {
    const { deps, recorded } = makeDeps();
    const spacedRow: DocumentRow = {
      id: deriveDocumentArtifactId(TENANT_ID, THREAD_ID, "doc-1"),
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      space_id: SPACE_ID,
      status: "final",
      head_version: 2,
      head_write_seq: 3,
      metadata: { kind: "document", genre: "report", documentId: "doc-1" },
    };
    deps.loadDocumentRow = vi.fn(async () => spacedRow);
    await emit(VALID_DOCUMENT, deps);
    expect(recorded.memoryIngests[0].spaceId).toBe(SPACE_ID);
  });

  it("memory ingest failure never fails the emission (best-effort)", async () => {
    const { deps, recorded } = makeDeps({
      ingestDocumentMemory: vi.fn(async () => {
        throw new Error("hindsight down");
      }),
    });
    const result = await emit(VALID_DOCUMENT, deps);
    expect(result.body.ok).toBe(true);
    expect(recorded.cards).toHaveLength(1);
  });

  it("a rejected emission never ingests memory", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(
      { ...VALID_DOCUMENT, genre: "not-a-genre" },
      deps,
    );
    expect(result.body.ok).toBe(false);
    expect(recorded.memoryIngests).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// THINK-154 U4: dual-shape emission — markdown-only compiles via the
// compositor (PLATE gate skipped); legacy dual-body is byte-for-byte the
// current validation path including PLATE.
// ---------------------------------------------------------------------------

const V2_DOCUMENT = {
  documentId: "doc-1",
  genre: "report",
  title: "Q3 Report",
  abstract: "Numbers are up.",
  digestMarkdown: "## Summary\n\nNumbers are up 18% this quarter.\n",
  status: "draft",
};

describe("dual-shape emission (THINK-154 U4)", () => {
  it("markdown-only emission compiles, persists both bodies, upserts, and emits the card", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(V2_DOCUMENT, deps);

    expect(result.statusCode).toBe(200);
    expect(result.body.ok).toBe(true);

    expect(recorded.s3Writes).toHaveLength(2);
    expect(recorded.s3Writes[0].key).toContain("/content.md");
    expect(recorded.s3Writes[1].key).toContain("/render.html");
    // The render is compiler output, not an agent body.
    expect(recorded.renderBodies[0]).toContain(
      '<meta name="tw-plate" content="report">',
    );
    expect(recorded.renderBodies[0]).toContain("Numbers are up 18%");
    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.cards).toHaveLength(1);
  });

  it("runs the retained runtime preflight on compiled output (R6)", async () => {
    const preflight = vi.fn<DocumentEmissionDeps["preflight"]>(() => ({
      ok: true,
    }));
    const { deps } = makeDeps({ preflight });
    await emit(V2_DOCUMENT, deps);
    expect(preflight).toHaveBeenCalledTimes(1);
    const arg = preflight.mock.calls[0][0];
    expect(arg.renderHtml).toContain("tw-plate");
    expect(arg.digestMarkdown).toContain("Numbers are up");
  });

  it("THINK-154 retirement: the legacy dual-body shape is rejected with a self-repair error", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(LEGACY_DUAL_BODY, deps);
    expect(result.statusCode).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(String(result.body.error)).toContain("no longer accepted");
    expect(String(result.body.error)).toContain("digest_markdown");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
  });

  it("compile rejection (unknown directive) persists nothing and returns diagnostics in-turn", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(
      {
        ...V2_DOCUMENT,
        digestMarkdown: "## Body\n\n```tw:hologram\nfoo: 1\n```\n",
      },
      deps,
    );
    expect(result.statusCode).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(result.body.code).toBe("COMPILE_REJECTED");
    const diagnostics = result.body.diagnostics as Array<{
      code: string;
      message: string;
    }>;
    expect(diagnostics[0].code).toBe("UNKNOWN_DIRECTIVE");
    expect(diagnostics[0].message).toContain("tw:stats");
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.cards).toHaveLength(0);
  });

  it("preflight failure on compiled output is a platform error, not a model retry", async () => {
    const { deps, recorded } = makeDeps({
      // A broken compiler slips a defect past its own unit tests…
      compile: vi.fn(() => ({
        ok: true as const,
        renderHtml: "<html>broken</html>",
        warnings: [],
        waivers: [],
      })),
      // …and the retained runtime preflight catches it (R6).
      preflight: vi.fn<DocumentEmissionDeps["preflight"]>(() => ({
        ok: false,
        diagnostics: [{ code: "SKELETON", message: "x", location: "head" }],
      })),
    });
    const result = await emit(V2_DOCUMENT, deps);
    expect(result.statusCode).toBe(500);
    expect(result.body.code).toBe("COMPILER_DEFECT");
    expect(result.body.diagnostics).toBeUndefined();
    expect(recorded.s3Writes).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
  });

  it("markdown-only + status final pins a version whose render is the compiled output", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit({ ...V2_DOCUMENT, status: "final" }, deps);
    expect(result.body.status).toBe("final");
    expect(recorded.pins).toHaveLength(1);
    expect(recorded.pins[0].renderHtml).toContain(
      '<meta name="tw-plate" content="report">',
    );
  });

  it("compile warnings surface in the success body", async () => {
    const { deps } = makeDeps();
    const result = await emit(
      {
        ...V2_DOCUMENT,
        digestMarkdown: "---\nbanana: split\n---\n\n## Body\n\nText.\n",
      },
      deps,
    );
    expect(result.body.ok).toBe(true);
    const warnings = result.body.warnings as Array<{ code: string }>;
    expect(warnings.some((w) => w.code === "FRONTMATTER_UNKNOWN_KEY")).toBe(
      true,
    );
  });

  it("parse rejects when digestMarkdown is missing regardless of shape", async () => {
    expect(
      parseDocumentEmitInput({ ...V2_DOCUMENT, digestMarkdown: undefined }).ok,
    ).toBe(false);
    expect(parseDocumentEmitInput(V2_DOCUMENT).ok).toBe(true);
  });
});

describe("waiver persistence (THINK-183 U5)", () => {
  const MANIFEST_PLATE_ROW = {
    slug: "rep-check",
    origin: "tenant" as const,
    config: {
      displayName: "Rep Check",
      useFor: "A lightweight rep review with a two-section manifest.",
      sections: [
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "required-if-material",
          guidance: "Stage-by-stage funnel.",
        },
        {
          id: "summary",
          title: "Summary",
          tier: "required",
          guidance: "Headline outcome.",
        },
      ],
    },
    hidden: false,
  };

  function manifestDeps(overrides: Partial<DocumentEmissionDeps> = {}) {
    return makeDeps({
      resolvePlate: vi.fn(async ({ tenantId, slug }) => {
        const plate = await resolvePlate(tenantId, slug, {
          getPlateRow: async (_t: string, s: string) =>
            s === "rep-check" ? (MANIFEST_PLATE_ROW as never) : null,
          listPlateRows: async () => [MANIFEST_PLATE_ROW as never],
          getTenantDocumentPalette: async () => ({ light: {}, dark: {} }),
        });
        const visibleSlugs = PLATFORM_PLATES.map((p) => p.slug);
        return plate
          ? ({ ok: true, plate, visibleSlugs } as const)
          : ({ ok: false, visibleSlugs } as const);
      }),
      ...overrides,
    });
  }

  const WAIVED_DOC = {
    documentId: "doc-1",
    genre: "rep-check",
    title: "Rep Review — Q3",
    abstract: "Quarterly review with a waived pipeline section.",
    status: "draft",
    digestMarkdown: `## Summary

Attainment held at 82% of target.

\`\`\`tw:waiver
section: pipeline-health
reason: No stage-level pipeline data is connected for this rep.
\`\`\`
`,
  };

  it("records waiver rows with plate slug, section id, reason; final persists as final (AE3)", async () => {
    const { deps, recorded } = manifestDeps();
    const result = await emit({ ...WAIVED_DOC, status: "final" }, deps);
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ ok: true, status: "final" });
    expect(recorded.waiverWrites).toHaveLength(1);
    expect(recorded.waiverWrites[0]).toMatchObject({
      tenantId: TENANT_ID,
      plateSlug: "rep-check",
      waivers: [
        {
          sectionId: "pipeline-health",
          tier: "required-if-material",
          reason: "No stage-level pipeline data is connected for this rep.",
        },
      ],
    });
  });

  it("re-emission without waivers still rewrites (clears) the rows — head semantics", async () => {
    const { deps, recorded } = manifestDeps();
    const fullDoc = {
      ...WAIVED_DOC,
      digestMarkdown: `## Summary

All good.

## Pipeline Health

Funnel narrative.
`,
    };
    const result = await emit(fullDoc, deps);
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    expect(recorded.waiverWrites).toHaveLength(1);
    expect(recorded.waiverWrites[0]).toMatchObject({ waivers: [] });
  });

  it("a rejected emission writes no waiver rows", async () => {
    const { deps, recorded } = manifestDeps();
    const silentOmission = {
      ...WAIVED_DOC,
      digestMarkdown: `## Summary

No pipeline section, no waiver.
`,
    };
    const result = await emit(silentOmission, deps);
    expect(result.body).toMatchObject({ ok: false, code: "COMPILE_REJECTED" });
    expect(recorded.waiverWrites).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
  });

  it("a contract-less plate emission never touches the waiver table", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(VALID_DOCUMENT, deps);
    expect(result.body).toMatchObject({ ok: true });
    expect(recorded.waiverWrites).toHaveLength(0);
  });
});

describe("summarizePlateWaivers (THINK-189 seam)", () => {
  const ROWS = [
    {
      artifactId: "a1",
      plateSlug: "sales-rep-review",
      sectionId: "pipeline-health",
      tier: "required-if-material",
      reason: "no data",
      createdAt: new Date(0),
    },
    {
      artifactId: "a2",
      plateSlug: "sales-rep-review",
      sectionId: "pipeline-health",
      tier: "required-if-material",
      reason: "still no data",
      createdAt: new Date(0),
    },
    {
      artifactId: "a2",
      plateSlug: "sales-rep-review",
      sectionId: "summary",
      tier: "required",
      reason: "n/a",
      createdAt: new Date(0),
    },
    {
      artifactId: "a3",
      plateSlug: "weekly-status",
      sectionId: "metrics",
      tier: "required",
      reason: "no metrics source connected",
      createdAt: new Date(0),
    },
  ];
  const store = {
    listByTenant: async (_tenant: string, plateSlug?: string) =>
      plateSlug ? ROWS.filter((r) => r.plateSlug === plateSlug) : ROWS,
  };

  it("aggregates count, document count, and reasons per plate", async () => {
    const summaries = await summarizePlateWaivers(TENANT_ID, undefined, store);
    expect(summaries.map((s) => s.plateSlug)).toEqual([
      "sales-rep-review",
      "weekly-status",
    ]);
    expect(summaries[0]).toMatchObject({ count: 3, documentCount: 2 });
    expect(summaries[1].waivers[0].reason).toBe("no metrics source connected");
  });

  it("scopes to a single plate when asked", async () => {
    const summaries = await summarizePlateWaivers(
      TENANT_ID,
      "weekly-status",
      store,
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      plateSlug: "weekly-status",
      count: 1,
    });
  });
});

describe("conformance recording (THINK-189 U3)", () => {
  const MANIFEST_PLATE_ROW = {
    slug: "rep-check",
    origin: "tenant" as const,
    config: {
      displayName: "Rep Check",
      useFor: "A lightweight rep review with a two-section manifest.",
      sections: [
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "suggested",
          guidance: "Stage-by-stage funnel.",
          suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
        },
        {
          id: "summary",
          title: "Summary",
          tier: "required",
          guidance: "Headline outcome.",
        },
      ],
    },
    hidden: false,
  };

  function conformanceDeps(overrides: Partial<DocumentEmissionDeps> = {}) {
    return makeDeps({
      resolvePlate: vi.fn(async ({ tenantId, slug }) => {
        const plate = await resolvePlate(tenantId, slug, {
          getPlateRow: async (_t: string, s: string) =>
            s === "rep-check" ? (MANIFEST_PLATE_ROW as never) : null,
          listPlateRows: async () => [MANIFEST_PLATE_ROW as never],
          getTenantDocumentPalette: async () => ({ light: {}, dark: {} }),
        });
        const visibleSlugs = PLATFORM_PLATES.map((p) => p.slug);
        return plate
          ? ({ ok: true, plate, visibleSlugs } as const)
          : ({ ok: false, visibleSlugs } as const);
      }),
      ...overrides,
    });
  }

  const CONFORMING_DOC = {
    documentId: "doc-1",
    genre: "rep-check",
    title: "Rep Review — Q3",
    abstract: "Quarterly review.",
    status: "draft",
    digestMarkdown: `## Summary

Attainment held at 82% of target.

## Pipeline Health

Funnel narrative without the chart.
`,
  };

  it("records a report with facts joined from the compositor (AE1 shape)", async () => {
    const { deps, recorded } = conformanceDeps();
    const result = await emit(CONFORMING_DOC, deps);
    expect(result.body).toMatchObject({ ok: true, status: "draft" });
    expect(recorded.conformanceRecords).toHaveLength(1);
    const record = recorded.conformanceRecords[0] as {
      tenantId: string;
      plateSlug: string;
      documentStatus: string;
      sectionFacts: {
        sections: Array<Record<string, unknown>>;
      };
      manifestSnapshot: { sections: Array<{ id: string }> };
    };
    expect(record.tenantId).toBe(TENANT_ID);
    expect(record.plateSlug).toBe("rep-check");
    expect(record.documentStatus).toBe("draft");
    const pipeline = record.sectionFacts.sections.find(
      (s) => s.id === "pipeline-health",
    )!;
    expect(pipeline).toMatchObject({
      status: "present",
      suggestedDirectives: [
        { kind: "chart", chartType: "funnel", used: false },
      ],
    });
    expect(record.manifestSnapshot.sections.map((s) => s.id)).toEqual([
      "pipeline-health",
      "summary",
    ]);
  });

  it("a finalized emission records documentStatus final", async () => {
    const { deps, recorded } = conformanceDeps();
    const result = await emit({ ...CONFORMING_DOC, status: "final" }, deps);
    expect(result.body).toMatchObject({ ok: true, status: "final" });
    expect(recorded.conformanceRecords).toHaveLength(1);
    expect(recorded.conformanceRecords[0]).toMatchObject({
      documentStatus: "final",
    });
  });

  it("a contract-less plate emission never records (AE5)", async () => {
    const { deps, recorded } = makeDeps();
    const result = await emit(VALID_DOCUMENT, deps);
    expect(result.body).toMatchObject({ ok: true });
    expect(recorded.conformanceRecords).toHaveLength(0);
  });

  it("a recorder failure logs and the emission still succeeds (R3)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = conformanceDeps({
      recordConformance: vi.fn(async () => {
        throw new Error("insert exploded");
      }),
    });
    const result = await emit(CONFORMING_DOC, deps);
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("conformance record failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("re-emitting the same document records again (append, not head-rewrite)", async () => {
    const { deps, recorded } = conformanceDeps();
    await emit(CONFORMING_DOC, deps);
    await emit(CONFORMING_DOC, deps);
    expect(recorded.conformanceRecords).toHaveLength(2);
  });
});
