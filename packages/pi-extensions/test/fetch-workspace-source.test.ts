import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FETCH_WORKSPACE_SOURCE_TOOL_NAME,
  createFetchWorkspaceSourceExtension,
  type FetchedBaselineFile,
  type FetchWorkspaceSourceHost,
} from "../src/fetch-workspace-source.js";
import { toExtensionFactory } from "../src/define-extension.js";

const NO_SIGNAL = undefined;
const NO_UPDATE = undefined;
const NO_CTX = undefined as never;

const CONFIG = {
  apiUrl: "https://api.example.com/",
  apiSecret: "secret",
  tenantId: "tenant-1",
  threadId: "thread-1",
  threadTurnId: "turn-1",
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, tools };
}

async function makeHost(objects: Record<string, string | Uint8Array>) {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "fetch-ws-"));
  cleanups.push(() => rm(workspaceDir, { recursive: true, force: true }));
  const appended: FetchedBaselineFile[][] = [];
  const host: FetchWorkspaceSourceHost = {
    workspaceDir,
    downloadObject: async (key: string) => {
      const value = objects[key];
      if (value === undefined) throw new Error(`download failed for ${key}`);
      return typeof value === "string"
        ? new TextEncoder().encode(value)
        : value;
    },
    appendToBaseline: (files) => {
      appended.push([...files]);
    },
  };
  return { workspaceDir, host, appended };
}

async function buildTool(input: {
  fetchImpl: typeof fetch;
  host: FetchWorkspaceSourceHost;
  activeSpaceFolder?: string;
}) {
  const { api, tools } = makeFakeApi();
  const extension = createFetchWorkspaceSourceExtension({
    fetchSourceConfig: {
      ...CONFIG,
      activeSpaceFolder: input.activeSpaceFolder,
    },
    host: input.host,
    fetchImpl: input.fetchImpl,
  });
  await toExtensionFactory(extension, {})(api);
  const tool = tools.find((t) => t.name === FETCH_WORKSPACE_SOURCE_TOOL_NAME);
  if (!tool) throw new Error("fetch_workspace_source not registered");
  return { extension, tool };
}

function endpointResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function successBody(files: Array<{ key: string; relPath: string }>) {
  return {
    outcome: "success",
    files: files.map((file, index) => ({
      key: file.key,
      relPath: file.relPath,
      etag: `etag-${index}`,
      size: 10,
    })),
  };
}

function resultText(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}

async function listTempResidue(workspaceDir: string): Promise<string[]> {
  const entries = await readdir(workspaceDir);
  return entries.filter((entry) => entry.startsWith(".fetch-tmp-"));
}

describe("fetch_workspace_source — gating", () => {
  it("registers no tool when config is incomplete or the host is missing", async () => {
    const { host } = await makeHost({});
    const noHost = createFetchWorkspaceSourceExtension({
      fetchSourceConfig: CONFIG,
      host: null,
    });
    expect(noHost.toolNames).toEqual([]);

    const noSecret = createFetchWorkspaceSourceExtension({
      fetchSourceConfig: { ...CONFIG, apiSecret: "" },
      host,
    });
    expect(noSecret.toolNames).toEqual([]);

    const noTurn = createFetchWorkspaceSourceExtension({
      fetchSourceConfig: { ...CONFIG, threadTurnId: "" },
      host,
    });
    expect(noTurn.toolNames).toEqual([]);

    const complete = createFetchWorkspaceSourceExtension({
      fetchSourceConfig: CONFIG,
      host,
    });
    expect(complete.toolNames).toEqual([FETCH_WORKSPACE_SOURCE_TOOL_NAME]);
  });
});

