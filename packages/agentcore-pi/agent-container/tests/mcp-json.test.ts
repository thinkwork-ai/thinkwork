/**
 * Plan §006 U1 — tests for the mcp.json workspace-file reader.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MCP_JSON_FILENAME,
  McpJsonError,
  readMcpJson,
} from "../src/runtime/mcp-json.js";

let workspaceDir: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "mcp-json-test-"));
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

async function writeMcpJson(content: string): Promise<void> {
  await writeFile(path.join(workspaceDir, MCP_JSON_FILENAME), content, "utf-8");
}

describe("readMcpJson", () => {
  it("returns an empty config when mcp.json is missing", async () => {
    const result = await readMcpJson(workspaceDir);
    expect(result).toEqual({ directTools: [] });
  });

  it("returns an empty config when mcp.json is empty", async () => {
    await writeMcpJson("");
    const result = await readMcpJson(workspaceDir);
    expect(result).toEqual({ directTools: [] });
  });

  it("returns an empty config when mcp.json is whitespace", async () => {
    await writeMcpJson("   \n\t  ");
    const result = await readMcpJson(workspaceDir);
    expect(result).toEqual({ directTools: [] });
  });

  it("parses two directTools entries and preserves order", async () => {
    await writeMcpJson(
      JSON.stringify({
        directTools: [
          { server: "slack", tool: "search" },
          { server: "github", tool: "list_repos" },
        ],
      }),
    );
    const result = await readMcpJson(workspaceDir);
    expect(result.directTools).toEqual([
      { server: "slack", tool: "search" },
      { server: "github", tool: "list_repos" },
    ]);
  });

  it("preserves exact server/tool casing", async () => {
    await writeMcpJson(
      JSON.stringify({
        directTools: [{ server: "GitHub", tool: "ListRepos" }],
      }),
    );
    const result = await readMcpJson(workspaceDir);
    expect(result.directTools).toEqual([
      { server: "GitHub", tool: "ListRepos" },
    ]);
  });

  it("treats { directTools: [] } as a valid empty config", async () => {
    await writeMcpJson(JSON.stringify({ directTools: [] }));
    const result = await readMcpJson(workspaceDir);
    expect(result.directTools).toEqual([]);
  });

  it("treats omitted directTools as empty", async () => {
    await writeMcpJson(JSON.stringify({}));
    const result = await readMcpJson(workspaceDir);
    expect(result.directTools).toEqual([]);
  });

  it("preserves unknown top-level keys for forward-compat", async () => {
    await writeMcpJson(
      JSON.stringify({
        directTools: [],
        futureField: { lifecycle: "lazy" },
        anotherUnknown: 42,
      }),
    );
    const result = await readMcpJson(workspaceDir);
    expect(result.futureField).toEqual({ lifecycle: "lazy" });
    expect(result.anotherUnknown).toBe(42);
  });

  it("trims surrounding whitespace from server/tool", async () => {
    await writeMcpJson(
      JSON.stringify({
        directTools: [{ server: "  slack  ", tool: "  search  " }],
      }),
    );
    const result = await readMcpJson(workspaceDir);
    expect(result.directTools).toEqual([{ server: "slack", tool: "search" }]);
  });

  describe("malformed input", () => {
    it("throws McpJsonError naming the file when JSON is invalid", async () => {
      await writeMcpJson("{ this is not json");
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(/mcp\.json/);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(/invalid JSON/);
    });

    it("throws when the top-level value is an array", async () => {
      await writeMcpJson(JSON.stringify([{ server: "x", tool: "y" }]));
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(
        /top-level value must be a JSON object/,
      );
    });

    it("throws when the top-level value is null", async () => {
      await writeMcpJson("null");
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
    });

    it("throws when the top-level value is a string", async () => {
      await writeMcpJson(JSON.stringify("hello"));
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
    });

    it("throws when directTools is a string", async () => {
      await writeMcpJson(JSON.stringify({ directTools: "slack:search" }));
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(
        /`directTools` must be an array/,
      );
    });

    it("throws when a directTools entry is an array", async () => {
      await writeMcpJson(
        JSON.stringify({ directTools: [["slack", "search"]] }),
      );
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(
        /`directTools\[0\]` must be an object/,
      );
    });

    it("throws when a directTools entry omits server", async () => {
      await writeMcpJson(JSON.stringify({ directTools: [{ tool: "search" }] }));
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(
        /`directTools\[0\]\.server` is required/,
      );
    });

    it("throws when a directTools entry omits tool", async () => {
      await writeMcpJson(
        JSON.stringify({ directTools: [{ server: "slack" }] }),
      );
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(McpJsonError);
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(
        /`directTools\[0\]\.tool` is required/,
      );
    });

    it("includes the entry index in the error message for the second bad entry", async () => {
      await writeMcpJson(
        JSON.stringify({
          directTools: [
            { server: "slack", tool: "search" },
            { server: "github" },
          ],
        }),
      );
      await expect(readMcpJson(workspaceDir)).rejects.toThrow(
        /`directTools\[1\]\.tool` is required/,
      );
    });
  });
});
