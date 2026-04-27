/**
 * Tests for workspace-bootstrap — the simple template→agent-prefix copy
 * that materialize-at-write-time replaces the runtime composer with.
 *
 * The contract under test is intentionally narrow:
 *   - List template + defaults (template wins on collisions)
 *   - Substitute AGENT_NAME / TENANT_NAME
 *   - Write to the agent's prefix, regenerate manifest
 *   - `preserve-existing` mode skips paths already at the agent prefix;
 *     `overwrite` mode replaces them
 *
 * No overlay walk, no pin store, no ancestor fallback. If the test ever
 * starts asserting any of those behaviors, we re-introduced complexity
 * we explicitly removed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// ─── Hoisted DB mock (mirrors user-md-writer.test.ts) ────────────────────────

const { dbQueue, pushDbRows, resetDbQueue } = vi.hoisted(() => {
  const queue: unknown[][] = [];
  return {
    dbQueue: queue,
    pushDbRows: (rows: unknown[]) => queue.push(rows),
    resetDbQueue: () => {
      queue.length = 0;
    },
  };
});

vi.mock("../graphql/utils.js", () => {
  const tableCol = (label: string) => ({ __col: label });
  const chain = () => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
        fn.then = (o: any, r: any) =>
          Promise.resolve(dbQueue.shift() ?? []).then(o, r);
        fn.limit = vi
          .fn()
          .mockImplementation(() => Promise.resolve(dbQueue.shift() ?? []));
        return fn;
      }),
    })),
  });
  return {
    db: { select: vi.fn().mockImplementation(() => chain()) },
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    agents: { id: tableCol("agents.id") },
    tenants: { id: tableCol("tenants.id") },
    agentTemplates: { id: tableCol("agentTemplates.id") },
  };
});

// ─── S3 mock ─────────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);
process.env.WORKSPACE_BUCKET = "test-bucket";

import {
  bootstrapAgentWorkspace,
  BootstrapError,
} from "../lib/workspace-bootstrap.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AGENT_ID = "agent-marco";
const TENANT_ID = "tenant-a";
const TEMPLATE_ID = "template-exec";

const AGENT_PREFIX = "tenants/acme/agents/marco/workspace/";
const TEMPLATE_PREFIX =
  "tenants/acme/agents/_catalog/exec-assistant/workspace/";
const DEFAULTS_PREFIX = "tenants/acme/agents/_catalog/defaults/workspace/";

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    slug: "marco",
    name: "Marco",
    tenant_id: TENANT_ID,
    template_id: TEMPLATE_ID,
    ...overrides,
  };
}

function tenantRow() {
  return { id: TENANT_ID, slug: "acme", name: "Acme" };
}

function templateRow() {
  return { slug: "exec-assistant" };
}

function queueAgentResolution() {
  pushDbRows([agentRow()]);
  pushDbRows([tenantRow()]);
  pushDbRows([templateRow()]);
}

function body(content: string) {
  return {
    Body: {
      transformToString: async () => content,
    } as unknown as never,
  };
}

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

/**
 * Stub a list of template + defaults source files. Each source object
 * is matched on its full S3 key by aws-sdk-client-mock's `Key` predicate.
 *
 * Default agent-prefix existence: every preserve-existing check returns
 * "doesn't exist" unless a test explicitly overrides it. Tests that want
 * to assert preserve-existing skipping should call `stubAgentExists(rel)`
 * after `stubSources()`.
 */
