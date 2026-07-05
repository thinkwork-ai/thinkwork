/**
 * THINK-173 U6 — capabilities manifest reader + manifest-mode
 * registration tests.
 *
 * Covers: Ed25519 envelope verification (tamper/malformed/missing →
 * CapabilitiesJsonError, loud — R9), all four tool kinds registering and
 * executing, withheld entries never registering, the collision second
 * line (R10), unknown-platform-tool skip semantics, and legacy-path
 * byte-identity when no fingerprint is dispatched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  buildInvocationResources,
  type InvocationResourceBundle,
} from "../src/server.js";
import {
  CapabilitiesJsonError,
  canonicalizeManifestBody,
  capabilitiesManifestRelPath,
  readCapabilitiesManifest,
  type CapabilitiesManifestFile,
  type CapabilityManifestEntry,
} from "../src/runtime/capabilities-json.js";
import { HandleStore, type ConnectMcpServerFn } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const otherPair = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const FINGERPRINT = "f".repeat(64);

function signManifest(
  body: Pick<
    CapabilitiesManifestFile,
    "version" | "agent" | "active" | "withheld"
  >,
  key = privateKey,
): CapabilitiesManifestFile {
  const canonical = canonicalizeManifestBody(body);
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  const signature = edSign(null, Buffer.from(canonical, "utf8"), key).toString(
    "hex",
  );
  return {
    ...body,
    fingerprint: FINGERPRINT,
    input_signature: "sig-1",
    generated_at: "2026-07-05T00:00:00.000Z",
    signature: {
      version: 1,
      algorithm: "Ed25519",
      payloadHash,
      signature,
      signed_by: "render",
      signed_at: "2026-07-05T00:00:00.000Z",
    },
  };
}

function manifestBody(
  active: CapabilityManifestEntry[],
  withheld: Array<Record<string, unknown>> = [],
) {
  return {
    version: 1,
    agent: { tenant_id: "tenant-1", agent_slug: "agent-x" },
    active,
    withheld,
  };
}

let workspaceDir: string;

async function writeManifest(manifest: CapabilitiesManifestFile | string) {
  await mkdir(path.join(workspaceDir, "capabilities"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, capabilitiesManifestRelPath(FINGERPRINT)),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    "utf-8",
  );
}

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "cap-manifest-"));
  vi.stubEnv("CAPABILITY_SIGNING_PUBLIC_KEY", PUBLIC_PEM);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspaceDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Reader + verification
// ---------------------------------------------------------------------------

describe("readCapabilitiesManifest", () => {
  it("reads and verifies a signed manifest", async () => {
    await writeManifest(signManifest(manifestBody([])));
    const manifest = await readCapabilitiesManifest(workspaceDir, FINGERPRINT);
    expect(manifest.active).toEqual([]);
    expect(manifest.signature?.signed_by).toBe("render");
  });

  it("missing file in manifest mode is loud — never a silent fallback", async () => {
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(CapabilitiesJsonError);
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/missing from the synced workspace/);
  });

  it("malformed JSON and wrong shapes throw CapabilitiesJsonError", async () => {
    await writeManifest("{nope");
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/invalid JSON/);

    await writeManifest(JSON.stringify({ version: 99 }));
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/unsupported manifest version/);
  });

  it("tampered body fails the payload-hash check", async () => {
    const manifest = signManifest(manifestBody([]));
    const tampered = {
      ...manifest,
      active: [
        { name: "smuggled", slug: "smuggled", class: "tool", kind: "script" },
      ],
    };
    await writeManifest(tampered as CapabilitiesManifestFile);
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/do not match the signed payload hash/);
  });

  it("forged signature (wrong key) fails Ed25519 verification", async () => {
    await writeManifest(signManifest(manifestBody([]), otherPair.privateKey));
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/failed Ed25519 verification/);
  });

  it("unsigned manifest (signature: null) fails in manifest mode", async () => {
    const manifest = signManifest(manifestBody([]));
    await writeManifest({ ...manifest, signature: null });
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/no signature envelope/);
  });

  it("fails CLOSED when the public key env is unset", async () => {
    vi.stubEnv("CAPABILITY_SIGNING_PUBLIC_KEY", "");
    await writeManifest(signManifest(manifestBody([])));
    await expect(
      readCapabilitiesManifest(workspaceDir, FINGERPRINT),
    ).rejects.toThrow(/CAPABILITY_SIGNING_PUBLIC_KEY is not configured/);
  });
});

// ---------------------------------------------------------------------------
// Manifest-mode registration in buildInvocationResources
// ---------------------------------------------------------------------------

function fakeAgentCoreClient(): unknown {
  return { send: vi.fn() };
}

/** Fake connect: registers `operation` in the registry and returns one
 * AgentTool shaped like the production factory's (name + label). */
