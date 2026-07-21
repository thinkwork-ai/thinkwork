import { describe, expect, it, vi } from "vitest";
import {
  createDocumentComposerExtension,
  FALLBACK_PLATES,
  normalizeDocumentPlates,
  EMIT_DOCUMENT_TOOL_NAME,
  EMIT_DOCUMENT_DIGEST_MAX_BYTES,
} from "../src/document-composer.js";
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
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
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
    sections: [
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material" as const,
        guidance: "Funnel stages with conversion rates vs the team median.",
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

  it("normalizeDocumentPlates preserves contract fields", () => {
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
