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
    findExistingDraftDocument: vi.fn(async () => null),
    upsertDocumentRow: vi.fn(async (input) => {
      recorded.upserts.push(input as unknown as Record<string, unknown>);
    }),
    replaceSectionWaivers: vi.fn(async (input) => {
      recorded.waiverWrites.push(input as unknown as Record<string, unknown>);
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
