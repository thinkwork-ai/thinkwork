import { describe, expect, it } from "vitest";

import type {
  OkfWikiNavigatorProvider,
  OkfWikiNavigatorReadResult,
} from "../src/okf-wiki-navigator.js";
import {
  okfWikiContextTraceFromToolInvocation,
  okfWikiContextTraceMessage,
} from "../src/okf-wiki-navigator.js";

function makeStub(files: Record<string, string>): OkfWikiNavigatorProvider {
  const store = new Map(Object.entries(files));
  return {
    async list() {
      return {
        entries: [...store.keys()].map((path) => ({ path, kind: "file" })),
        bounds: {
          maxResults: 100,
          maxBytes: 64_000,
          maxDepth: 4,
          truncated: false,
        },
      };
    },
    async search(request) {
      const entries = [...store.entries()]
        .filter(([, content]) => content.includes(request.query))
        .map(([path, content]) => ({
          path,
          line: 1,
          snippet: content,
        }))
        .slice(0, request.maxResults ?? 20);
      return {
        entries,
        bounds: {
          maxResults: request.maxResults ?? 20,
          maxBytes: request.maxBytes ?? 64_000,
          maxDepth: request.maxDepth ?? 4,
          truncated:
            [...store.values()].filter((content) =>
              content.includes(request.query),
            ).length > entries.length,
        },
      };
    },
    async read(request): Promise<OkfWikiNavigatorReadResult> {
      const content = store.get(request.path);
      if (content === undefined) throw new Error("missing");
      return {
        path: request.path,
        content,
        offsetBytes: request.offsetBytes ?? 0,
        bytesRead: Buffer.byteLength(content),
        truncated: false,
        redaction: {
          source: "okf_navigator",
          policy: "cite_or_summarize_only",
        },
      };
    },
    async links(request) {
      return {
        path: request.path,
        links: [],
        backlinks: [],
        bounds: {
          maxResults: request.maxResults ?? 20,
          maxBytes: 64_000,
          maxDepth: 4,
          truncated: false,
        },
      };
    },
  };
}

describe("OkfWikiNavigatorProvider contract", () => {
  const provider = makeStub({
    "entities/customer/acme.md": "# Acme\nRevenue signal",
    "topics/revenue.md": "# Revenue\nAcme",
  });

  it("lists OKF-relative paths without tenant or host path details", async () => {
    const result = await provider.list();

    expect(result.entries.map((entry) => entry.path)).toEqual([
      "entities/customer/acme.md",
      "topics/revenue.md",
    ]);
    expect(result.entries[0]!.path).not.toContain("/mnt/");
  });

  it("returns bounded search metadata and untrusted-source read policy", async () => {
    const search = await provider.search({ query: "Acme", maxResults: 5 });
    expect(search.bounds).toMatchObject({ maxResults: 5, truncated: false });
    expect(search.entries).toContainEqual(
      expect.objectContaining({
        path: "entities/customer/acme.md",
        line: 1,
      }),
    );

    await expect(
      provider.read({ path: "entities/customer/acme.md" }),
    ).resolves.toMatchObject({
      redaction: {
        source: "okf_navigator",
        policy: "cite_or_summarize_only",
      },
    });
  });
});

describe("OKF wiki trace evidence", () => {
  it("extracts sanitized trace details from tool invocations", () => {
    const trace = okfWikiContextTraceFromToolInvocation({
      id: "call-1",
      tool_name: "wiki_rg",
      result: {
        details: {
          okfWikiTrace: {
            surface: "okf_efs",
            tool: "wiki_rg",
            query: "Acme",
            path: "topics",
            mountRoot: "/mnt/thinkwork-okf/tenants/acme/current",
            s3Key: "tenants/acme/okf/current.json",
            entries: [
              {
                path: "topics/acme.md",
                title: "Acme",
                source: "s3://thinkwork-okf/tenants/acme/private.md",
                absolutePath:
                  "/mnt/thinkwork-okf/tenants/acme/current/topics/acme.md",
              },
            ],
            bounds: {
              maxResults: 5,
              maxDepth: 2,
              maxBytes: 128_000,
              truncated: true,
            },
            redaction: {
              source: "okf_navigator",
              policy: "cite_or_summarize_only",
            },
          },
        },
      },
    });

    expect(trace).toMatchObject({
      surface: "okf_efs",
      tool: "wiki_rg",
      tool_call_id: "call-1",
      query: "Acme",
      path: "topics",
      truncated: true,
      bounds: expect.objectContaining({ maxResults: 5 }),
      redaction: {
        source: "okf_navigator",
        policy: "cite_or_summarize_only",
      },
    });
    expect(JSON.stringify(trace)).not.toContain("/mnt/thinkwork-okf");
    expect(JSON.stringify(trace)).not.toContain("s3://");
    expect(JSON.stringify(trace)).not.toContain("s3Key");
    expect(okfWikiContextTraceMessage(trace!)).toBe(
      'OKF wiki search returned 1 item for "Acme"',
    );
  });

  it("ignores non-navigator trace echoes", () => {
    expect(
      okfWikiContextTraceFromToolInvocation({
        id: "call-2",
        tool_name: "web_search",
        result: {
          details: {
            okfWikiTrace: {
              surface: "okf_efs",
              tool: "web_search",
            },
          },
        },
      }),
    ).toBeNull();
  });
});
