import { describe, expect, it, vi } from "vitest";
import {
  createDocumentComposerExtension,
  FALLBACK_PLATES,
  normalizeDocumentPlates,
  EMIT_DOCUMENT_TOOL_NAME,
  EMIT_DOCUMENT_DIGEST_MAX_BYTES,
  extractAnalyticsFenceNumbers,
} from "../src/document-composer.js";
import { parseSourcesClaims, toolNamesMatch } from "../src/document-plates.js";
import { collectExtensionToolNames } from "../src/define-extension.js";

const CONFIG = {
  apiUrl: "https://api.example/",
  apiSecret: "secret",
  tenantId: "tenant-1",
  threadId: "thread-1",
  threadTurnId: "turn-1",
  agentId: "agent-1",
};

interface RegisteredTool {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: undefined,
    onUpdate?: undefined,
    ctx?: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
}

/**
 * Fake ExtensionContext whose session branch invoked the given tools.
 * `options.resultTexts[i]` becomes tool i's result payload and
 * `options.userText` a trailing user message — the provenance corpus the
 * THINK-681 analytics gate reads.
 */
function ctxWithInvokedTools(
  toolNames: string[],
  options: { resultTexts?: string[]; userText?: string } = {},
): unknown {
  const userEntries = options.userText
    ? [
        {
          type: "message",
          id: "u0",
          parentId: null,
          timestamp: "t",
          message: {
            role: "user",
            content: [{ type: "text", text: options.userText }],
          },
        },
      ]
    : [];
  return {
    sessionManager: {
      getBranch: () => [
        ...userEntries,
        ...toolNames.flatMap((name, i) => [
          {
            type: "message",
            id: `a${i}`,
            parentId: null,
            timestamp: "t",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "calling" },
                { type: "toolCall", id: `call-${i}`, name, arguments: {} },
              ],
            },
          },
          {
            type: "message",
            id: `r${i}`,
            parentId: `a${i}`,
            timestamp: "t",
            message: {
              role: "toolResult",
              toolCallId: `call-${i}`,
              toolName: name,
              content: options.resultTexts?.[i]
                ? [{ type: "text", text: options.resultTexts[i] }]
                : [],
              isError: false,
            },
          },
        ]),
      ],
    },
  };
}

function register(
  options: Parameters<typeof createDocumentComposerExtension>[0],
) {
  const tools: RegisteredTool[] = [];
  const extension = createDocumentComposerExtension(options);
  extension.register(
    { registerTool: (tool: RegisteredTool) => tools.push(tool) } as never,
    {} as never,
  );
  return { extension, tools };
}

const VALID_PARAMS = {
  genre: "report",
  title: "Q3 Report",
  abstract: "Numbers are up.",
  digest_markdown: "## Summary\n\nNumbers up 18% this quarter.",
};