describe("fetch_workspace_source — mounting (AE1)", () => {
  it("mounts Space files read-only under Spaces/<slug>/ and appends the diff baseline", async () => {
    const { workspaceDir, host, appended } = await makeHost({
      "tenants/acme/spaces/research-b/source/NOTES.md": "# B notes\n",
      "tenants/acme/spaces/research-b/source/docs/PLAN.md": "plan body\n",
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      endpointResponse(
        successBody([
          {
            key: "tenants/acme/spaces/research-b/source/NOTES.md",
            relPath: "NOTES.md",
          },
          {
            key: "tenants/acme/spaces/research-b/source/docs/PLAN.md",
            relPath: "docs/PLAN.md",
          },
        ]),
      ),
    );
    const { tool } = await buildTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host,
    });

    const result = await tool.execute(
      "call-1",
      { kind: "space", slug: "research-b", listed_in_routing: true },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    // Endpoint contract: bearer + tenant header + thread/turn body.
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/workspaces/fetch-source");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe(
      "tenant-1",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "space",
      slug: "research-b",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      listedInRouting: true,
    });

    // Files are mounted at the routing-tree path, contents intact.
    const mounted = path.join(workspaceDir, "Spaces/research-b/NOTES.md");
    expect(await readFile(mounted, "utf8")).toBe("# B notes\n");
    expect(
      await readFile(
        path.join(workspaceDir, "Spaces/research-b/docs/PLAN.md"),
        "utf8",
      ),
    ).toBe("plan body\n");

    // chmod 0444 — not writable (POSIX; meaningless check skipped on win32).
    if (process.platform !== "win32") {
      const mode = (await stat(mounted)).mode & 0o777;
      expect(mode & 0o222).toBe(0);
      await expect(writeFile(mounted, "overwrite")).rejects.toThrow();
    }

    // Baseline append: exactly the mounted paths, decoded content matches
    // what the diff snapshot will read — zero changed files for these paths.
    expect(appended).toHaveLength(1);
    expect(appended[0]!.map((file) => file.path).sort()).toEqual([
      "Spaces/research-b/NOTES.md",
      "Spaces/research-b/docs/PLAN.md",
    ]);
    expect(new TextDecoder().decode(appended[0]![1]!.bytes)).toBe(
      "plan body\n",
    );

    // No staging residue; previews are non-empty for the tool record.
    expect(await listTempResidue(workspaceDir)).toEqual([]);
    const text = resultText(result as { content?: unknown });
    expect(text).toContain("Mounted 2 file(s)");
    expect(text).toContain("read-only");
    expect((result as { details?: { status?: string } }).details?.status).toBe(
      "success",
    );
  });

  it("mounts a participant's User folder at User/<slug>/", async () => {
    const { workspaceDir, host } = await makeHost({
      "tenants/acme/users/jane/workspace/USER.md": "jane profile\n",
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      endpointResponse(
        successBody([
          {
            key: "tenants/acme/users/jane/workspace/USER.md",
            relPath: "USER.md",
          },
        ]),
      ),
    );
    const { tool } = await buildTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host,
    });

    await tool.execute(
      "call-1",
      { kind: "user", slug: "jane" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(
      await readFile(path.join(workspaceDir, "User/jane/USER.md"), "utf8"),
    ).toBe("jane profile\n");
  });

  it("surfaces the endpoint's partial outcome as status partial", async () => {
    const { host } = await makeHost({ k1: "a" });
    const fetchImpl = vi.fn().mockResolvedValue(
      endpointResponse({
        outcome: "partial",
        partial: true,
        files: [{ key: "k1", relPath: "a.md", etag: "e", size: 1 }],
      }),
    );
    const { tool } = await buildTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host,
    });

    const result = (await tool.execute(
      "call-1",
      { kind: "space", slug: "big-space" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    )) as { details?: { status?: string; partial?: boolean } };

    expect(result.details?.status).toBe("partial");
    expect(result.details?.partial).toBe(true);
    expect(resultText(result as { content?: unknown })).toContain(
      "per-fetch cap",
    );
  });

  it("answers an active-space fetch with a pointer instead of remounting", async () => {
    const { host } = await makeHost({});
    const fetchImpl = vi.fn();
    const { tool } = await buildTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host,
      activeSpaceFolder: "research-a",
    });

    const result = (await tool.execute(
      "call-1",
      { kind: "space", slug: "research-a" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    )) as { details?: { status?: string } };

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.details?.status).toBe("already_hydrated");
    expect(resultText(result as { content?: unknown })).toContain(
      "already hydrated",
    );
  });
});