function stubSources(opts: {
  templateFiles?: Record<string, string>;
  defaultsFiles?: Record<string, string>;
}) {
  const templateContents = opts.templateFiles ?? {};
  const defaultsContents = opts.defaultsFiles ?? {};

  s3Mock.on(ListObjectsV2Command, { Prefix: TEMPLATE_PREFIX }).resolves({
    Contents: Object.keys(templateContents).map((rel) => ({
      Key: TEMPLATE_PREFIX + rel,
    })),
  });
  s3Mock.on(ListObjectsV2Command, { Prefix: DEFAULTS_PREFIX }).resolves({
    Contents: Object.keys(defaultsContents).map((rel) => ({
      Key: DEFAULTS_PREFIX + rel,
    })),
  });
  for (const [rel, content] of Object.entries(templateContents)) {
    s3Mock
      .on(GetObjectCommand, { Key: TEMPLATE_PREFIX + rel })
      .resolves(body(content));
  }
  for (const [rel, content] of Object.entries(defaultsContents)) {
    s3Mock
      .on(GetObjectCommand, { Key: DEFAULTS_PREFIX + rel })
      .resolves(body(content));
  }
  // Default: every preserve-existing HEAD probe returns "not found".
  // Tests that want to assert preserve-existing skipping override per
  // path with `stubAgentExists`.
  s3Mock.on(HeadObjectCommand).rejects(noSuchKey());
  // Manifest regen lists the agent prefix at the end — return empty
  // unless a test overrides it.
  s3Mock
    .on(ListObjectsV2Command, { Prefix: AGENT_PREFIX })
    .resolves({ Contents: [] });
}

/**
 * Tell the mock that a given path already exists at the agent prefix
 * (so `preserve-existing` mode skips it).
 */