function okFetch(body: Record<string, unknown>): typeof fetch {
  return vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("createDocumentComposerExtension", () => {
  it("folds emit_document into toolNames when wiring is present (allowlist)", () => {
    const { extension } = register({ documentComposerConfig: CONFIG });
    expect(extension.toolNames).toEqual([EMIT_DOCUMENT_TOOL_NAME]);
    expect(collectExtensionToolNames([extension])).toContain(
      EMIT_DOCUMENT_TOOL_NAME,
    );
  });

  it("registers no tool without wiring fields", () => {
    const { extension, tools } = register({
      documentComposerConfig: { ...CONFIG, apiSecret: "" },
    });
    expect(extension.toolNames).toEqual([]);
    expect(tools).toHaveLength(0);
  });

  it("happy path returns the artifact id and revision instruction", async () => {
    const fetchImpl = okFetch({
      ok: true,
      artifactId: "artifact-1",
      documentId: "doc-1",
      status: "final",
      headVersion: 2,
    });
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl,
    });
    const result = await tools[0].execute("call-1", {
      ...VALID_PARAMS,
      status: "final",
    });
    expect(result.content[0].text).toContain("pinned version 2");
    expect(result.content[0].text).toContain("doc-1");
    expect(result.details?.artifactId).toBe("artifact-1");

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/api/threads/thread-1/activity");
    const body = JSON.parse(String(init.body));
    expect(body.document.genre).toBe("report");
    // v2 contract: the tool posts digestMarkdown and NO renderHtml field —
    // the platform compiles the render server-side (THINK-154 R1).
    expect(body.document.digestMarkdown).toContain("## Summary");
    expect("renderHtml" in body.document).toBe(false);
    expect(body.thread_turn_id).toBe("turn-1");
  });

  it("returns server diagnostics verbatim as the tool result (R7)", async () => {
    const diagnostics = [
      {
        code: "UNKNOWN_DIRECTIVE",
        message: 'Directive "tw:hologram" is not in the component vocabulary.',
        location: "tw:hologram",
      },
    ];
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl: okFetch({
        ok: false,
        code: "COMPILE_REJECTED",
        diagnostics,
      }),
    });
    const result = await tools[0].execute("call-1", VALID_PARAMS);
    expect(result.content[0].text).toContain("REJECTED");
    expect(result.content[0].text).toContain("tw:hologram");
    expect(result.details?.code).toBe("REJECTED");
  });

  it("surfaces non-blocking compile warnings on success", async () => {
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl: okFetch({
        ok: true,
        artifactId: "artifact-1",
        documentId: "doc-1",
        status: "draft",
        headVersion: 0,
        warnings: [
          {
            code: "FRONTMATTER_UNKNOWN_KEY",
            message: 'Frontmatter key "banana" is not supported.',
            location: "frontmatter",
          },
        ],
      }),
    });
    const result = await tools[0].execute("call-1", VALID_PARAMS);
    expect(result.content[0].text).toContain("Document saved");
    expect(result.content[0].text).toContain("banana");
  });

  it("fast-fails an oversize digest locally without a network call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute("call-1", {
      ...VALID_PARAMS,
      digest_markdown: "x".repeat(EMIT_DOCUMENT_DIGEST_MAX_BYTES + 1),
    });
    expect(result.content[0].text).toContain("SIZE_CEILING");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("soft genre check: malformed slug rejects locally, unlisted slug still ships (R11)", async () => {
    const fetchImpl = okFetch({
      ok: false,
      code: "COMPILE_REJECTED",
      diagnostics: [
        {
          code: "UNKNOWN_GENRE",
          message:
            'Genre "novel" is not registered. Valid genres: report, plan.',
          location: "genre",
        },
      ],
    });
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl,
    });
    // Shape violation fails fast locally...
    await expect(
      tools[0].execute("call-1", { ...VALID_PARAMS, genre: "Not A Slug" }),
    ).rejects.toThrow(/lowercase slug/);
    // ...but a well-formed unlisted slug goes to the server, whose
    // self-repair rejection surfaces verbatim through the failure path.
    const result = await tools[0].execute("call-1", {
      ...VALID_PARAMS,
      genre: "novel",
    });
    expect(result.content[0].text).toContain("UNKNOWN_GENRE");
    expect(result.content[0].text).toContain("Valid genres: report, plan");
  });

  it("composes the tool surface from payload plates (KTD4)", () => {
    const { tools } = register({
      documentComposerConfig: {
        ...CONFIG,
        documentPlates: [
          {
            slug: "qbr",
            displayName: "QBR",
            useFor: "Quarterly business review for a client.",
          },
          {
            slug: "proposal",
            displayName: "Proposal",
            useFor: "A commercial proposal.",
          },
        ],
      },
      fetchImpl: okFetch({ ok: true }),
    });
    const tool = tools[0] as unknown as {
      description: string;
      parameters: { properties: { genre: { description: string } } };
    };
    expect(tool.description).toContain("qbr");
    expect(tool.description).toContain("proposal");
    expect(tool.parameters.properties.genre.description).toContain(
      "Quarterly business review for a client.",
    );
    expect(tool.parameters.properties.genre.description).not.toContain(
      "ideation",
    );
  });

  it("payload absent → core-4 fallback + structured log event", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { tools } = register({
        documentComposerConfig: CONFIG,
        fetchImpl: okFetch({ ok: true }),
      });
      const tool = tools[0] as unknown as {
        parameters: { properties: { genre: { description: string } } };
      };
      for (const plate of FALLBACK_PLATES) {
        expect(tool.parameters.properties.genre.description).toContain(
          plate.slug,
        );
      }
      const logged = logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((line) => line.includes("document_plates_missing_from_payload"));
      expect(logged).toBeTruthy();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("malformed plates field is treated as absent, not a throw", () => {
    expect(normalizeDocumentPlates("junk")).toBeNull();
    expect(normalizeDocumentPlates({ slug: "x" })).toBeNull();
    expect(normalizeDocumentPlates([{ slug: "NOT VALID" }, 42])).toBeNull();
    expect(
      normalizeDocumentPlates([
        { slug: "qbr", displayName: "QBR", useFor: "x" },
        "garbage",
      ]),
    ).toEqual([{ slug: "qbr", displayName: "QBR", useFor: "x" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { tools } = register({
        documentComposerConfig: { ...CONFIG, documentPlates: "garbage" },
        fetchImpl: okFetch({ ok: true }),
      });
      expect(tools).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("surfaces FORBIDDEN refusals as text, and throws on HTTP failure", async () => {
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl: okFetch({
        ok: false,
        code: "FORBIDDEN",
        error: "not a member",
      }),
    });
    const refused = await tools[0].execute("call-1", VALID_PARAMS);
    expect(refused.content[0].text).toContain("FORBIDDEN");

    const { tools: tools2 } = register({
      documentComposerConfig: CONFIG,
      fetchImpl: vi.fn(async () => ({
        status: 500,
        ok: false,
        json: async () => ({ ok: false, error: "boom", code: "INTERNAL" }),
      })) as unknown as typeof fetch,
    });
    await expect(tools2[0].execute("call-1", VALID_PARAMS)).rejects.toThrow(
      "HTTP 500",
    );
  });
});

describe("plate content contracts on the tool surface (THINK-183 U6)", () => {
  const CONTRACT_PLATE = {
    slug: "sales-rep-review",
    displayName: "Sales Rep Review",
    useFor: "A sales rep performance review.",
    authoringInstructions:
      "Write for sales leadership; lead with a summary and visualize trends.",
    sections: [
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material" as const,
        guidance: "Funnel stages with conversion rates vs the team median.",
        suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
      },
      { id: "summary", title: "Summary", tier: "required" as const },
    ],
    analyses: [
      {
        key: "pipeline-conversion",
        op: "funnel_conversion",
        inputHint: "ordered stages: [{ label, count }], >=2 stages",
        guidance: "Use pipeline stages from the CRM, current quarter only.",
      },
    ],
  };

  it("normalizeDocumentPlates preserves contract fields (incl. instructions + chart hints)", () => {
    const plates = normalizeDocumentPlates([CONTRACT_PLATE]);
    expect(plates).toEqual([CONTRACT_PLATE]);
  });

  it("malformed contract fields degrade to a plain summary, never a throw", () => {
    const plates = normalizeDocumentPlates([
      {
        slug: "qbr",
        displayName: "QBR",
        useFor: "x",
        sections: "junk",
        analyses: [{ key: "NOT VALID", op: 42 }, "garbage"],
      },
    ]);
    expect(plates).toEqual([{ slug: "qbr", displayName: "QBR", useFor: "x" }]);
  });

  it("tool surface names expected section titles and analysis input hints (R14 floor)", () => {
    const { tools } = register({
      documentComposerConfig: {
        ...CONFIG,
        documentPlates: [CONTRACT_PLATE],
      },
      fetchImpl: okFetch({ ok: true }),
    });
    const tool = tools[0] as unknown as {
      description: string;
      parameters: { properties: { genre: { description: string } } };
    };
    const genreDesc = tool.parameters.properties.genre.description;
    expect(genreDesc).toContain('"## Pipeline Health"');
    // Operator-authored section instructions ride the tool surface
    // pre-emission (plates feedback 2026-07-21) — the model must author
    // from them, not discover them via rejection diagnostics.
    expect(genreDesc).toContain(
      "Funnel stages with conversion rates vs the team median.",
    );
    expect(genreDesc).toContain("waive via tw:waiver");
    expect(genreDesc).toContain("pipeline-conversion");
    expect(genreDesc).toContain(
      "op funnel_conversion: ordered stages: [{ label, count }], >=2 stages",
    );
    // Analysis instructions ride the surface too (plates feedback 2026-07-21).
    expect(genreDesc).toContain(
      "Use pipeline stages from the CRM, current quarter only.",
    );
    // Round 2 (regression fix): the contract must read as a FLOOR — the
    // "follow each section's instructions" framing made models author
    // manifest-only minimal documents with no charts.
    expect(genreDesc).toContain("a floor, NOT the full outline");
    expect(genreDesc).toContain("must cover — Funnel stages");
    expect(genreDesc).toContain("suggested visualization: chart funnel");
    expect(genreDesc).toContain(
      "operator authoring instructions for this genre: Write for sales leadership",
    );
    expect(tool.description).toContain("The contract is a FLOOR");
    expect(tool.description).toContain("tw:stats / tw:chart");
    // The contract authoring rules land in the tool description once any
    // plate carries a contract.
    expect(tool.description).toContain("tw:waiver");
    expect(tool.description).toContain("tw:analysis");
  });

  it("success details carry plate identity + per-section outcomes for the thread activity row", async () => {
    const fetchImpl = okFetch({
      ok: true,
      artifactId: "artifact-1",
      documentId: "doc-1",
      status: "final",
      headVersion: 1,
      plate: { slug: "sales-rep-review", displayName: "Sales Rep Review" },
      sections: [
        {
          id: "summary",
          title: "Summary",
          tier: "required",
          status: "present",
        },
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "required-if-material",
          status: "waived",
        },
      ],
    });
    const { tools } = register({
      documentComposerConfig: {
        ...CONFIG,
        documentPlates: [CONTRACT_PLATE],
      },
      fetchImpl,
    });
    const result = await tools[0].execute("call-1", {
      ...VALID_PARAMS,
      genre: "sales-rep-review",
      status: "final",
    });
    expect(result.details?.plate).toMatchObject({
      slug: "sales-rep-review",
      displayName: "Sales Rep Review",
    });
    expect(result.details?.genre).toBe("sales-rep-review");
    expect(result.details?.title).toBeDefined();
    expect(result.details?.sections).toHaveLength(2);
    expect(result.content[0].text).toContain("plate: Sales Rep Review");
    expect(result.content[0].text).toContain(
      "Waived sections: Pipeline Health",
    );
  });

  it("contract-less plate lists keep the plain surface (no contract prose)", () => {
    const { tools } = register({
      documentComposerConfig: {
        ...CONFIG,
        documentPlates: [
          { slug: "qbr", displayName: "QBR", useFor: "Quarterly review." },
        ],
      },
      fetchImpl: okFetch({ ok: true }),
    });
    const tool = tools[0] as unknown as { description: string };
    expect(tool.description).not.toContain("tw:waiver");
  });
});

