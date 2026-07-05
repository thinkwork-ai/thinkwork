/**
 * Capability-folder backfill tests (THINK-173 U11 — R13, R15, R19, R20;
 * AE4). DB mocked at the @thinkwork/database-pg seam (the graphql/utils
 * `db` singleton resolves through the mocked getDb); S3 + signer are
 * injected through the folder-write deps seam.
 */

import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTenantRows,
  mockAgentRows,
  mockAttachRows,
  mockServerRows,
  mockUpdates,
} = vi.hoisted(() => ({
  mockTenantRows: vi.fn(),
  mockAgentRows: vi.fn(),
  mockAttachRows: vi.fn(),
  mockServerRows: vi.fn(),
  mockUpdates: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => {
        const record =
          table && typeof table === "object"
            ? (table as Record<string, unknown>)
            : {};
        if (record.id === "tenants.id") {
          return {
            where: () => ({
              limit: () => Promise.resolve(mockTenantRows()),
            }),
          };
        }
        if (record.id === "agents.id") {
          return { where: () => Promise.resolve(mockAgentRows()) };
        }
        if (record.mcp_server_id === "agentMcpServers.mcp_server_id") {
          return {
            innerJoin: () => ({
              where: () => Promise.resolve(mockAttachRows()),
            }),
          };
        }
        if (record.id === "tenantMcpServers.id") {
          return { where: () => Promise.resolve(mockServerRows()) };
        }
        throw new Error("unexpected select table");
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          mockUpdates({ table, values });
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenants: { id: "tenants.id", slug: "tenants.slug" },
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    slug: "agents.slug",
    workspace_folder_name: "agents.workspace_folder_name",
    capability_folder_dispatch: "agents.capability_folder_dispatch",
    send_email: "agents.send_email",
    web_search: "agents.web_search",
    web_extract: "agents.web_extract",
    browser: "agents.browser",
    sandbox: "agents.sandbox",
  },
  agentMcpServers: {
    mcp_server_id: "agentMcpServers.mcp_server_id",
    agent_id: "agentMcpServers.agent_id",
    tenant_id: "agentMcpServers.tenant_id",
    enabled: "agentMcpServers.enabled",
    config: "agentMcpServers.config",
  },
  tenantMcpServers: {
    id: "tenantMcpServers.id",
    tenant_id: "tenantMcpServers.tenant_id",
    slug: "tenantMcpServers.slug",
    name: "tenantMcpServers.name",
    url: "tenantMcpServers.url",
    transport: "tenantMcpServers.transport",
    tools: "tenantMcpServers.tools",
    status: "tenantMcpServers.status",
    enabled: "tenantMcpServers.enabled",
    auth_config: "tenantMcpServers.auth_config",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  or: (...args: unknown[]) => ({ _or: args }),
  sql: Object.assign((..._args: unknown[]) => ({}), { raw: () => ({}) }),
  inArray: () => ({}),
  isNull: () => ({}),
  desc: () => ({}),
  asc: () => ({}),
}));

// eslint-disable-next-line import/first
import { runCapabilityFolderBackfill, scrubSecretValues } from "./backfill.js";
// eslint-disable-next-line import/first
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  verifyCapabilitySidecar,
} from "./sidecar-signing.js";
// eslint-disable-next-line import/first
import {
  capabilityDefinitionKey,
  capabilitySidecarKey,
} from "./folder-write.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = capabilitySignerFromKey(privateKey);
const verifier = capabilityVerifierFromKey(publicKey);

const PREFIX = "tenants/acme/agents/ops/";

