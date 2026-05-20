/**
 * Unit tests for the PR 3 compiler stack.
 *
 * Covers the pieces we can exercise without a live Bedrock endpoint:
 *   - bedrock.parseJsonResponse (direct + fenced + leading-prose inputs)
 *   - aliases.slugifyTitle / seedAliasesForTitle
 *   - planner.validatePlannerResult (accept/reject matrix)
 *   - planner.buildPlannerUserPrompt (stable shape + metadata compaction)
 *   - section-writer.isMeaningfulChange (noise filter)
 *   - compiler.runCompileJob end-to-end with mocked adapter, mocked DB
 *     repository, mocked Bedrock planner + section-writer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Bedrock + parseJsonResponse ─────────────────────────────────────────────

import { parseJsonResponse } from "../lib/wiki/bedrock.js";

describe("parseJsonResponse", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonResponse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips ```json fences", () => {
    expect(parseJsonResponse('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("strips plain ``` fences", () => {
    expect(parseJsonResponse('```\n{"a":3}\n```')).toEqual({ a: 3 });
  });

  it("extracts the first object block when prose leads", () => {
    expect(parseJsonResponse('Here is the plan:\n{"a":4}')).toEqual({
      a: 4,
    });
  });

  it("throws on empty input", () => {
    expect(() => parseJsonResponse("")).toThrow(/empty/);
  });

  it("throws when no JSON block is present", () => {
    expect(() => parseJsonResponse("no json here at all")).toThrow(/no JSON/);
  });
});

// ─── bedrock retry wrapper ───────────────────────────────────────────────────
//
// Covers the 2026-04-20 Bedrock-retry shim added after Marco's bootstrap chain
// broke twice on empty/truncated JSON responses (15% of calls). Tests mock the
// underlying Bedrock SDK via a shared `sendMock` so `invokeClaude` itself
// stays real — the retry loop is exercised end-to-end.

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-bedrock-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@aws-sdk/client-bedrock-runtime")
  >("@aws-sdk/client-bedrock-runtime");
  return {
    ...actual,
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: sendMock,
    })),
  };
});

import {
  invokeClaudeJson,
  invokeClaudeWithRetry,
  BedrockRetryExhaustedError,
  isRetryableBedrockError,
} from "../lib/wiki/bedrock.js";

function fakeResponse(text: string) {
  return {
    output: { message: { content: [{ text }] } },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: "end_turn",
  };
}

describe("invokeClaudeJson retry behavior", () => {
  beforeEach(() => {
    sendMock.mockReset();
    // Bypass real backoff delays without fake-timer ceremony.
    vi.stubGlobal("setTimeout", ((cb: () => void) => {
      cb();
      return 0;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries empty responses and returns parsed result with retry count", async () => {
    sendMock
      .mockResolvedValueOnce(fakeResponse(""))
      .mockResolvedValueOnce(fakeResponse(""))
      .mockResolvedValueOnce(fakeResponse('{"ok":true}'));

    const res = await invokeClaudeJson<{ ok: boolean }>({
      system: "s",
      user: "u",
    });

    expect(res.parsed).toEqual({ ok: true });
    expect(res.retries).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("retries truncated JSON SyntaxErrors", async () => {
    // Fenced block with a truncated JSON body — parseJsonResponse hits the
    // fence extractor and JSON.parse throws SyntaxError.
    sendMock
      .mockResolvedValueOnce(fakeResponse('```json\n{"a":1,"b":\n```'))
      .mockResolvedValueOnce(fakeResponse('{"a":1,"b":2}'));

    const res = await invokeClaudeJson<{ a: number; b: number }>({
      system: "s",
      user: "u",
    });

    expect(res.parsed).toEqual({ a: 1, b: 2 });
    expect(res.retries).toBe(1);
  });

  it("throws BedrockRetryExhaustedError after 3 failed attempts", async () => {
    sendMock.mockResolvedValue(fakeResponse(""));

    let caught: unknown;
    try {
      await invokeClaudeJson<unknown>({ system: "s", user: "u" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BedrockRetryExhaustedError);
    expect((caught as BedrockRetryExhaustedError).name).toBe(
      "BedrockRetryExhaustedError",
    );
    expect((caught as BedrockRetryExhaustedError).attempts).toBe(3);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable SDK errors", async () => {
    const err = Object.assign(new Error("denied"), {
      name: "AccessDeniedException",
    });
    sendMock.mockRejectedValue(err);

    await expect(
      invokeClaudeJson<unknown>({ system: "s", user: "u" }),
    ).rejects.toMatchObject({ name: "AccessDeniedException" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("invokeClaudeWithRetry retry behavior", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.stubGlobal("setTimeout", ((cb: () => void) => {
      cb();
      return 0;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries ThrottlingException and returns retry count", async () => {
    const throttle = Object.assign(new Error("slow down"), {
      name: "ThrottlingException",
    });
    sendMock
      .mockRejectedValueOnce(throttle)
      .mockResolvedValueOnce(fakeResponse("hello"));

    const res = await invokeClaudeWithRetry({ system: "s", user: "u" });
    expect(res.text).toBe("hello");
    expect(res.retries).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryableBedrockError", () => {
  it("flags transient SDK exceptions", () => {
    expect(
      isRetryableBedrockError(
        Object.assign(new Error("x"), { name: "ThrottlingException" }),
      ),
    ).toBe(true);
    expect(
      isRetryableBedrockError(
        Object.assign(new Error("x"), {
          name: "ServiceUnavailableException",
        }),
      ),
    ).toBe(true);
  });

  it("flags parseJsonResponse failures", () => {
    expect(
      isRetryableBedrockError(new Error("parseJsonResponse: empty response")),
    ).toBe(true);
    expect(
      isRetryableBedrockError(new SyntaxError("Unexpected end of JSON input")),
    ).toBe(true);
  });

  it("refuses AbortError and unknown fatal errors", () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    expect(isRetryableBedrockError(abortErr)).toBe(false);
    expect(
      isRetryableBedrockError(
        Object.assign(new Error("bad"), { name: "ValidationException" }),
      ),
    ).toBe(false);
    expect(isRetryableBedrockError(new Error("random"))).toBe(false);
    expect(isRetryableBedrockError("string error")).toBe(false);
  });
});

// ─── aliases ─────────────────────────────────────────────────────────────────

import { slugifyTitle, seedAliasesForTitle } from "../lib/wiki/aliases.js";

describe("slugifyTitle", () => {
  it("lowercases and dashes", () => {
    expect(slugifyTitle("Taberna dos Mercadores")).toBe(
      "taberna-dos-mercadores",
    );
  });

  it("strips diacritics and punctuation", () => {
    expect(slugifyTitle("Café Mocha!")).toBe("cafe-mocha");
  });

  it("collapses runs of dashes + trims edges", () => {
    expect(slugifyTitle("  ---Foo & Bar---  ")).toBe("foo-bar");
  });

  it("caps at 120 chars", () => {
    const long = "a".repeat(200);
    expect(slugifyTitle(long).length).toBeLessThanOrEqual(120);
  });
});

describe("seedAliasesForTitle", () => {
  it("emits the normalized title", () => {
    expect(seedAliasesForTitle("Taberna dos Mercadores")).toEqual([
      "taberna dos mercadores",
    ]);
  });

  it("returns [] for punctuation-only input", () => {
    expect(seedAliasesForTitle("!!!")).toEqual([]);
  });
});

// ─── planner validation ──────────────────────────────────────────────────────

import {
  buildPlannerUserPrompt,
  describeOntologySnapshotForPrompt,
  validatePlannerResult,
  _test as plannerTestExports,
} from "../lib/wiki/planner.js";

const validPlan = {
  pageUpdates: [
    {
      pageId: "p1",
      sections: [
        {
          slug: "overview",
          rationale: "new evidence",
          proposed_body_md: "body",
        },
      ],
    },
  ],
  newPages: [
    {
      type: "entity",
      entityTypeSlug: "customer",
      slug: "taberna-dos-mercadores",
      title: "Taberna dos Mercadores",
      sections: [
        { slug: "overview", heading: "Overview", body_md: "Great pastrami." },
      ],
      source_refs: ["r1"],
    },
  ],
  unresolvedMentions: [
    {
      alias: "Chef João",
      suggestedType: "entity",
      context: "mentioned",
      source_ref: "r1",
    },
  ],
  promotions: [
    {
      mentionId: "m1",
      reason: "crossed threshold",
      type: "entity",
      entityTypeSlug: "customer",
      title: "Chef João",
      slug: "chef-joao",
      sections: [{ slug: "overview", heading: "Overview", body_md: "..." }],
    },
  ],
};

describe("validatePlannerResult", () => {
  it("accepts a well-formed plan", () => {
    expect(() => validatePlannerResult(validPlan)).not.toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => validatePlannerResult("nope")).toThrow(/not an object/);
  });

  it("rejects missing top-level arrays", () => {
    const bad = { ...validPlan, pageUpdates: undefined as unknown };
    expect(() => validatePlannerResult(bad)).toThrow(/pageUpdates/);
  });

  it("rejects unknown page types", () => {
    const bad = {
      ...validPlan,
      newPages: [{ ...validPlan.newPages[0], type: "timeline" }],
    };
    expect(() => validatePlannerResult(bad)).toThrow(/type invalid/);
  });

  it("rejects updates with no pageId", () => {
    const bad = {
      ...validPlan,
      pageUpdates: [{ ...validPlan.pageUpdates[0], pageId: "" }],
    };
    expect(() => validatePlannerResult(bad)).toThrow(/pageId missing/);
  });

  it("accepts ontology-shaped metadata on structured candidates", () => {
    const shaped = {
      ...validPlan,
      newPages: [
        {
          ...validPlan.newPages[0],
          entityTypeSlug: "customer",
          sections: [
            {
              ...validPlan.newPages[0].sections[0],
              facetSlug: "overview",
            },
          ],
        },
      ],
      pageLinks: [
        {
          fromType: "entity",
          fromSlug: "taberna-dos-mercadores",
          toType: "entity",
          toSlug: "eric-odom",
          relationshipTypeSlug: "has_stakeholder",
        },
      ],
    };

    expect(() => validatePlannerResult(shaped)).not.toThrow();
  });

  it("drops structured facets without an entityTypeSlug", () => {
    const shaped = {
      ...validPlan,
      newPages: [
        {
          ...validPlan.newPages[0],
          entityTypeSlug: undefined,
          sections: [
            {
              ...validPlan.newPages[0].sections[0],
              facetSlug: "overview",
            },
          ],
        },
      ],
    };

    expect(() => validatePlannerResult(shaped)).not.toThrow();
    expect(shaped.newPages[0].sections[0]).not.toHaveProperty("facetSlug");
  });

  it("rejects malformed ontology slug fields", () => {
    const bad = {
      ...validPlan,
      pageLinks: [
        {
          fromType: "entity",
          fromSlug: "taberna-dos-mercadores",
          toType: "entity",
          toSlug: "eric-odom",
          relationshipTypeSlug: "",
        },
      ],
    };

    expect(() => validatePlannerResult(bad)).toThrow(
      /relationshipTypeSlug must be a non-empty string/,
    );
  });
});

describe("planner system prompt", () => {
  it("warns the planner not to invent business ontology schema", () => {
    expect(plannerTestExports.PLANNER_SYSTEM).toContain(
      "Business ontology guardrails",
    );
    expect(plannerTestExports.PLANNER_SYSTEM).toContain(
      "Do not invent new business entity types",
    );
  });
});

function promptOntologySnapshot() {
  return {
    tenantId: "t1",
    activeVersionId: "version-1",
    activeVersionNumber: 1,
    conservative: false,
    entityTypeSlugs: new Set(["customer", "person"]),
    relationshipTypeSlugs: new Set(["has_stakeholder"]),
    facetTemplateKeys: new Set(["customer:overview"]),
    externalMappingKeys: new Set(),
    entityTypesBySlug: new Map([
      [
        "customer",
        {
          id: "entity-customer",
          slug: "customer",
          name: "Customer",
          broadType: "organization",
          description: null,
          aliases: ["account"],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
    ]),
    relationshipTypesBySlug: new Map([
      [
        "has_stakeholder",
        {
          id: "rel-stakeholder",
          slug: "has_stakeholder",
          name: "Has stakeholder",
          description: null,
          inverseName: "Stakeholder of",
          sourceTypeSlugs: ["customer"],
          targetTypeSlugs: ["person"],
          aliases: [],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
    ]),
    facetTemplatesByKey: new Map([
      [
        "customer:overview",
        {
          key: "customer:overview",
          entityTypeSlug: "customer",
          slug: "overview",
          heading: "Overview",
          facetType: "compiled",
          position: 10,
          sourcePriority: ["hindsight_memory_unit"],
          prompt: null,
          guidanceNotes: null,
          source: "tenant",
        },
      ],
    ]),
    templatesByEntityType: {},
  };
}

describe("buildPlannerUserPrompt", () => {
  const record = {
    id: "r1",
    tenantId: "t1",
    ownerType: "agent" as const,
    ownerId: "a1",
    kind: "event" as const,
    sourceType: "journal_idea",
    status: "active" as const,
    content: { text: "Great pastrami at Taberna" },
    backendRefs: [{ backend: "hindsight", ref: "h1" }],
    createdAt: "2026-04-17T10:00:00Z",
    updatedAt: "2026-04-17T10:00:00Z",
    metadata: {
      place: { name: "Taberna dos Mercadores", photos: ["https://..."] },
      raw: "junk",
    },
  } as any;

  it("includes the record, candidate pages, and mentions sections", () => {
    const prompt = buildPlannerUserPrompt({
      tenantId: "t1",
      ownerId: "a1",
      records: [record],
      candidatePages: [
        {
          id: "p1",
          type: "entity",
          entityTypeSlug: "customer",
          slug: "pastrami-places",
          title: "Pastrami Places",
          summary: null,
          aliases: ["pastrami"],
        },
      ],
      openMentions: [
        {
          id: "m1",
          alias: "Chef João",
          aliasNormalized: "chef joão",
          mentionCount: 2,
          suggestedType: "entity",
        },
      ],
    });
    expect(prompt).toContain("Memory records in this batch");
    expect(prompt).toContain("id=r1");
    expect(prompt).toContain("Candidate pages already in this scope");
    expect(prompt).toContain("id=p1");
    expect(prompt).toContain("Open unresolved mentions in this scope");
    expect(prompt).toContain("id=m1");
    expect(prompt).toContain("Required output JSON shape");
  });

  it("includes active ontology options when a snapshot is supplied", () => {
    const prompt = buildPlannerUserPrompt({
      tenantId: "t1",
      ownerId: "a1",
      records: [record],
      candidatePages: [],
      openMentions: [],
      ontologySnapshot: promptOntologySnapshot() as any,
    });

    expect(prompt).toContain("Approved business ontology");
    expect(prompt).toContain("customer: Customer");
    expect(prompt).toContain("customer:overview");
    expect(prompt).toContain("has_stakeholder");
    expect(prompt).toContain("entityTypeSlug");
    expect(prompt).toContain("relationshipTypeSlug");
  });

  it("describes conservative ontology snapshots without authorizing structured fields", () => {
    const text = describeOntologySnapshotForPrompt({
      ...promptOntologySnapshot(),
      activeVersionId: null,
      activeVersionNumber: null,
      conservative: true,
    } as any);

    expect(text).toContain("No active approved ontology version");
    expect(text).toContain("Do not emit entityTypeSlug");
  });

  it("strips photos + raw from metadata to keep the prompt focused", () => {
    const prompt = buildPlannerUserPrompt({
      tenantId: "t1",
      ownerId: "a1",
      records: [record],
      candidatePages: [],
      openMentions: [],
    });
    expect(prompt).not.toContain("photos");
    expect(prompt).not.toContain("junk");
    expect(prompt).toContain("Taberna dos Mercadores");
  });

  it("compactMetadata drops long strings + photos + raw", () => {
    const out = plannerTestExports.compactMetadata({
      keep: "short",
      drop: "x".repeat(500),
      photos: ["u1"],
      raw: { any: 1 },
      nested: { keep: "ok", drop: "x".repeat(500), photos: ["u2"] },
    });
    expect(out.keep).toBe("short");
    expect(out).not.toHaveProperty("drop");
    expect(out).not.toHaveProperty("photos");
    expect(out).not.toHaveProperty("raw");
    expect((out.nested as any).keep).toBe("ok");
    expect(out.nested as any).not.toHaveProperty("drop");
    expect(out.nested as any).not.toHaveProperty("photos");
  });
});

// ─── section-writer: noise filter ────────────────────────────────────────────

import { isMeaningfulChange } from "../lib/wiki/section-writer.js";

describe("isMeaningfulChange", () => {
  it("returns false for identical strings", () => {
    expect(isMeaningfulChange("Great pastrami.", "Great pastrami.")).toBe(
      false,
    );
  });

  it("returns false for whitespace-only differences", () => {
    expect(isMeaningfulChange("Great  pastrami.", "Great pastrami.")).toBe(
      false,
    );
  });

  it("returns true when moving from empty to non-empty", () => {
    expect(isMeaningfulChange(null, "New body.")).toBe(true);
  });

  it("returns true for substantive changes", () => {
    expect(
      isMeaningfulChange(
        "Great pastrami. Go early.",
        "Great pastrami. Go early; avoid Mondays.",
      ),
    ).toBe(true);
  });

  it("returns false for sub-5% tweaks", () => {
    const existing = "a".repeat(200);
    const proposed = "a".repeat(199) + "b"; // 1 char diff on a 200-char body
    expect(isMeaningfulChange(existing, proposed)).toBe(false);
  });
});

// ─── compiler end-to-end with mocks ──────────────────────────────────────────

// Hoisted mock handles so vi.mock factories can reach them.
const { mockPlacesService } = vi.hoisted(() => ({
  mockPlacesService: {
    resolveBatchPlace: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../lib/wiki/places-service.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/places-service.js");
  return {
    ...actual,
    resolveBatchPlace: (...args: unknown[]) =>
      mockPlacesService.resolveBatchPlace(...args),
  };
});

const {
  mockAdapter,
  mockRepo,
  mockPlanner,
  mockWriter,
  mockGetServices,
  mockLoadOntologyCompileSnapshot,
  mockMaterializer,
  mockBrainRepo,
  testOntologySnapshot,
} = vi.hoisted(() => {
  const testOntologySnapshot = {
    tenantId: "t1",
    activeVersionId: "ontology-version-1",
    activeVersionNumber: 1,
    conservative: false,
    entityTypeSlugs: new Set(["customer", "person"]),
    relationshipTypeSlugs: new Set(["has_stakeholder"]),
    facetTemplateKeys: new Set(["customer:overview"]),
    externalMappingKeys: new Set(),
    entityTypesBySlug: new Map([
      [
        "customer",
        {
          id: "entity-customer",
          slug: "customer",
          name: "Customer",
          broadType: "organization",
          description: null,
          aliases: ["account"],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
    ]),
    relationshipTypesBySlug: new Map([
      [
        "has_stakeholder",
        {
          id: "rel-stakeholder",
          slug: "has_stakeholder",
          name: "Has stakeholder",
          description: null,
          inverseName: "Stakeholder of",
          sourceTypeSlugs: ["customer"],
          targetTypeSlugs: ["person"],
          aliases: [],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
    ]),
    facetTemplatesByKey: new Map([
      [
        "customer:overview",
        {
          key: "customer:overview",
          entityTypeSlug: "customer",
          slug: "overview",
          heading: "Overview",
          facetType: "compiled",
          position: 10,
          sourcePriority: ["hindsight_memory_unit"],
          prompt: null,
          guidanceNotes: null,
          source: "tenant",
        },
      ],
    ]),
    templatesByEntityType: {},
  };
  const mockAdapter = {
    kind: "hindsight" as const,
    listRecordsUpdatedSince: vi.fn(),
  };
  const mockGetServices = vi.fn(() => ({
    adapter: mockAdapter,
    config: { engine: "hindsight" },
  }));
  const mockRepo = {
    getCursor: vi.fn(),
    setCursor: vi.fn(),
    claimCompileJobById: vi.fn(),
    completeCompileJob: vi.fn(),
    findPageById: vi.fn(),
    findPageBySlug: vi.fn().mockResolvedValue(null),
    findAliasMatches: vi.fn().mockResolvedValue([]),
    findAliasMatchesFuzzy: vi.fn().mockResolvedValue([]),
    listPagesForScope: vi.fn().mockResolvedValue([]),
    listOpenMentions: vi.fn().mockResolvedValue([]),
    listPageSections: vi.fn().mockResolvedValue([]),
    upsertPage: vi.fn().mockResolvedValue({
      id: "page-new",
      type: "entity",
      entity_subtype: "customer",
      slug: "page-new",
      title: "page-new",
    }),
    upsertPageLink: vi.fn().mockResolvedValue(true),
    upsertUnresolvedMention: vi.fn(),
    markUnresolvedPromoted: vi.fn(),
    findPagesByExactTitle: vi.fn().mockResolvedValue([]),
    findPagesByFuzzyTitle: vi.fn().mockResolvedValue([]),
    findMemoryUnitPageSources: vi.fn().mockResolvedValue([]),
    bumpSectionLastSeen: vi.fn().mockResolvedValue(0),
    archiveOntologyNonTriplePages: vi.fn().mockResolvedValue(0),
    enqueueCompileJob: vi.fn().mockResolvedValue({
      inserted: false,
      job: {
        id: "chained-job",
        tenant_id: "t1",
        owner_id: "a1",
        trigger: "bootstrap_import",
      },
    }),
    countDuplicateTitleCandidates: vi.fn().mockResolvedValue(0),
    findPlaceById: vi.fn().mockResolvedValue(null),
    findPageByPlaceId: vi.fn().mockResolvedValue(null),
    normalizeAlias: (s: string) => s.toLowerCase().trim(),
  };
  const mockPlanner = { runPlanner: vi.fn() };
  const mockWriter = { writeSection: vi.fn() };
  const mockLoadOntologyCompileSnapshot = vi.fn();
  const mockMaterializer = {
    materializePlannerPageToBrain: vi.fn().mockResolvedValue({
      pageId: "brain-page-1",
      pageUpserted: true,
      facetsWritten: 1,
      sourcesRetained: 1,
    }),
  };
  const mockBrainRepo = {
    findTenantEntityPageBySlug: vi.fn().mockResolvedValue(null),
    upsertTenantEntityPageLink: vi.fn().mockResolvedValue(false),
  };
  return {
    mockAdapter,
    mockRepo,
    mockPlanner,
    mockWriter,
    mockGetServices,
    mockLoadOntologyCompileSnapshot,
    mockMaterializer,
    mockBrainRepo,
    testOntologySnapshot,
  };
});

vi.mock("../lib/memory/index.js", () => ({
  getMemoryServices: mockGetServices,
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/repository.js");
  return {
    ...actual,
    // Leave normalizeAlias / slug helpers as their real implementations;
    // swap the DB-touching helpers.
    getCursor: (...args: unknown[]) => mockRepo.getCursor(...args),
    setCursor: (...args: unknown[]) => mockRepo.setCursor(...args),
    claimCompileJobById: (...args: unknown[]) =>
      mockRepo.claimCompileJobById(...args),
    completeCompileJob: (...args: unknown[]) =>
      mockRepo.completeCompileJob(...args),
    findPageById: (...args: unknown[]) => mockRepo.findPageById(...args),
    findPageBySlug: (...args: unknown[]) => mockRepo.findPageBySlug(...args),
    findAliasMatches: (...args: unknown[]) =>
      mockRepo.findAliasMatches(...args),
    findAliasMatchesFuzzy: (...args: unknown[]) =>
      mockRepo.findAliasMatchesFuzzy(...args),
    listPagesForScope: (...args: unknown[]) =>
      mockRepo.listPagesForScope(...args),
    listOpenMentions: (...args: unknown[]) =>
      mockRepo.listOpenMentions(...args),
    listPageSections: (...args: unknown[]) =>
      mockRepo.listPageSections(...args),
    upsertPage: (...args: unknown[]) => mockRepo.upsertPage(...args),
    upsertPageLink: (...args: unknown[]) => mockRepo.upsertPageLink(...args),
    upsertUnresolvedMention: (...args: unknown[]) =>
      mockRepo.upsertUnresolvedMention(...args),
    markUnresolvedPromoted: (...args: unknown[]) =>
      mockRepo.markUnresolvedPromoted(...args),
    findPagesByExactTitle: (...args: unknown[]) =>
      mockRepo.findPagesByExactTitle(...args),
    findPagesByFuzzyTitle: (...args: unknown[]) =>
      mockRepo.findPagesByFuzzyTitle(...args),
    bumpSectionLastSeen: (...args: unknown[]) =>
      mockRepo.bumpSectionLastSeen(...args),
    archiveOntologyNonTriplePages: (...args: unknown[]) =>
      mockRepo.archiveOntologyNonTriplePages(...args),
    enqueueCompileJob: (...args: unknown[]) =>
      mockRepo.enqueueCompileJob(...args),
    findMemoryUnitPageSources: (...args: unknown[]) =>
      mockRepo.findMemoryUnitPageSources(...args),
    countDuplicateTitleCandidates: (...args: unknown[]) =>
      mockRepo.countDuplicateTitleCandidates(...args),
    findPlaceById: (...args: unknown[]) => mockRepo.findPlaceById(...args),
    findPageByPlaceId: (...args: unknown[]) =>
      mockRepo.findPageByPlaceId(...args),
  };
});

vi.mock("../lib/brain/repository.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/brain/repository.js");
  return {
    ...actual,
    findTenantEntityPageBySlug: (...args: unknown[]) =>
      mockBrainRepo.findTenantEntityPageBySlug(...args),
    upsertTenantEntityPageLink: (...args: unknown[]) =>
      mockBrainRepo.upsertTenantEntityPageLink(...args),
  };
});

vi.mock("../lib/wiki/planner.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/planner.js");
  return {
    ...actual,
    // Swap the Bedrock-calling function; keep pure helpers real.
    runPlanner: (...args: unknown[]) => mockPlanner.runPlanner(...args),
  };
});

vi.mock("../lib/wiki/section-writer.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/section-writer.js");
  return {
    ...actual,
    writeSection: (...args: unknown[]) => mockWriter.writeSection(...args),
  };
});

vi.mock("../lib/ontology/compile-snapshot.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/ontology/compile-snapshot.js");
  return {
    ...actual,
    loadOntologyCompileSnapshot: (...args: unknown[]) =>
      mockLoadOntologyCompileSnapshot(...args),
  };
});

vi.mock("../lib/ontology/materializer.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/ontology/materializer.js");
  return {
    ...actual,
    materializePlannerPageToBrain: (...args: unknown[]) =>
      mockMaterializer.materializePlannerPageToBrain(...args),
  };
});

import { runCompileJob, runJobById } from "../lib/wiki/compiler.js";

const sampleJob = {
  id: "job-1",
  tenant_id: "t1",
  owner_id: "a1",
  dedupe_key: "t1:a1:1",
  status: "running" as const,
  trigger: "memory_retain" as const,
  attempt: 1,
  claimed_at: new Date(),
  started_at: new Date(),
  finished_at: null,
  error: null,
  metrics: null,
  created_at: new Date(),
};

function makeRecord(id: string) {
  return {
    id,
    tenantId: "t1",
    ownerType: "agent" as const,
    ownerId: "a1",
    kind: "event" as const,
    sourceType: "journal_idea" as const,
    status: "active" as const,
    content: { text: `record ${id} text` },
    backendRefs: [{ backend: "hindsight", ref: id }],
    createdAt: "2026-04-18T00:00:00Z",
    updatedAt: "2026-04-18T00:00:00Z",
  };
}

/**
 * Helper: make the adapter return a scripted sequence of pages. Avoids the
 * `clearAllMocks`/`mockResolvedValueOnce` interaction that consumed the queue
 * in this test file. We pass the full sequence and mockImplementation pops
 * them off per call.
 */
