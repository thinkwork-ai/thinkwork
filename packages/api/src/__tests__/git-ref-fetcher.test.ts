import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGitRefAsFileTree } from "../lib/git-ref-fetcher.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchGitRefAsFileTree", () => {
  it("fetches a GitHub zipball and strips the archive root folder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          await githubZip({
            "repo-main/.claude/agents/expenses/CONTEXT.md": "# Expenses",
          }),
        ),
      ),
    );

    const result = await fetchGitRefAsFileTree({
      url: "https://github.com/acme/fog.git",
      ref: "main",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.files).toEqual({
      ".claude/agents/expenses/CONTEXT.md": "# Expenses",
    });
  });

  it("rejects repos with submodules", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          await githubZip({
            "repo-main/.gitmodules": "[submodule]",
          }),
        ),
      ),
    );

    const result = await fetchGitRefAsFileTree({
      url: "git@github.com:acme/fog.git",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("submodules");
  });

  it("rejects non-GitHub refs in v1", async () => {
    const result = await fetchGitRefAsFileTree({
      url: "https://gitlab.com/acme/fog.git",
    });
    expect(result.ok).toBe(false);
  });
});

async function githubZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(entries)) zip.file(path, text);
  return zip.generateAsync({ type: "nodebuffer" });
}

function response(buffer: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
  } as Response;
}