/** In-memory S3 double; can fail puts on demand (AE4 partial failure). */
function fakeS3() {
  const objects = new Map<string, string>();
  const state = { failPuts: false, puts: 0 };
  return {
    objects,
    state,
    send: vi.fn(async (command: any) => {
      const name = command.constructor.name;
      const key = command.input.Key as string;
      if (name === "GetObjectCommand") {
        if (!objects.has(key)) {
          throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        }
        return { Body: { transformToString: async () => objects.get(key)! } };
      }
      if (name === "PutObjectCommand") {
        state.puts += 1;
        if (state.failPuts) throw new Error("S3 slow");
        objects.set(key, command.input.Body as string);
        return {};
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(key);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    }),
  };
}

const AGENT = {
  id: "agent-1",
  slug: "ops",
  workspace_folder_name: null,
  capability_folder_dispatch: false,
  send_email: { enabled: true },
  web_search: null,
  web_extract: null,
  browser: null,
  sandbox: null,
};

const ATTACH_ROW = {
  enabled: true,
  config: { toolAllowlist: ["list_issues"] },
  server_id: "srv-1",
  slug: "linear",
  name: "Linear",
  url: "https://mcp.linear.app/sse",
  transport: "sse",
  tools: [{ name: "list_issues" }, { name: "save_issue" }],
  status: "approved",
  server_enabled: true,
};

function deps(s3: ReturnType<typeof fakeS3>) {
  return { s3: s3 as any, bucket: "b", signer };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTenantRows.mockReturnValue([{ slug: "acme" }]);
  mockAgentRows.mockReturnValue([{ ...AGENT }]);
  mockAttachRows.mockReturnValue([{ ...ATTACH_ROW }]);
  mockServerRows.mockReturnValue([]);
});