function scriptAdapter(
  pages: Array<{
    records: ReturnType<typeof makeRecord>[];
    nextCursor: { updatedAt: Date; recordId: string } | null;
  }>,
): void {
  let i = 0;
  mockAdapter.listRecordsUpdatedSince.mockImplementation(async () => {
    const out = pages[i] ?? { records: [], nextCursor: null };
    i++;
    return out;
  });
}

describe("runCompileJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-install defaults wiped by resetAllMocks.
    mockGetServices.mockImplementation(() => ({
      adapter: mockAdapter,
      config: { engine: "hindsight" },
    }));
    mockRepo.getCursor.mockResolvedValue({
      updatedAt: null,
      recordId: null,
    });
    mockRepo.claimCompileJobById.mockResolvedValue(sampleJob);
    mockRepo.listPagesForScope.mockResolvedValue([]);
    mockRepo.listOpenMentions.mockResolvedValue([]);
    mockRepo.listPageSections.mockResolvedValue([]);
    mockRepo.upsertPage.mockResolvedValue({
      id: "page-new",
      type: "entity",
      entity_subtype: "customer",
      slug: "page-new",
      title: "page-new",
    });
    mockRepo.upsertPageLink.mockResolvedValue(true);
    mockRepo.findPlaceById.mockResolvedValue(null);
    mockRepo.findPageByPlaceId.mockResolvedValue(null);
    mockRepo.findPagesByExactTitle.mockResolvedValue([]);
    mockRepo.findPagesByFuzzyTitle.mockResolvedValue([]);
    mockRepo.bumpSectionLastSeen.mockResolvedValue(0);
    mockRepo.archiveOntologyNonTriplePages.mockResolvedValue(0);
    mockRepo.findMemoryUnitPageSources.mockResolvedValue([]);
    mockRepo.findPageBySlug.mockResolvedValue(null);
    mockRepo.countDuplicateTitleCandidates.mockResolvedValue(0);
    mockRepo.enqueueCompileJob.mockResolvedValue({
      inserted: false,
      job: {
        id: "chained-job",
        tenant_id: "t1",
        owner_id: "a1",
        trigger: "bootstrap_import",
      },
    });
    // No alias collisions by default; individual tests override when
    // exercising the dedup path.
    mockRepo.findAliasMatches.mockResolvedValue([]);
    mockRepo.findAliasMatchesFuzzy.mockResolvedValue([]);
    // Default: no places resolved. Tests that exercise the place_id wire
    // override per-scenario.
    mockPlacesService.resolveBatchPlace.mockResolvedValue(null);
    mockLoadOntologyCompileSnapshot.mockResolvedValue({
      ...testOntologySnapshot,
      activeVersionId: null,
      activeVersionNumber: null,
      conservative: true,
    });
    mockMaterializer.materializePlannerPageToBrain.mockResolvedValue({
      pageId: "brain-page-1",
      pageUpserted: true,
      facetsWritten: 1,
      sourcesRetained: 1,
    });
    mockBrainRepo.findTenantEntityPageBySlug.mockResolvedValue(null);
    mockBrainRepo.upsertTenantEntityPageLink.mockResolvedValue(false);
  });

  it("claims id-targeted jobs before running them", async () => {
    scriptAdapter([{ records: [], nextCursor: null }]);

    const result = await runJobById("job-1");

    expect(result?.status).toBe("succeeded");
    expect(mockRepo.claimCompileJobById).toHaveBeenCalledWith("job-1");
    expect(mockRepo.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "succeeded",
      }),
    );
  });

  it("does not run id-targeted jobs that cannot be claimed", async () => {
    mockRepo.claimCompileJobById.mockResolvedValueOnce(null);

    const result = await runJobById("job-1");

    expect(result).toBeNull();
    expect(mockRepo.getCursor).not.toHaveBeenCalled();
    expect(mockRepo.completeCompileJob).not.toHaveBeenCalled();
  });

  it("creates a new page from the planner's newPages output", async () => {
    scriptAdapter([
      {
        records: [makeRecord("r1"), makeRecord("r2")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r2",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "taberna",
          title: "Taberna dos Mercadores",
          sections: [
            {
              slug: "overview",
              heading: "Overview",
              body_md: "Great pastrami.",
            },
          ],
          source_refs: ["r1", "r2"],
        },
      ],
      unresolvedMentions: [],
      promotions: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(result.metrics.records_read).toBe(2);
    expect(result.metrics.pages_upserted).toBe(1);
    expect(result.metrics.planner_calls).toBe(1);
    expect(result.metrics.ontology_active_version_id).toBeNull();
    expect(mockLoadOntologyCompileSnapshot).toHaveBeenCalledWith({
      tenantId: "t1",
    });
    expect(mockPlanner.runPlanner).toHaveBeenCalledWith(
      expect.objectContaining({
        ontologySnapshot: expect.objectContaining({ conservative: true }),
      }),
      expect.any(Object),
    );
    expect(mockRepo.upsertPage).toHaveBeenCalledTimes(1);
    expect(mockRepo.upsertPage).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "taberna-dos-mercadores",
        entity_subtype: "customer",
      }),
    );
    expect(mockWriter.writeSection).not.toHaveBeenCalled();
    expect(mockRepo.setCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        ownerId: "a1",
        recordId: "r2",
      }),
    );
    expect(mockRepo.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", status: "succeeded" }),
    );
  });

  it("reroutes unapproved ontology-shaped new pages before database writes", async () => {
    mockLoadOntologyCompileSnapshot.mockResolvedValueOnce(testOntologySnapshot);
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r1",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "vendor",
          slug: "sprocket-inc",
          title: "Sprocket Inc",
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Potential vendor.",
              source_refs: ["r1"],
            },
          ],
          source_refs: ["r1"],
        },
      ],
      unresolvedMentions: [],
      promotions: [],
      pageLinks: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(mockRepo.upsertPage).not.toHaveBeenCalled();
    expect(mockRepo.upsertUnresolvedMention).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: "Sprocket Inc",
        suggested_type: "entity",
      }),
    );
    expect(result.metrics.ontology_gate_rejected_pages).toBe(1);
    expect(result.metrics.ontology_gate_unresolved_observations).toBe(1);
    expect(result.metrics.ontology_gate_suggestion_candidates).toBe(1);
  });

  it("reroutes approved ontology pages when they have no relationship triple", async () => {
    mockLoadOntologyCompileSnapshot.mockResolvedValueOnce(testOntologySnapshot);
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r1",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "acme",
          title: "Acme",
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Potential customer.",
              source_refs: ["r1"],
            },
          ],
          source_refs: ["r1"],
        },
      ],
      unresolvedMentions: [],
      promotions: [],
      pageLinks: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(mockRepo.upsertPage).not.toHaveBeenCalled();
    expect(result.metrics.ontology_gate_approved_pages).toBe(1);
    expect(result.metrics.ontology_gate_rejected_isolated_pages).toBe(1);
    expect(mockRepo.upsertUnresolvedMention).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: "Acme",
        suggested_type: "entity",
      }),
    );
  });

  it("approves ontology relationships between existing candidate pages", async () => {
    mockLoadOntologyCompileSnapshot.mockResolvedValueOnce(testOntologySnapshot);
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r1",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockRepo.listPagesForScope.mockResolvedValue([
      {
        id: "page-acme",
        type: "entity",
        entityTypeSlug: "customer",
        slug: "acme",
        title: "Acme",
        summary: null,
        body_md: null,
        last_compiled_at: null,
        backlink_count: 0,
        aliases: [],
      },
      {
        id: "page-eric",
        type: "entity",
        entityTypeSlug: "person",
        slug: "eric-odom",
        title: "Eric Odom",
        summary: null,
        body_md: null,
        last_compiled_at: null,
        backlink_count: 0,
        aliases: [],
      },
    ]);
    mockRepo.findPageBySlug.mockImplementation(async (args: any) => {
      if (args.slug === "acme") return { id: "page-acme" };
      if (args.slug === "eric-odom") return { id: "page-eric" };
      return null;
    });
    mockBrainRepo.findTenantEntityPageBySlug.mockImplementation(
      async (args: any) => ({ id: `brain-${args.subtype}-${args.slug}` }),
    );
    mockBrainRepo.upsertTenantEntityPageLink.mockResolvedValue(true);
    mockRepo.archiveOntologyNonTriplePages.mockResolvedValueOnce(2);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [],
      unresolvedMentions: [],
      promotions: [],
      pageLinks: [
        {
          fromType: "entity",
          fromSlug: "acme",
          toType: "entity",
          toSlug: "eric-odom",
          relationshipTypeSlug: "has_stakeholder",
          context: "Eric is involved with Acme.",
        },
      ],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(result.metrics.ontology_gate_approved_relationships).toBe(1);
    expect(result.metrics.ontology_gate_rejected_relationships).toBe(0);
    expect(result.metrics.ontology_gate_archived_non_triple_pages).toBe(2);
    expect(result.metrics.links_upserted).toBe(1);
    expect(mockRepo.archiveOntologyNonTriplePages).toHaveBeenCalledWith({
      tenantId: "t1",
      ownerId: "a1",
    });
    expect(mockRepo.upsertPageLink).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPageId: "page-acme",
        toPageId: "page-eric",
        kind: "has_stakeholder",
      }),
    );
    expect(mockBrainRepo.upsertTenantEntityPageLink).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPageId: "brain-customer-acme",
        toPageId: "brain-person-eric-odom",
        relationshipSlug: "has_stakeholder",
      }),
    );
  });

  it("mirrors approved ontology-shaped new pages into Brain facets", async () => {
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r1",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "acme",
          title: "Acme",
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Acme is active.",
              source_refs: ["r1"],
            },
          ],
          source_refs: ["r1"],
        },
      ],
      unresolvedMentions: [],
      promotions: [],
      pageLinks: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(mockRepo.upsertPage).toHaveBeenCalled();
    expect(mockMaterializer.materializePlannerPageToBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        page: expect.objectContaining({
          entityTypeSlug: "customer",
          slug: "acme",
        }),
        snapshot: expect.objectContaining({ conservative: true }),
      }),
    );
    expect(result.metrics.brain_pages_upserted).toBe(1);
    expect(result.metrics.brain_facets_written).toBe(1);
  });

  it("queues continuation jobs for scheduler drain instead of invoking itself", async () => {
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r1",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: Array.from({ length: 26 }, (_, i) => ({
        type: "entity" as const,
        entityTypeSlug: "customer",
        slug: `page-${i}`,
        title: `Page ${i}`,
        sections: [
          {
            slug: "overview",
            heading: "Overview",
            body_md: `Page ${i} from r1.`,
          },
        ],
        source_refs: ["r1"],
      })),
      unresolvedMentions: [],
      promotions: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });
    mockRepo.enqueueCompileJob.mockResolvedValueOnce({
      inserted: true,
      job: {
        id: "chained-job",
        tenant_id: "t1",
        owner_id: "a1",
        trigger: "memory_retain",
      },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(result.metrics.cap_hit).toBe("max_new_pages");
    expect(result.metrics.continuation_enqueued).toBe(1);
    expect(mockRepo.enqueueCompileJob).toHaveBeenCalledWith({
      tenantId: "t1",
      ownerId: "a1",
      trigger: "memory_retain",
      nowEpochSeconds: 600,
      dedupeDiscriminator: "continuation-job-1",
    });
    expect(mockRepo.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: expect.objectContaining({
          cap_hit: "max_new_pages",
          continuation_enqueued: 1,
        }),
      }),
    );
  });

  it("stops at the soft time budget and queues continuation after cursor progress", async () => {
    const previousDeadline = process.env.WIKI_COMPILE_SOFT_DEADLINE_MS;
    process.env.WIKI_COMPILE_SOFT_DEADLINE_MS = "1";

    scriptAdapter([
      {
        records: Array.from({ length: 25 }, (_, i) => makeRecord(`r${i + 1}`)),
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r25",
        },
      },
      {
        records: [makeRecord("r26")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:01:00Z"),
          recordId: "r26",
        },
      },
    ]);
    mockPlanner.runPlanner.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        pageUpdates: [],
        newPages: [],
        unresolvedMentions: [],
        promotions: [],
        pageLinks: [],
        usage: { inputTokens: 100, outputTokens: 40 },
      };
    });
    mockRepo.enqueueCompileJob.mockResolvedValueOnce({
      inserted: true,
      job: {
        id: "chained-job",
        tenant_id: "t1",
        owner_id: "a1",
        trigger: "memory_retain",
      },
    });

    try {
      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.records_read).toBe(25);
      expect(result.metrics.cap_hit).toBe("soft_time_budget");
      expect(result.metrics.soft_time_budget_hit).toBe(true);
      expect(result.metrics.aggregation_skipped_time_budget).toBe(true);
      expect(result.metrics.continuation_enqueued).toBe(1);
      expect(mockRepo.setCursor).toHaveBeenCalledWith({
        tenantId: "t1",
        ownerId: "a1",
        updatedAt: new Date("2026-04-18T00:00:00Z"),
        recordId: "r25",
      });
      expect(mockRepo.enqueueCompileJob).toHaveBeenCalledWith({
        tenantId: "t1",
        ownerId: "a1",
        trigger: "memory_retain",
        nowEpochSeconds: 600,
        dedupeDiscriminator: "continuation-job-1",
      });
      expect(mockAdapter.listRecordsUpdatedSince).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDeadline === undefined) {
        delete process.env.WIKI_COMPILE_SOFT_DEADLINE_MS;
      } else {
        process.env.WIKI_COMPILE_SOFT_DEADLINE_MS = previousDeadline;
      }
    }
  });

  it("calls section-writer only for sections with meaningful changes", async () => {
    const existingPage = {
      id: "p-existing",
      tenant_id: "t1",
      owner_id: "a1",
      type: "entity" as const,
      slug: "taberna",
      title: "Taberna",
      summary: null,
      body_md: null,
      status: "active" as const,
      last_compiled_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: {
          updatedAt: new Date("2026-04-18T00:00:00Z"),
          recordId: "r1",
        },
      },
      { records: [], nextCursor: null },
    ]);
    mockRepo.findPageById.mockResolvedValue(existingPage);
    mockRepo.listPageSections.mockResolvedValue([
      {
        id: "s1",
        section_slug: "overview",
        heading: "Overview",
        body_md: "Existing body that stays the same",
        position: 1,
        last_source_at: null,
      },
      {
        id: "s2",
        section_slug: "notes",
        heading: "Notes",
        body_md: "Old notes",
        position: 2,
        last_source_at: null,
      },
    ]);
    mockWriter.writeSection.mockResolvedValue({
      body_md: "Fully revised notes body.",
      inputTokens: 50,
      outputTokens: 30,
      modelId: "haiku",
    });
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [
        {
          pageId: "p-existing",
          sections: [
            {
              slug: "overview",
              rationale: "no change really",
              proposed_body_md: "Existing body that stays the same",
            },
            {
              slug: "notes",
              rationale: "reinforces prior",
              proposed_body_md:
                "Fully revised notes body with new evidence and a long tail to exceed noise threshold.",
            },
          ],
        },
      ],
      newPages: [],
      unresolvedMentions: [],
      promotions: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(mockWriter.writeSection).toHaveBeenCalledTimes(1);
    expect(result.metrics.sections_skipped).toBe(1);
    expect(result.metrics.sections_rewritten).toBe(1);
  });

  it("accumulates unresolved mentions and promotes when planner says so", async () => {
    scriptAdapter([
      {
        records: [makeRecord("r1")],
        nextCursor: null, // explicit drain
      },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [],
      unresolvedMentions: [
        {
          alias: "Chef João",
          suggestedType: "entity",
          context: "mentioned at taberna",
          source_ref: "r1",
        },
      ],
      promotions: [
        {
          mentionId: "m-existing",
          reason: "seen four times",
          type: "entity",
          entityTypeSlug: "customer",
          title: "Maria Santos",
          slug: "maria-santos",
          sections: [{ slug: "overview", heading: "Overview", body_md: "..." }],
        },
      ],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(result.metrics.unresolved_upserted).toBe(1);
    expect(result.metrics.unresolved_promoted).toBe(1);
    expect(mockRepo.markUnresolvedPromoted).toHaveBeenCalledWith({
      mentionId: "m-existing",
      pageId: "page-new",
    });
  });

  it("fails the job (not throws) when the planner explodes", async () => {
    scriptAdapter([
      { records: [makeRecord("r1")], nextCursor: null },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockRejectedValueOnce(new Error("bedrock 500"));

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("bedrock 500");
    expect(mockRepo.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(mockRepo.setCursor).not.toHaveBeenCalled();
  });

  it("fails cleanly when the adapter lacks listRecordsUpdatedSince", async () => {
    const brokenAdapter = { kind: "agentcore" } as any;
    const result = await runCompileJob(sampleJob, { adapter: brokenAdapter });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/listRecordsUpdatedSince/);
  });

  it("suppresses legacy deterministic linkers when active ontology is present", async () => {
    mockLoadOntologyCompileSnapshot.mockResolvedValueOnce(testOntologySnapshot);
    scriptAdapter([
      { records: [makeRecord("r1")], nextCursor: null },
      { records: [], nextCursor: null },
    ]);
    mockPlanner.runPlanner.mockResolvedValueOnce({
      pageUpdates: [],
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "just-a-page",
          title: "Just a Page",
          sections: [
            {
              slug: "overview",
              heading: "Overview",
              body_md: "Plain.",
            },
          ],
          source_refs: ["r1"],
        },
      ],
      unresolvedMentions: [],
      promotions: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    mockRepo.countDuplicateTitleCandidates.mockResolvedValue(3);

    const result = await runCompileJob(sampleJob);

    expect(result.status).toBe("succeeded");
    expect(result.metrics.links_written_deterministic).toBe(0);
    expect(result.metrics.links_written_co_mention).toBe(0);
    expect(result.metrics.deterministic_linking_ontology_suppressed).toBe(true);
    expect(result.metrics.duplicate_candidates_count).toBe(3);
    expect(mockRepo.findPagesByExactTitle).not.toHaveBeenCalled();
    expect(mockRepo.findMemoryUnitPageSources).not.toHaveBeenCalled();
  });

  it("suppresses legacy aggregation when active ontology is present", async () => {
    mockLoadOntologyCompileSnapshot.mockResolvedValueOnce(testOntologySnapshot);
    const restore = process.env.WIKI_AGGREGATION_PASS_ENABLED;
    process.env.WIKI_AGGREGATION_PASS_ENABLED = "true";
    try {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      mockPlanner.runPlanner.mockResolvedValueOnce({
        pageUpdates: [],
        newPages: [
          {
            type: "entity",
            entityTypeSlug: "customer",
            slug: "slug-x",
            title: "Title X",
            sections: [
              {
                slug: "overview",
                heading: "Overview",
                body_md: "Plain.",
              },
            ],
            source_refs: ["r1"],
          },
        ],
        unresolvedMentions: [],
        promotions: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const result = await runCompileJob(sampleJob);
      expect(result.status).toBe("succeeded");
      expect(result.metrics.aggregation_ontology_suppressed).toBe(true);
    } finally {
      if (restore === undefined) {
        delete process.env.WIKI_AGGREGATION_PASS_ENABLED;
      } else {
        process.env.WIKI_AGGREGATION_PASS_ENABLED = restore;
      }
    }
  });

  it("records deterministic_linking_flag_suppressed when the flag is off", async () => {
    const restore = process.env.WIKI_DETERMINISTIC_LINKING_ENABLED;
    process.env.WIKI_DETERMINISTIC_LINKING_ENABLED = "false";
    try {
      mockLoadOntologyCompileSnapshot.mockResolvedValueOnce({
        ...testOntologySnapshot,
        activeVersionId: null,
        conservative: true,
      });
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      mockPlanner.runPlanner.mockResolvedValueOnce({
        pageUpdates: [],
        newPages: [
          {
            type: "entity",
            entityTypeSlug: "customer",
            slug: "slug-x",
            title: "Title X",
            sections: [
              {
                slug: "overview",
                heading: "Overview",
                body_md: "Plain.",
              },
            ],
            source_refs: ["r1"],
          },
        ],
        unresolvedMentions: [],
        promotions: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const result = await runCompileJob(sampleJob);
      expect(result.status).toBe("succeeded");
      expect(result.metrics.deterministic_linking_flag_suppressed).toBe(true);
      expect(result.metrics.links_written_deterministic).toBe(0);
      expect(result.metrics.links_written_co_mention).toBe(0);
      // Repo helpers under the flag gate must never be touched.
      expect(mockRepo.findPagesByExactTitle).not.toHaveBeenCalled();
      expect(mockRepo.findMemoryUnitPageSources).not.toHaveBeenCalled();
    } finally {
      if (restore === undefined) {
        delete process.env.WIKI_DETERMINISTIC_LINKING_ENABLED;
      } else {
        process.env.WIKI_DETERMINISTIC_LINKING_ENABLED = restore;
      }
    }
  });

  // ─── Fuzzy alias dedupe (pg_trgm fallback) ──────────────────────────
  //
  // maybeMergeIntoExistingPage runs exact alias match first and falls
  // through to trigram similarity only when exact misses. These tests
  // pin the gates: type mismatch never merges, archived pages don't
  // resurrect, pg_trgm-unavailable is a graceful fall-back to create-
  // new-page (via the helper's internal try/catch).
  describe("runCompileJob → fuzzy alias dedupe", () => {
    function plannerWithNewPage(title: string, slug: string): void {
      mockPlanner.runPlanner.mockResolvedValueOnce({
        pageUpdates: [],
        newPages: [
          {
            type: "entity",
            entityTypeSlug: "customer",
            slug,
            title,
            sections: [
              {
                slug: "overview",
                heading: "Overview",
                body_md: "body",
              },
            ],
            source_refs: ["r1"],
          },
        ],
        unresolvedMentions: [],
        promotions: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    }

    it("folds a newPage into an existing entity when a 0.90+ trigram alias match exists (same type)", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Austin, TX", "austin-tx");
      mockRepo.findAliasMatchesFuzzy.mockResolvedValue([
        {
          pageId: "existing-austin",
          aliasId: "alias-1",
          aliasText: "austin",
          similarity: 0.91,
          pageType: "entity",
          pageStatus: "active",
        },
      ]);
      mockRepo.findPageById.mockResolvedValue({
        id: "existing-austin",
        tenant_id: "t1",
        owner_id: "a1",
        type: "entity",
        entity_subtype: "customer",
        slug: "austin",
        title: "Austin",
        status: "active",
      });

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.fuzzy_dedupe_merges).toBe(1);
      expect(result.metrics.alias_dedup_merged).toBeFalsy();
      // Merged via the existing page's slug, not the planner's proposed one.
      expect(mockRepo.upsertPage).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "austin" }),
      );
    });

    it("does NOT merge when the trigram match is on a page of a different type (type-mismatch gate)", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Austin", "austin");
      // Fuzzy match exists but on a `topic` page — proposal is `entity`.
      mockRepo.findAliasMatchesFuzzy.mockResolvedValue([
        {
          pageId: "topic-austin",
          aliasId: "alias-1",
          aliasText: "austin",
          similarity: 0.95,
          pageType: "topic",
          pageStatus: "active",
        },
      ]);

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.fuzzy_dedupe_merges ?? 0).toBe(0);
      expect(result.metrics.alias_dedup_merged ?? 0).toBe(0);
      // A new entity page was created (didn't merge into the topic).
      expect(mockRepo.findPageById).not.toHaveBeenCalledWith("topic-austin");
    });

    it("skips fuzzy hits on archived pages (no silent resurrect)", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Austin", "austin-new");
      // Repo helper already filters `status=active`, but we double-gate
      // at the merge function too. Simulate a rogue archived row slipping
      // past the query.
      mockRepo.findAliasMatchesFuzzy.mockResolvedValue([
        {
          pageId: "archived-austin",
          aliasId: "alias-1",
          aliasText: "austin",
          similarity: 0.97,
          pageType: "entity",
          pageStatus: "archived",
        },
      ]);
      mockRepo.findPageById.mockResolvedValue({
        id: "archived-austin",
        tenant_id: "t1",
        owner_id: "a1",
        type: "entity",
        entity_subtype: "customer",
        slug: "austin",
        title: "Austin",
        status: "archived",
      });

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.fuzzy_dedupe_merges ?? 0).toBe(0);
    });

    it("prefers exact-match hits when both exact and fuzzy would match (metric lands under alias_dedup_merged, not fuzzy)", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      // Title slugs differently from the existing page's slug so the
      // merge path actually fires (short-circuit skips when slugs match).
      plannerWithNewPage("Austin Texas", "austin-texas-unused");
      mockRepo.findAliasMatches.mockResolvedValue([
        {
          pageId: "existing-austin",
          aliasId: "alias-1",
          aliasText: "austin",
        },
      ]);
      mockRepo.findPageById.mockResolvedValue({
        id: "existing-austin",
        tenant_id: "t1",
        owner_id: "a1",
        type: "entity",
        entity_subtype: "customer",
        slug: "austin",
        title: "Austin",
        status: "active",
      });

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.alias_dedup_merged).toBe(1);
      expect(result.metrics.fuzzy_dedupe_merges ?? 0).toBe(0);
      // Fuzzy helper is never even consulted when exact resolved.
      expect(mockRepo.findAliasMatchesFuzzy).not.toHaveBeenCalled();
    });

    it("falls through cleanly when both exact and fuzzy return empty (creates the newPage)", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Paris", "paris");
      // Default mocks: both findAliasMatches & findAliasMatchesFuzzy
      // return []. The fuzzy helper internally swallows pg_trgm errors so
      // a missing extension looks identical to this case.

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.pages_upserted).toBe(1);
      expect(result.metrics.fuzzy_dedupe_merges ?? 0).toBe(0);
      expect(result.metrics.alias_dedup_merged ?? 0).toBe(0);
    });
  });

  describe("runCompileJob → places integration", () => {
    function plannerWithNewPage(title: string, slug: string) {
      mockPlanner.runPlanner.mockResolvedValueOnce({
        pageUpdates: [],
        newPages: [
          {
            type: "entity",
            entityTypeSlug: "customer",
            slug,
            title,
            sections: [
              { slug: "overview", heading: "Overview", body_md: "body" },
            ],
            source_refs: ["r1"],
          },
        ],
        unresolvedMentions: [],
        promotions: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    }

    it("passes resolved place_id to upsertPage when places-service returns one", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Café", "cafe");
      mockPlacesService.resolveBatchPlace.mockResolvedValueOnce({
        placeId: "place-42",
      });

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(mockPlacesService.resolveBatchPlace).toHaveBeenCalled();
      const upsertCall = mockRepo.upsertPage.mock.calls.find(
        (c: unknown[]) => (c[0] as { slug?: string }).slug === "cafe",
      );
      expect(upsertCall).toBeDefined();
      expect((upsertCall![0] as { place_id?: string }).place_id).toBe(
        "place-42",
      );
    });

    it("disables legacy place backing pages for active ontology compiles", async () => {
      mockLoadOntologyCompileSnapshot.mockResolvedValueOnce(
        testOntologySnapshot,
      );
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      mockRepo.listPagesForScope.mockResolvedValue([
        {
          id: "page-eric",
          type: "entity",
          entityTypeSlug: "person",
          slug: "eric-odom",
          title: "Eric Odom",
          summary: null,
          body_md: null,
          last_compiled_at: null,
          backlink_count: 0,
          aliases: [],
        },
      ]);
      mockRepo.findPageBySlug.mockImplementation(async (args: any) => {
        if (args.slug === "cafe") return { id: "page-cafe" };
        if (args.slug === "eric-odom") return { id: "page-eric" };
        return null;
      });
      mockPlacesService.resolveBatchPlace.mockResolvedValueOnce({
        placeId: "place-42",
      });
      mockPlanner.runPlanner.mockResolvedValueOnce({
        pageUpdates: [],
        newPages: [
          {
            type: "entity",
            entityTypeSlug: "customer",
            slug: "cafe",
            title: "Cafe",
            sections: [
              {
                slug: "overview",
                facetSlug: "overview",
                heading: "Overview",
                body_md: "body",
                source_refs: ["r1"],
              },
            ],
            source_refs: ["r1"],
          },
        ],
        unresolvedMentions: [],
        promotions: [],
        pageLinks: [
          {
            fromType: "entity",
            fromSlug: "cafe",
            toType: "entity",
            toSlug: "eric-odom",
            relationshipTypeSlug: "has_stakeholder",
            context: "Eric mentioned Cafe.",
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(mockPlacesService.resolveBatchPlace).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ materializeBackingPages: false }),
      );
    });

    it("passes place_id=null when places-service returns null (default path)", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Acme", "acme");

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      const upsertCall = mockRepo.upsertPage.mock.calls.find(
        (c: unknown[]) => (c[0] as { slug?: string }).slug === "acme",
      );
      expect(upsertCall).toBeDefined();
      expect((upsertCall![0] as { place_id?: unknown }).place_id).toBeNull();
    });

    it("emits a hierarchy reference edge and increments links_written_place", async () => {
      mockLoadOntologyCompileSnapshot.mockResolvedValueOnce({
        ...testOntologySnapshot,
        activeVersionId: null,
        conservative: true,
      });
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Louvre", "louvre");
      mockPlacesService.resolveBatchPlace.mockResolvedValueOnce({
        placeId: "poi-paris",
      });
      // upsertPage returns a page row that carries the place_id so the
      // hierarchy emitter has something to walk from.
      mockRepo.upsertPage.mockImplementation(async (input: any) => ({
        id: `page-${input.slug}`,
        type: input.type,
        slug: input.slug,
        title: input.title,
        place_id: input.place_id ?? null,
      }));
      mockRepo.findPlaceById.mockResolvedValue({
        id: "poi-paris",
        parent_place_id: "place-city-paris",
      });
      mockRepo.findPageByPlaceId.mockResolvedValue({
        id: "page-city-paris",
      });
      mockRepo.upsertPageLink.mockResolvedValue(true);

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.links_written_place).toBe(1);
      const linkCall = mockRepo.upsertPageLink.mock.calls.find((c: unknown[]) =>
        (c[0] as { context?: string }).context?.startsWith(
          "deterministic:place:",
        ),
      );
      expect(linkCall).toBeDefined();
      expect((linkCall![0] as { fromPageId?: string }).fromPageId).toBe(
        "page-louvre",
      );
      expect((linkCall![0] as { toPageId?: string }).toPageId).toBe(
        "page-city-paris",
      );
    });

    it("skips hierarchy emission when the place is top-of-hierarchy", async () => {
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("France", "france");
      mockPlacesService.resolveBatchPlace.mockResolvedValueOnce({
        placeId: "country-fr",
      });
      mockRepo.upsertPage.mockImplementation(async (input: any) => ({
        id: `page-${input.slug}`,
        type: input.type,
        slug: input.slug,
        title: input.title,
        place_id: input.place_id ?? null,
      }));
      mockRepo.findPlaceById.mockResolvedValue({
        id: "country-fr",
        parent_place_id: null, // top of hierarchy
      });
      mockRepo.upsertPageLink.mockResolvedValue(true);

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.links_written_place).toBe(0);
      expect(mockRepo.findPageByPlaceId).not.toHaveBeenCalled();
    });

    it("does not double-count when upsertPageLink hits ON CONFLICT DO NOTHING", async () => {
      mockLoadOntologyCompileSnapshot.mockResolvedValueOnce({
        ...testOntologySnapshot,
        activeVersionId: null,
        conservative: true,
      });
      scriptAdapter([
        { records: [makeRecord("r1")], nextCursor: null },
        { records: [], nextCursor: null },
      ]);
      plannerWithNewPage("Louvre", "louvre");
      mockPlacesService.resolveBatchPlace.mockResolvedValueOnce({
        placeId: "poi-paris",
      });
      mockRepo.upsertPage.mockImplementation(async (input: any) => ({
        id: `page-${input.slug}`,
        type: input.type,
        slug: input.slug,
        title: input.title,
        place_id: input.place_id ?? null,
      }));
      mockRepo.findPlaceById.mockResolvedValue({
        id: "poi-paris",
        parent_place_id: "place-city-paris",
      });
      mockRepo.findPageByPlaceId.mockResolvedValue({
        id: "page-city-paris",
      });
      // Re-run hits the existing edge — upsertPageLink returns false.
      mockRepo.upsertPageLink.mockResolvedValue(false);

      const result = await runCompileJob(sampleJob);

      expect(result.status).toBe("succeeded");
      expect(result.metrics.links_written_place).toBe(0);
    });
  });
});