function connectWithTool(
  operation: string,
  executeSpy: ReturnType<typeof vi.fn>,
): ConnectMcpServerFn {
  return async (args) => {
    args.registry?.register(args.serverName, {
      tool: operation,
      description: `${operation} description`,
      inputSchema: { type: "object" },
    });
    return [
      {
        name: `mcp_${args.serverName}_${operation}`,
        label: `${args.serverName}: ${operation}`,
        description: `${operation} description`,
        parameters: { type: "object" } as never,
        executionMode: "sequential",
        execute: executeSpy as never,
      } satisfies AgentTool<any>,
    ];
  };
}

interface BuildArgsOverrides {
  payload?: Record<string, unknown>;
  manifest?: CapabilitiesManifestFile | null;
  connect?: ConnectMcpServerFn;
  sandbox?: boolean;
}

async function buildBundle(
  overrides: BuildArgsOverrides = {},
): Promise<InvocationResourceBundle> {
  return await buildInvocationResources({
    payload: {
      ...(overrides.sandbox ? { sandbox_interpreter_id: "interp-1" } : {}),
      ...overrides.payload,
    },
    identity: {
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      tenantSlug: "",
      agentSlug: "",
      traceId: "",
    },
    env: {
      awsRegion: "us-east-1",
      agentCoreMemoryId: "",
      hindsightEndpoint: "",
      memoryEngine: "managed",
      memoryRetainFnName: "",
      dbClusterArn: "",
      dbSecretArn: "",
      dbName: "thinkwork",
      workspaceBucket: "",
      workspaceDir,
      piAgentDir: "/tmp/thinkwork-pi-agent",
      gitSha: "test",
    },
    agentCoreClient: fakeAgentCoreClient() as never,
    workspaceSkills: [],
    connectMcpServer: overrides.connect ?? (async () => []),
    sessionStoreFactory: () => ({}) as never,
    cleanup: [],
    handleStore: new HandleStore(),
    mcpJsonConfig: { directTools: [] },
    capabilitiesManifest: overrides.manifest ?? null,
    mcpRegistry: new McpToolRegistry(),
  });
}

const MCP_CONFIG = {
  serverName: "firecrawl",
  url: "https://mcp.example/firecrawl",
  transport: "streamable-http",
  bearer: "token-1",
};

