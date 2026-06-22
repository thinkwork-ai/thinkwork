import { describe, expect, it } from "vitest";

import type {
  OkfWikiNavigatorProvider,
  OkfWikiNavigatorReadResult,
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