describe("runCapabilityFolderBackfill", () => {
  it("dry-run reports proposals and collisions without writing (R19)", async () => {
    const s3 = fakeS3();
    // A registry server whose derived slug collides with a builtin.
    mockAttachRows.mockReturnValue([
      { ...ATTACH_ROW },
      {
        ...ATTACH_ROW,
        server_id: "srv-2",
        slug: "bash",
        name: "bash",
        url: "https://mcp.example/bash",
      },
    ]);
    const report = await runCapabilityFolderBackfill({
      tenantId: "T1",
      deps: deps(s3),
    });
    expect(report.mode).toEqual({ apply: false, flip: false, scrub: false });
    const agent = report.agents[0]!;
    expect(agent.proposedConnections.map((entry) => entry.slug)).toEqual([
      "linear",
      "bash",
    ]);
    expect(agent.proposedPlatformTools).toEqual(["send-email"]);
    expect(agent.collisions).toEqual([{ name: "bash", winner: "builtin:pi" }]);
    expect(s3.state.puts).toBe(0);
    expect(mockUpdates).not.toHaveBeenCalled();
  });

  it("apply writes verifiable folders; colliding folders are never written", async () => {
    const s3 = fakeS3();
    mockAttachRows.mockReturnValue([
      { ...ATTACH_ROW },
      {
        ...ATTACH_ROW,
        server_id: "srv-2",
        slug: "bash",
        name: "bash",
      },
    ]);
    const report = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      deps: deps(s3),
    });
    const agent = report.agents[0]!;
    expect(agent.applied?.written.sort()).toEqual([
      "connections/linear",
      "tools/send-email",
    ]);
    expect(agent.applied?.errors).toEqual([
      { slug: "bash", reason: "collision" },
    ]);
    expect(
      s3.objects.has(capabilityDefinitionKey(PREFIX, "connection", "bash")),
    ).toBe(false);

    const sidecar = JSON.parse(
      s3.objects.get(capabilitySidecarKey(PREFIX, "connection", "linear"))!,
    ) as Record<string, unknown>;
    const definition = s3.objects.get(
      capabilityDefinitionKey(PREFIX, "connection", "linear"),
    )!;
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar,
        definitionBytes: definition,
      }),
    ).toEqual({ ok: true });
    expect((sidecar.signature as { signed_by: string }).signed_by).toBe(
      "backfill",
    );
    expect(
      (sidecar.config as { registryServerId: string }).registryServerId,
    ).toBe("srv-1");
    expect(definition).not.toContain("auth_config");
  });

  it("re-run is idempotent: definitions byte-stable, reported unchanged", async () => {
    const s3 = fakeS3();
    await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      deps: deps(s3),
    });
    const definitionKey = capabilityDefinitionKey(
      PREFIX,
      "connection",
      "linear",
    );
    const firstDefinition = s3.objects.get(definitionKey)!;

    const second = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      deps: deps(s3),
    });
    const agent = second.agents[0]!;
    expect(agent.applied?.written).toEqual([]);
    expect(agent.applied?.unchanged.sort()).toEqual([
      "connections/linear",
      "tools/send-email",
    ]);
    expect(s3.objects.get(definitionKey)).toBe(firstDefinition);
  });

  it("matching surfaces flip the flag atomically per agent (R20)", async () => {
    const s3 = fakeS3();
    const report = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      flip: true,
      deps: deps(s3),
    });
    const agent = report.agents[0]!;
    expect(agent.divergence?.equal).toBe(true);
    expect(agent.flipped).toBe(true);
    expect(mockUpdates).toHaveBeenCalledTimes(1);
    expect(mockUpdates.mock.calls[0]?.[0].values).toEqual({
      capability_folder_dispatch: true,
    });
  });

  it("divergence blocks the flip with diff output (R20)", async () => {
    const s3 = fakeS3();
    // Pre-seed a folder sidecar whose permitted operations differ from
    // the DB surface (apply is skipped so the stale folder survives:
    // simulate by applying first, then changing the DB allowlist).
    await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      deps: deps(s3),
    });
    mockAttachRows.mockReturnValue([
      { ...ATTACH_ROW, config: { toolAllowlist: ["save_issue"] } },
    ]);
    // Flip WITHOUT apply: folder still carries the old operations.
    const report = await runCapabilityFolderBackfill({
      tenantId: "T1",
      flip: true,
      deps: deps(s3),
    });
    const agent = report.agents[0]!;
    // flip without apply → applied is undefined, divergence computed
    // against the stale folder surface.
    expect(agent.divergence?.equal).toBe(false);
    expect(agent.divergence?.changed).toEqual(["linear"]);
    expect(agent.flipped).toBe(false);
    expect(mockUpdates).not.toHaveBeenCalled();
  });

  it("AE4: partial S3 failure leaves the flag unflipped; re-run completes", async () => {
    const s3 = fakeS3();
    s3.state.failPuts = true;
    const first = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      flip: true,
      deps: deps(s3),
    });
    expect(first.agents[0]?.applied?.errors.length).toBeGreaterThan(0);
    expect(first.agents[0]?.flipped).toBe(false);
    expect(mockUpdates).not.toHaveBeenCalled();

    s3.state.failPuts = false;
    const second = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      flip: true,
      deps: deps(s3),
    });
    expect(second.agents[0]?.applied?.errors).toEqual([]);
    expect(second.agents[0]?.flipped).toBe(true);
  });

  it("scrub replaces inline secrets only on a fully flipped tenant", async () => {
    const s3 = fakeS3();
    mockServerRows.mockReturnValue([
      {
        id: "srv-1",
        auth_config: {
          method: "bearer",
          api_key: "sk-live-secret",
          nested: { client_secret: "cs-abc" },
          keep_ref: { token: "secretsmanager:already-a-ref" },
        },
      },
    ]);

    // Not yet flipped → blocked.
    const blocked = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      flip: false,
      scrub: true,
      deps: deps(s3),
    });
    expect(blocked.scrub).toBeUndefined(); // scrub requires flip

    // Fully flipped run → scrub executes.
    const report = await runCapabilityFolderBackfill({
      tenantId: "T1",
      apply: true,
      flip: true,
      scrub: true,
      deps: deps(s3),
    });
    expect(report.scrub?.ran).toBe(true);
    expect(report.scrub?.servers).toEqual([
      {
        serverId: "srv-1",
        scrubbedPaths: ["api_key", "nested.client_secret"],
      },
    ]);
    const scrubUpdate = mockUpdates.mock.calls.find(
      (call) => (call[0].values as Record<string, unknown>).auth_config,
    );
    const scrubbed = (scrubUpdate?.[0].values as { auth_config: any })
      .auth_config;
    expect(scrubbed.api_key).toBe("secretsmanager:MIGRATED");
    expect(scrubbed.nested.client_secret).toBe("secretsmanager:MIGRATED");
    expect(scrubbed.keep_ref.token).toBe("secretsmanager:already-a-ref");
  });
});

describe("scrubSecretValues", () => {
  it("scrubs secret-shaped keys, keeps refs and non-secret values", () => {
    const paths: string[] = [];
    const result = scrubSecretValues(
      {
        url: "https://x",
        password: "hunter2",
        headers: [{ authorization: "Bearer abc" }],
        env_ref: { api_key: "FIRECRAWL_API_KEY" },
      },
      "",
      paths,
    ) as Record<string, any>;
    expect(result.url).toBe("https://x");
    expect(result.password).toBe("secretsmanager:MIGRATED");
    expect(result.headers[0].authorization).toBe("secretsmanager:MIGRATED");
    expect(result.env_ref.api_key).toBe("FIRECRAWL_API_KEY");
    expect(paths).toEqual(["password", "headers[0].authorization"]);
  });
});