describe("tw:sources ledger cross-check (plates provenance 2026-07)", () => {
  /** Minimal fake ExtensionContext whose session invoked the given tools. */
  function ctxWithInvoked(toolNames: string[]): never {
    const entries = [
      ...toolNames.map((name, i) => ({
        type: "message",
        id: `a-${i}`,
        parentId: null,
        timestamp: "t",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            { type: "toolCall", id: `call-${i}`, name, arguments: {} },
          ],
        },
      })),
      ...toolNames.map((name, i) => ({
        type: "message",
        id: `r-${i}`,
        parentId: `a-${i}`,
        timestamp: "t",
        message: {
          role: "toolResult",
          toolCallId: `call-${i}`,
          toolName: name,
          content: [],
          isError: false,
        },
      })),
    ];
    return {
      sessionManager: { getBranch: () => entries },
    } as never;
  }

  const SOURCED_MARKDOWN = `## Summary

Numbers up 18%.

\`\`\`tw:sources
section: summary
- tool: twenty--crm.search_records — opportunities for the rep (72 records)
\`\`\`
`;

  const PARAMS = {
    ...VALID_PARAMS,
    digest_markdown: SOURCED_MARKDOWN,
  };

  const OK_BODY = {
    ok: true,
    artifactId: "artifact-1",
    documentId: "doc-1",
    status: "draft",
    headVersion: 0,
  };

  async function execute(
    params: Record<string, unknown>,
    ctx: unknown,
    fetchImpl: typeof fetch = okFetch(OK_BODY),
  ) {
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const tool = tools[0] as unknown as {
      execute: (
        id: string,
        params: Record<string, unknown>,
        signal?: unknown,
        onUpdate?: unknown,
        ctx?: unknown,
      ) => Promise<{
        content: Array<{ type: string; text: string }>;
        details?: Record<string, unknown>;
      }>;
    };
    return {
      result: await tool.execute("call-1", params, undefined, undefined, ctx),
      fetchImpl,
    };
  }

  it("accepts claims that match invoked tools exactly and POSTs", async () => {
    const { result, fetchImpl } = await execute(
      PARAMS,
      ctxWithInvoked(["twenty--crm.search_records"]),
    );
    expect(result.content[0].text).toContain("Document saved");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });

  it("accepts leniently: a namespaced MCP invocation matches the claimed suffix form", async () => {
    const { result } = await execute(
      PARAMS,
      ctxWithInvoked(["mcp_twenty--crm_search_records"]),
    );
    expect(result.content[0].text).toContain("Document saved");
  });

  it("rejects unmatched claims with SOURCES_UNVERIFIED and does NOT POST", async () => {
    const fetchImpl = okFetch(OK_BODY);
    const { result } = await execute(
      PARAMS,
      ctxWithInvoked(["bash", "mcp_lastmile-data_query"]),
      fetchImpl,
    );
    expect(result.details?.code).toBe("REJECTED");
    const diagnostics = result.details?.diagnostics as Array<
      Record<string, unknown>
    >;
    expect(diagnostics[0].code).toBe("SOURCES_UNVERIFIED");
    expect(String(diagnostics[0].message)).toContain(
      "twenty--crm.search_records",
    );
    expect(String(diagnostics[0].message)).toContain("mcp_lastmile-data_query");
    expect(String(diagnostics[0].message)).toContain(
      "Only cite tools you actually called",
    );
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("`- none:` entries skip verification entirely", async () => {
    const { result } = await execute(
      {
        ...VALID_PARAMS,
        digest_markdown:
          "## Summary\n\nText.\n\n```tw:sources\nsection: summary\n- none: narrative synthesis\n```\n",
      },
      ctxWithInvoked([]),
    );
    expect(result.content[0].text).toContain("Document saved");
  });

  it("skips gracefully when ctx/sessionManager is unavailable (logs, still POSTs)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { result, fetchImpl } = await execute(PARAMS, undefined);
      expect(result.content[0].text).toContain("Document saved");
      expect(
        (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(1);
      const logged = logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((line) => line.includes("document_sources_crosscheck_skipped"));
      expect(logged).toBeTruthy();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("skips gracefully when the session manager throws", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const throwingCtx = {
        sessionManager: {
          getBranch: () => {
            throw new Error("session exploded");
          },
        },
      } as never;
      const { result } = await execute(PARAMS, throwingCtx);
      expect(result.content[0].text).toContain("Document saved");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("documents tw:sources on the tool surface", () => {
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl: okFetch({ ok: true }),
    });
    const tool = tools[0] as unknown as { description: string };
    expect(tool.description).toContain("tw:sources");
    expect(tool.description).toContain("- none:");
    expect(tool.description).toContain("VERIFIED against the tools");
  });
});

describe("parseSourcesClaims + toolNamesMatch (document-plates)", () => {
  it("extracts tool names from canonical and untyped tw:sources fences", () => {
    const markdown = [
      "## A",
      "",
      "```tw:sources",
      "section: a",
      "- tool: alpha_tool — q1",
      "- none: narrative",
      "```",
      "",
      "```",
      "tw:sources",
      "section: b",
      "- tool: beta.tool: q2",
      "```",
      "",
      "```sql",
      "SELECT 1 -- not a sources fence",
      "```",
    ].join("\n");
    expect(parseSourcesClaims(markdown)).toEqual([
      { sectionId: "a", tools: ["alpha_tool"] },
      { sectionId: "b", tools: ["beta.tool"] },
    ]);
  });

  it("matches tool names leniently across namespacing, case, and separators", () => {
    expect(toolNamesMatch("some_tool", "some_tool")).toBe(true);
    expect(toolNamesMatch("Some-Tool", "some_tool")).toBe(true);
    expect(
      toolNamesMatch(
        "twenty--crm.search_records",
        "mcp_twenty--crm_search_records",
      ),
    ).toBe(true);
    expect(
      toolNamesMatch(
        "mcp_twenty--crm_search_records",
        "twenty--crm.search_records",
      ),
    ).toBe(true);
    expect(toolNamesMatch("unrelated_tool", "some_tool")).toBe(false);
    expect(toolNamesMatch("", "some_tool")).toBe(false);
  });
});

describe("tw:sources ledger cross-check (plates provenance 2026-07)", () => {
  const SOURCED_PARAMS = {
    genre: "report",
    title: "Q3 Report",
    abstract: "Numbers are up.",
    digest_markdown: `## Summary

Numbers up 18% this quarter.

\`\`\`tw:sources
section: summary
- tool: twenty--crm.search_records — opportunities for the rep (72 records)
\`\`\`
`,
  };

  it("documents tw:sources on the tool description", () => {
    const { tools } = register({ documentComposerConfig: CONFIG });
    const tool = tools[0] as unknown as { description: string };
    expect(tool.description).toContain("tw:sources");
    expect(tool.description).toContain("- none:");
    expect(tool.description).toContain("VERIFIED against the tools");
  });

  it("accepts claims matching invoked tools (exact and namespaced forms)", async () => {
    const fetchImpl = okFetch({
      ok: true,
      artifactId: "artifact-1",
      documentId: "doc-1",
      status: "draft",
      headVersion: 0,
    });
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      SOURCED_PARAMS,
      undefined,
      undefined,
      // Namespaced MCP form of the claimed tool: must still match.
      ctxWithInvokedTools(["mcp_twenty--crm_search_records"]),
    );
    expect(result.content[0].text).toContain("Document saved");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });

  it("rejects unmatched claims with SOURCES_UNVERIFIED and does not POST", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      SOURCED_PARAMS,
      undefined,
      undefined,
      ctxWithInvokedTools(["web_search", "bash"]),
    );
    expect(result.details?.code).toBe("REJECTED");
    const diagnostics = result.details?.diagnostics as Array<
      Record<string, unknown>
    >;
    expect(diagnostics[0].code).toBe("SOURCES_UNVERIFIED");
    expect(String(diagnostics[0].message)).toContain(
      "twenty--crm.search_records",
    );
    expect(String(diagnostics[0].message)).toContain("web_search");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("`- none:` entries need no invocation and skip verification", async () => {
    const fetchImpl = okFetch({
      ok: true,
      artifactId: "artifact-1",
      documentId: "doc-1",
      status: "draft",
      headVersion: 0,
    });
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      {
        ...SOURCED_PARAMS,
        digest_markdown:
          "## Summary\n\nText.\n\n```tw:sources\nsection: summary\n- none: narrative only\n```\n",
      },
      undefined,
      undefined,
      ctxWithInvokedTools([]),
    );
    expect(result.content[0].text).toContain("Document saved");
  });

  it("skips the cross-check gracefully without ctx / sessionManager", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const fetchImpl = okFetch({
        ok: true,
        artifactId: "artifact-1",
        documentId: "doc-1",
        status: "draft",
        headVersion: 0,
      });
      const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
      // No 5th argument at all — legacy hosts and unit harnesses.
      const result = await tools[0].execute("call-1", SOURCED_PARAMS);
      expect(result.content[0].text).toContain("Document saved");
      const logged = logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((line) => line.includes("document_sources_crosscheck_skipped"));
      expect(logged).toBeTruthy();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("parseSourcesClaims / toolNamesMatch", () => {
  it("extracts claims from canonical and untyped fences", () => {
    const markdown = [
      "## A",
      "",
      "```tw:sources",
      "section: a",
      "- tool: tool_one — q1",
      "- none: narrative",
      "```",
      "",
      "```",
      "tw:sources",
      "section: b",
      "- tool: tool_two: q2",
      "```",
      "",
      "```sql",
      "SELECT 1; -- not a sources fence",
      "```",
    ].join("\n");
    expect(parseSourcesClaims(markdown)).toEqual([
      { sectionId: "a", tools: ["tool_one"] },
      { sectionId: "b", tools: ["tool_two"] },
    ]);
  });

  it("matches leniently across MCP namespacing, but never on substrings", () => {
    expect(toolNamesMatch("bash", "bash")).toBe(true);
    expect(
      toolNamesMatch(
        "twenty--crm.search_records",
        "mcp_twenty--crm_search_records",
      ),
    ).toBe(true);
    expect(
      toolNamesMatch("mcp_lastmile-data_query", "lastmile-data.query"),
    ).toBe(true);
    expect(toolNamesMatch("search_records", "web_search")).toBe(false);
    // Mid-name fragments never match — only boundary-aligned prefix/suffix.
    expect(toolNamesMatch("crm", "twenty_crm_search")).toBe(false);
    expect(toolNamesMatch("made_up_tool", "bash")).toBe(false);
  });
});

describe("tw:chart / tw:analysis numeric provenance (THINK-681)", () => {
  const CHART_DIGEST = `## Pipeline

\`\`\`tw:chart
type: bar
title: Pipeline by stage
series:
  - { label: Leads, count: 120 }
  - { label: Won, count: 30 }
\`\`\`
`;

  const ROWS = '{"rows":[{"stage":"Leads","n":120},{"stage":"Won","n":30}]}';

  function okBody() {
    return {
      ok: true,
      artifactId: "artifact-1",
      documentId: "doc-1",
      status: "draft",
      headVersion: 0,
    };
  }

  it("extracts the data numbers out of both fence forms, skipping labels", () => {
    const bare = `\`\`\`
tw:analysis
analysis: pipeline-conversion
title: Q3 funnel 2024
stages:
  - { label: Leads, count: 120 }
  - { label: Won, count: 30 }
\`\`\``;
    expect(extractAnalyticsFenceNumbers(CHART_DIGEST)).toEqual([120, 30]);
    expect(extractAnalyticsFenceNumbers(bare)).toEqual([120, 30]);
    // Fences that are not analytics directives contribute nothing.
    expect(
      extractAnalyticsFenceNumbers('```json\n{ "total": 999 }\n```'),
    ).toEqual([]);
  });

  it("accepts charted numbers a tool returned this turn", async () => {
    const fetchImpl = okFetch(okBody());
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      { ...VALID_PARAMS, digest_markdown: CHART_DIGEST },
      undefined,
      undefined,
      ctxWithInvokedTools(["mcp_lastmile-data_query"], {
        resultTexts: [ROWS],
      }),
    );
    expect(result.content[0].text).toContain("Document saved");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });

  it("accepts numbers derived from fetched data", async () => {
    const fetchImpl = okFetch(okBody());
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const derived = `## Conversion

\`\`\`tw:chart
type: bar
title: Conversion
series:
  - { label: Win rate, count: 25 }
  - { label: Lost, count: 90 }
\`\`\`
`;
    const result = await tools[0].execute(
      "call-1",
      { ...VALID_PARAMS, digest_markdown: derived },
      undefined,
      undefined,
      ctxWithInvokedTools(["mcp_lastmile-data_query"], {
        resultTexts: [ROWS],
      }),
    );
    expect(result.content[0].text).toContain("Document saved");
  });

  it("rejects invented numbers with ANALYTICS_UNVERIFIED and does not POST", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      { ...VALID_PARAMS, digest_markdown: CHART_DIGEST },
      undefined,
      undefined,
      ctxWithInvokedTools(["mcp_lastmile-data_query"], {
        resultTexts: ['{"rows":[{"stage":"Leads","n":7}]}'],
      }),
    );
    expect(result.details?.code).toBe("REJECTED");
    expect(result.content[0].text).toContain("ANALYTICS_UNVERIFIED");
    expect(result.content[0].text).toContain("tw:chart");
    expect(result.content[0].text).toContain("120");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects charts when the turn fetched nothing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      { ...VALID_PARAMS, digest_markdown: CHART_DIGEST },
      undefined,
      undefined,
      ctxWithInvokedTools([]),
    );
    expect(result.content[0].text).toContain("ANALYTICS_UNVERIFIED");
    expect(result.content[0].text).toContain("NO tool returned data this turn");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts numbers the user supplied in the branch's latest message", async () => {
    const fetchImpl = okFetch(okBody());
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute(
      "call-1",
      { ...VALID_PARAMS, digest_markdown: CHART_DIGEST },
      undefined,
      undefined,
      ctxWithInvokedTools([], {
        userText: "Chart my figures: 120 leads and 30 won.",
      }),
    );
    expect(result.content[0].text).toContain("Document saved");
  });

  it("skips the check gracefully without a session manager", async () => {
    const fetchImpl = okFetch(okBody());
    const { tools } = register({ documentComposerConfig: CONFIG, fetchImpl });
    const result = await tools[0].execute("call-1", {
      ...VALID_PARAMS,
      digest_markdown: CHART_DIGEST,
    });
    expect(result.content[0].text).toContain("Document saved");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });

  it("documents the numeric verification on the tool description", () => {
    const { tools } = register({ documentComposerConfig: CONFIG });
    const tool = tools[0] as unknown as { description: string };
    expect(tool.description).toContain("NUMBERS inside");
  });
});