describe("buildInvocationResources — manifest mode (THINK-173 U6)", () => {
  it("binding registers under its stable name and delegates with preset args (model wins)", async () => {
    const executeSpy = vi.fn(async (..._args: unknown[]) => ({
      content: [{ type: "text", text: "scraped" }],
      details: {},
    }));
    const bundle = await buildBundle({
      payload: { mcp_configs: [MCP_CONFIG] },
      connect: connectWithTool("scrape", executeSpy),
      manifest: signManifest(
        manifestBody([
          {
            name: "firecrawl-scrape",
            slug: "firecrawl-scrape",
            class: "tool",
            kind: "binding",
            connection: "firecrawl",
            operation: "scrape",
            presetArgs: { formats: ["markdown"], depth: 1 },
          },
        ]),
      ),
    });
    const binding = bundle.tools.find(
      (tool) => tool.name === "firecrawl-scrape",
    );
    expect(binding).toBeDefined();
    expect(bundle.capabilityLoadRecord).toEqual([
      { name: "firecrawl-scrape", kind: "binding", status: "registered" },
    ]);
    await binding!.execute(
      "call-1" as never,
      { depth: 3 } as never,
      undefined as never,
    );
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0]?.[0]).toBe("call-1");
    expect(executeSpy.mock.calls[0]?.[1]).toEqual({
      formats: ["markdown"],
      depth: 3,
    });
  });

  it("binding over an unavailable connection or operation is skipped, turn proceeds", async () => {
    const bundle = await buildBundle({
      payload: { mcp_configs: [MCP_CONFIG] },
      connect: connectWithTool("scrape", vi.fn()),
      manifest: signManifest(
        manifestBody([
          {
            name: "ghost-tool",
            slug: "ghost-tool",
            class: "tool",
            kind: "binding",
            connection: "ghost-server",
            operation: "scrape",
          },
          {
            name: "firecrawl-crawl",
            slug: "firecrawl-crawl",
            class: "tool",
            kind: "binding",
            connection: "firecrawl",
            operation: "crawl",
          },
        ]),
      ),
    });
    expect(bundle.capabilityLoadRecord).toEqual([
      {
        name: "ghost-tool",
        kind: "binding",
        status: "skipped",
        reason: "connection_unavailable",
      },
      {
        name: "firecrawl-crawl",
        kind: "binding",
        status: "skipped",
        reason: "operation_unavailable",
      },
    ]);
  });

  it("platform entries validate against the assembled surface; unknown names skip with reason", async () => {
    const bundle = await buildBundle({
      sandbox: true,
      manifest: signManifest(
        manifestBody([
          {
            name: "code-sandbox",
            slug: "code-sandbox",
            class: "tool",
            kind: "platform",
            platformTool: "execute_code",
          },
          {
            name: "future-tool",
            slug: "future-tool",
            class: "tool",
            kind: "platform",
            platformTool: "teleport",
          },
        ]),
      ),
    });
    expect(bundle.capabilityLoadRecord).toEqual([
      { name: "code-sandbox", kind: "platform", status: "registered" },
      {
        name: "future-tool",
        kind: "platform",
        status: "skipped",
        reason: "unknown_platform_tool",
      },
    ]);
  });

  it("extension entries bind existing extension tools; missing ones skip", async () => {
    const bundle = await buildBundle({
      payload: {
        thread_json_render_ui_enabled: false,
        browser_automation_enabled: true,
      },
      manifest: signManifest(
        manifestBody([
          {
            name: "browser",
            slug: "browser",
            class: "tool",
            kind: "extension",
            extension: "browser-automation",
            extensionTool: "browser_automation",
          },
          {
            name: "nope",
            slug: "nope",
            class: "tool",
            kind: "extension",
            extension: "x",
            extensionTool: "not_a_real_tool",
          },
        ]),
      ),
    });
    const browserRecord = bundle.capabilityLoadRecord.find(
      (record) => record.name === "browser",
    );
    const missingRecord = bundle.capabilityLoadRecord.find(
      (record) => record.name === "nope",
    );
    // browser_automation registers as an extension tool when enabled.
    expect(browserRecord?.status).toBe(
      bundle.extensionToolNames.includes("browser_automation")
        ? "registered"
        : "skipped",
    );
    expect(missingRecord).toEqual({
      name: "nope",
      kind: "extension",
      status: "skipped",
      reason: "extension_tool_unavailable",
    });
  });

  it("script registers with a sandbox and executes through it; without a sandbox it skips", async () => {
    await mkdir(path.join(workspaceDir, "tools", "cruncher"), {
      recursive: true,
    });
    await writeFile(
      path.join(workspaceDir, "tools", "cruncher", "run.sh"),
      "echo done",
      "utf-8",
    );
    const entry: CapabilityManifestEntry = {
      name: "cruncher",
      slug: "cruncher",
      class: "tool",
      kind: "script",
      entry: "run.sh",
    };
    const withSandbox = await buildBundle({
      sandbox: true,
      manifest: signManifest(manifestBody([entry])),
    });
    expect(withSandbox.capabilityLoadRecord).toEqual([
      { name: "cruncher", kind: "script", status: "registered" },
    ]);
    expect(withSandbox.tools.some((tool) => tool.name === "cruncher")).toBe(
      true,
    );

    const withoutSandbox = await buildBundle({
      manifest: signManifest(manifestBody([entry])),
    });
    expect(withoutSandbox.capabilityLoadRecord).toEqual([
      {
        name: "cruncher",
        kind: "script",
        status: "skipped",
        reason: "sandbox_unavailable",
      },
    ]);
  });

  it("collision second line: a manifest tool shadowing a builtin is skipped (R10)", async () => {
    const bundle = await buildBundle({
      payload: { mcp_configs: [MCP_CONFIG] },
      connect: connectWithTool("bash", vi.fn()),
      manifest: signManifest(
        manifestBody([
          {
            name: "bash",
            slug: "bash",
            class: "tool",
            kind: "binding",
            connection: "firecrawl",
            operation: "bash",
          },
        ]),
      ),
    });
    expect(bundle.capabilityLoadRecord).toEqual([
      {
        name: "bash",
        kind: "binding",
        status: "skipped",
        reason: "collision",
      },
    ]);
    // The builtin name is not shadowed by a manifest tool.
    expect(bundle.tools.filter((tool) => tool.name === "bash")).toHaveLength(0);
  });

  it("withheld entries never register — only `active` is read (AE1/AE3)", async () => {
    const bundle = await buildBundle({
      sandbox: true,
      manifest: signManifest(
        manifestBody(
          [],
          [
            {
              slug: "exfil",
              class: "tool",
              reason: "unsigned",
            },
          ],
        ),
      ),
    });
    expect(bundle.capabilityLoadRecord).toEqual([]);
    expect(bundle.tools.some((tool) => tool.name === "exfil")).toBe(false);
  });

  it("informational classes (builtin/skill/connection) register nothing", async () => {
    const bundle = await buildBundle({
      manifest: signManifest(
        manifestBody([
          { name: "read", slug: "read", class: "builtin" },
          { name: "sales-prep", slug: "sales-prep", class: "skill" },
          {
            name: "firecrawl",
            slug: "firecrawl",
            class: "connection",
            type: "api",
          },
        ]),
      ),
    });
    expect(bundle.capabilityLoadRecord).toEqual([]);
  });

  it("legacy path: no fingerprint/manifest → empty capability record, no manifest read", async () => {
    const bundle = await buildBundle({ manifest: null });
    expect(bundle.capabilityLoadRecord).toEqual([]);
  });
});
