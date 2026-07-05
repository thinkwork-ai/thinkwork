import { describe, expect, it, vi } from "vitest";
import {
  createDocumentComposerExtension,
  DOCUMENT_GENRES,
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

  it("rejects an unknown genre locally", async () => {
    const { tools } = register({
      documentComposerConfig: CONFIG,
      fetchImpl: okFetch({ ok: true }),
    });
    await expect(
      tools[0].execute("call-1", { ...VALID_PARAMS, genre: "novel" }),
    ).rejects.toThrow(DOCUMENT_GENRES.join(", "));
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