function stubAgentExists(relPath: string) {
  s3Mock
    .on(HeadObjectCommand, { Key: AGENT_PREFIX + relPath })
    .resolves({ ContentLength: 0 });
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  s3Mock.reset();
  resetDbQueue();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("bootstrapAgentWorkspace", () => {
  it("copies template files to the agent prefix with AGENT_NAME / TENANT_NAME substituted", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: {
        "AGENTS.md": "# {{AGENT_NAME}} of {{TENANT_NAME}}",
      },
    });

    const result = await bootstrapAgentWorkspace(AGENT_ID);

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(1);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    const agentsMd = puts.find(
      (call) => call.args[0].input.Key === AGENT_PREFIX + "AGENTS.md",
    );
    expect(agentsMd).toBeDefined();
    expect(agentsMd!.args[0].input.Body).toBe("# Marco of Acme");
    expect(agentsMd!.args[0].input.ContentType).toBe("text/markdown");
  });

  it("uses defaults files for paths the template does not provide", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: { "AGENTS.md": "# {{AGENT_NAME}}" },
      defaultsFiles: {
        "MEMORY_GUIDE.md": "Guide for {{TENANT_NAME}}",
      },
    });

    const result = await bootstrapAgentWorkspace(AGENT_ID);

    expect(result.written).toBe(2);
    const puts = s3Mock.commandCalls(PutObjectCommand);
    const memoryGuide = puts.find(
      (call) => call.args[0].input.Key === AGENT_PREFIX + "MEMORY_GUIDE.md",
    );
    expect(memoryGuide!.args[0].input.Body).toBe("Guide for Acme");
  });

  it("template wins when both layers have the same path", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: { "AGENTS.md": "TEMPLATE: {{AGENT_NAME}}" },
      defaultsFiles: { "AGENTS.md": "DEFAULTS: should not appear" },
    });

    await bootstrapAgentWorkspace(AGENT_ID);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    const agentsMd = puts.find(
      (call) => call.args[0].input.Key === AGENT_PREFIX + "AGENTS.md",
    );
    expect(agentsMd!.args[0].input.Body).toBe("TEMPLATE: Marco");
  });

  it("skips manifest.json and _defaults_version operational artifacts", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: {
        "AGENTS.md": "real",
        "manifest.json": "should-skip",
        _defaults_version: "should-skip",
      },
    });

    const result = await bootstrapAgentWorkspace(AGENT_ID);

    // Source-side counts: only AGENTS.md is substantive; the manifest +
    // _defaults_version are operational and excluded from the source set.
    expect(result.written).toBe(1);
    expect(result.total).toBe(1);

    // The bootstrap regenerates the manifest at the agent prefix
    // post-write — that's a separate, expected PUT. What MUST NOT happen
    // is the bootstrap reading the template's manifest.json or
    // _defaults_version as a source file.
    const gets = s3Mock.commandCalls(GetObjectCommand);
    const sourcedKeys = gets.map((c) => c.args[0].input.Key);
    expect(sourcedKeys).not.toContain(TEMPLATE_PREFIX + "manifest.json");
    expect(sourcedKeys).not.toContain(TEMPLATE_PREFIX + "_defaults_version");

    // And the agent-prefix manifest.json that DOES get written is the
    // regenerated one, not the template's "should-skip" string.
    const puts = s3Mock.commandCalls(PutObjectCommand);
    const agentManifest = puts.find(
      (c) => c.args[0].input.Key === AGENT_PREFIX + "manifest.json",
    );
    if (agentManifest) {
      expect(agentManifest.args[0].input.Body).not.toBe("should-skip");
    }
  });

  it("preserve-existing mode skips paths already at the agent prefix", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: {
        "AGENTS.md": "should-skip-because-existing",
        "IDENTITY.md": "should-write",
      },
    });
    stubAgentExists("AGENTS.md"); // already there — preserve-existing skips

    const result = await bootstrapAgentWorkspace(AGENT_ID, {
      mode: "preserve-existing",
    });

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
    const puts = s3Mock.commandCalls(PutObjectCommand);
    const writtenKeys = puts
      .map((c) => c.args[0].input.Key)
      .filter((k) => typeof k === "string" && k.startsWith(AGENT_PREFIX));
    expect(writtenKeys).toContain(AGENT_PREFIX + "IDENTITY.md");
    expect(writtenKeys).not.toContain(AGENT_PREFIX + "AGENTS.md");
  });

  it("overwrite mode replaces existing files at the agent prefix", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: {
        "AGENTS.md": "fresh template content for {{AGENT_NAME}}",
      },
    });
    stubAgentExists("AGENTS.md"); // exists, but overwrite mode ignores it

    const result = await bootstrapAgentWorkspace(AGENT_ID, {
      mode: "overwrite",
    });

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
    const puts = s3Mock.commandCalls(PutObjectCommand);
    const agentsMd = puts.find(
      (call) => call.args[0].input.Key === AGENT_PREFIX + "AGENTS.md",
    );
    expect(agentsMd!.args[0].input.Body).toBe(
      "fresh template content for Marco",
    );
  });

  it("regenerates the manifest after writes (any write triggers regen)", async () => {
    queueAgentResolution();
    stubSources({ templateFiles: { "AGENTS.md": "x" } });

    await bootstrapAgentWorkspace(AGENT_ID);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    const manifestPut = puts.find(
      (c) => c.args[0].input.Key === AGENT_PREFIX + "manifest.json",
    );
    expect(manifestPut).toBeDefined();
    expect(manifestPut!.args[0].input.ContentType).toBe("application/json");
  });

  it("does not regenerate the manifest when nothing was written", async () => {
    queueAgentResolution();
    stubSources({
      templateFiles: { "AGENTS.md": "x" },
    });
    stubAgentExists("AGENTS.md"); // → skipped → no writes → no manifest regen

    const result = await bootstrapAgentWorkspace(AGENT_ID, {
      mode: "preserve-existing",
    });

    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
    const puts = s3Mock.commandCalls(PutObjectCommand);
    const manifestPut = puts.find(
      (c) => c.args[0].input.Key === AGENT_PREFIX + "manifest.json",
    );
    expect(manifestPut).toBeUndefined();
  });

  it("throws BootstrapError when the agent / tenant / template chain is unresolvable", async () => {
    pushDbRows([]); // agent lookup empty

    await expect(bootstrapAgentWorkspace(AGENT_ID)).rejects.toBeInstanceOf(
      BootstrapError,
    );
  });

  it("throws BootstrapError when WORKSPACE_BUCKET is not configured", async () => {
    const previous = process.env.WORKSPACE_BUCKET;
    try {
      process.env.WORKSPACE_BUCKET = "";
      await expect(bootstrapAgentWorkspace(AGENT_ID)).rejects.toMatchObject({
        code: "BUCKET_UNCONFIGURED",
      });
    } finally {
      process.env.WORKSPACE_BUCKET = previous;
    }
  });
});