describe("fetch_workspace_source — denial and failure", () => {
  it("denial throws a descriptive, do-not-retry error (revoked vs not_authorized)", async () => {
    const { host } = await makeHost({});
    const revoked = vi
      .fn()
      .mockResolvedValue(
        endpointResponse(
          { outcome: "denied", deniedReason: "revoked", files: [] },
          403,
        ),
      );
    const { tool } = await buildTool({
      fetchImpl: revoked as unknown as typeof fetch,
      host,
    });
    await expect(
      tool.execute(
        "call-1",
        { kind: "space", slug: "gone", listed_in_routing: true },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/denied \(revoked\).*Do not retry/);

    const notAuthorized = vi
      .fn()
      .mockResolvedValue(
        endpointResponse(
          { outcome: "denied", deniedReason: "not_authorized", files: [] },
          403,
        ),
      );
    const { tool: tool2 } = await buildTool({
      fetchImpl: notAuthorized as unknown as typeof fetch,
      host,
    });
    await expect(
      tool2.execute(
        "call-2",
        { kind: "space", slug: "secret" },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/denied \(not_authorized\)/);
  });

  it("a failure at file k discards the staging dir — nothing is half-mounted", async () => {
    const { workspaceDir, host, appended } = await makeHost({
      k1: "first file",
      // k2 missing → downloadObject throws.
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      endpointResponse(
        successBody([
          { key: "k1", relPath: "a.md" },
          { key: "k2", relPath: "b.md" },
        ]),
      ),
    );
    const { tool } = await buildTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host,
    });

    await expect(
      tool.execute(
        "call-1",
        { kind: "space", slug: "research-b" },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/nothing was mounted/);

    // Mount dir absent, staging discarded, baseline untouched.
    await expect(
      stat(path.join(workspaceDir, "Spaces/research-b")),
    ).rejects.toThrow();
    expect(await listTempResidue(workspaceDir)).toEqual([]);
    expect(appended).toHaveLength(0);
  });

  it("rejects unsafe slugs and relPaths without calling anything", async () => {
    const { host } = await makeHost({ k1: "x" });
    const traversal = vi
      .fn()
      .mockResolvedValue(
        endpointResponse(successBody([{ key: "k1", relPath: "../escape.md" }])),
      );
    const { tool } = await buildTool({
      fetchImpl: traversal as unknown as typeof fetch,
      host,
    });

    await expect(
      tool.execute(
        "call-1",
        { kind: "space", slug: "../evil" },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/valid folder slug/);

    await expect(
      tool.execute(
        "call-2",
        { kind: "space", slug: "ok-space" },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/unsafe path/);
  });
});

describe("fetch_workspace_source — idempotent re-fetch", () => {
  it("re-mounts cleanly: stale files removed, content refreshed, baseline re-appended without duplicates", async () => {
    const objects: Record<string, string> = {
      k1: "version one",
      k2: "second file",
    };
    const { workspaceDir, host, appended } = await makeHost(objects);
    const first = endpointResponse(
      successBody([
        { key: "k1", relPath: "a.md" },
        { key: "k2", relPath: "b.md" },
      ]),
    );
    const second = endpointResponse(
      successBody([{ key: "k1", relPath: "a.md" }]),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const { tool } = await buildTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host,
    });

    await tool.execute(
      "call-1",
      { kind: "space", slug: "research-b" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    objects.k1 = "version two";
    await tool.execute(
      "call-2",
      { kind: "space", slug: "research-b" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    // Refreshed content, stale b.md gone, still read-only, no residue.
    const mountDir = path.join(workspaceDir, "Spaces/research-b");
    expect(await readFile(path.join(mountDir, "a.md"), "utf8")).toBe(
      "version two",
    );
    await expect(stat(path.join(mountDir, "b.md"))).rejects.toThrow();
    expect(await readdir(mountDir)).toEqual(["a.md"]);
    expect(await listTempResidue(workspaceDir)).toEqual([]);

    // Two append calls; each carries unique paths (Record-overwrite semantics
    // upstream make the re-append idempotent — no duplicate entries).
    expect(appended).toHaveLength(2);
    expect(appended[1]!.map((file) => file.path)).toEqual([
      "Spaces/research-b/a.md",
    ]);
  });
});
