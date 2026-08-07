/**
 * Company Brain connector provisioning tests (THINK-333 U4).
 * Chain-mock Drizzle db — same approach as analyst provision-connector.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  selectQueue,
  insertCalls,
  updateCalls,
  returningQueue,
  folderCalls,
  dualWriteCalls,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const folderCalls: Array<Record<string, unknown>> = [];
  const dualWriteCalls: Array<Record<string, unknown>> = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => {
          // .where() may terminate (agents list) or continue to .limit().
          const result = selectQueue.shift() ?? [];
          const thenable = Promise.resolve(result) as Promise<unknown[]> & {
            limit: (n: number) => Promise<unknown[]>;
          };
          thenable.limit = async () => result;
          return thenable;
        }),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
          returning: async () => returningQueue.shift() ?? [{ id: "new-id" }],
        };
      },
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push(values);
        return { where: async () => undefined };
      },
    })),
  };
  return {
    mockDb,
    selectQueue,
    insertCalls,
    updateCalls,
    returningQueue,
    folderCalls,
    dualWriteCalls,
  };
});

vi.mock("../../graphql/utils.js", () => ({ db: mockDb }));
vi.mock("../capabilities/folder-write.js", () => ({
  connectionDefinitionFromRegistryRow: (row: { slug: string | null }) => ({
    slug: row.slug ?? "digital-twin",
    definition: "# Company Brain connector\n",
  }),
  putCapabilityFolder: vi.fn(async (input: Record<string, unknown>) => {
    folderCalls.push(input);
    return { ok: true };
  }),
}));
vi.mock("../capabilities/registry-trust-flag.js", () => ({
  capabilityRegistryTrustEnabled: async () => false,
}));
vi.mock("../skills/assignment-state.js", () => ({
  resolveAgentWorkspacePrefix: async (agentId: string) =>
    agentId === "agent-no-workspace" ? null : `tenants/t/agents/${agentId}/`,
}));
vi.mock("../mcp/assignment-state.js", () => ({
  materializeMcpAssignmentFoldersForAgents: vi.fn(
    async (input: Record<string, unknown>) => {
      dualWriteCalls.push(input);
      return 1;
    },
  ),
}));

import {
  generateTwinKey,
  TWIN_CONNECTION_GUIDANCE,
  TWIN_CONNECTOR_OPERATIONS,
  hashTwinKey,
  provisionTwinConnector,
  twinConnectorAuthConfig,
  twinConnectorRowValues,
  TWIN_CONNECTOR_SLUG,
} from "./provision-connector.js";
import { computeMcpUrlHash } from "../mcp-server-hash.js";

const INPUT = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  twinMcpUrl: "https://api.dev.example.com/mcp/twin",
  stage: "dev",
};
const SECRET_REF = `thinkwork/dev/mcp/${INPUT.tenantId}/digital-twin`;

const smSends: unknown[] = [];
const sm = {
  send: async (command: unknown) => {
    smSends.push(command);
    return { ARN: "arn:mock" };
  },
};

beforeEach(() => {
  selectQueue.length = 0;
  returningQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  folderCalls.length = 0;
  dualWriteCalls.length = 0;
  smSends.length = 0;
});

describe("twin key minting", () => {
  it("mints tkt_-prefixed keys whose stored form is the SHA-256 hash", () => {
    const { raw, hash } = generateTwinKey();
    expect(raw).toMatch(/^tkt_[A-Za-z0-9_-]{40,}$/);
    expect(hash).toBe(hashTwinKey(raw));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw.slice(4, 12));
  });
});

describe("twin connector row values", () => {
  it("is born approved with url_hash explicitly pinned to (url, auth_config)", () => {
    const values = twinConnectorRowValues({
      tenantId: INPUT.tenantId,
      twinMcpUrl: INPUT.twinMcpUrl,
      secretRef: SECRET_REF,
    });
    expect(values.status).toBe("approved");
    expect(values.slug).toBe(TWIN_CONNECTOR_SLUG);
    expect(values.transport).toBe("streamable-http");
    expect(values.url_hash).toBe(
      computeMcpUrlHash(INPUT.twinMcpUrl, values.auth_config),
    );
    expect(values.url_hash).toBeTruthy();
    expect(values.approved_at).toBeInstanceOf(Date);
  });

  it("opts the Brain connector into longRunning + onBehalfOf (THINK-623/626)", () => {
    const values = twinConnectorRowValues({
      tenantId: INPUT.tenantId,
      twinMcpUrl: INPUT.twinMcpUrl,
      secretRef: SECRET_REF,
    });
    // `runtime_metadata` is what buildMcpConfigs reads to emit the two
    // per-server flags; re-provisioning rewrites this key, so a reinstall
    // carries both opt-ins rather than silently reverting to the fixed
    // 60s wall and no on-behalf-of assertion.
    expect(values.runtime_metadata).toEqual({
      longRunning: true,
      onBehalfOf: true,
    });
  });

  it("auth_config holds only the secret reference — never a key value", () => {
    const authConfig = twinConnectorAuthConfig(SECRET_REF);
    expect(JSON.stringify(authConfig)).not.toContain("tkt_");
    expect(authConfig).toMatchObject({
      secretRef: SECRET_REF,
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "token",
          valuePrefix: "Bearer ",
        },
      ],
    });
  });
});

describe("provisionTwinConnector", () => {
  function queueFreshTenant(agents: Array<{ id: string }>) {
    selectQueue.push([]); // no outgoing active keys (manifest grace scan)
    returningQueue.push([{ id: "key-1" }]); // key insert
    selectQueue.push([]); // no existing server row
    returningQueue.push([{ id: "server-1" }]); // server insert
    selectQueue.push([]); // no existing kb row
    returningQueue.push([{ id: "server-kb-1" }]); // kb server insert
    selectQueue.push([
      {
        id: "server-1",
        slug: "digital-twin",
        name: "Company Brain",
        url: INPUT.twinMcpUrl,
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]); // twin materialize re-read
    selectQueue.push(agents); // twin agent list
    selectQueue.push([
      {
        id: "server-kb-1",
        slug: "brain-kb",
        name: "Company Brain KB",
        url: "https://mcp.brain.example/kb",
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]); // kb materialize re-read
    selectQueue.push(agents); // kb agent list
  }

  it("fresh tenant: revokes-then-inserts the key, writes the secret, creates the approved row, materializes every workspace + dual-write", async () => {
    queueFreshTenant([{ id: "agent-1" }, { id: "agent-2" }]);
    const result = await provisionTwinConnector(INPUT, { sm });

    expect(result.provisioned).toBe("created");
    expect(result.secretRef).toBe(SECRET_REF);
    // Key: one revoke (update) before one insert with a 64-hex hash.
    expect(updateCalls[0]).toHaveProperty("revoked_at");
    expect(insertCalls[0]!.key_hash).toMatch(/^[0-9a-f]{64}$/);
    // The connector key backs the console proxy: wildcard grants, always.
    expect(insertCalls[0]!.security_groups).toEqual(["*"]);
    expect(insertCalls[0]!.kb_collections).toEqual(["*"]);
    // THINK-626: the platform's own key — and only it — may assert
    // on_behalf_of. User-minted keys are born false.
    expect(insertCalls[0]!.trusted_subsystem).toBe(true);
    // Secret written once with the raw key.
    expect(smSends.length).toBe(1);
    const secretString = (smSends[0] as { input: { SecretString: string } })
      .input.SecretString;
    expect(JSON.parse(secretString).token).toMatch(/^tkt_/);
    expect(JSON.parse(secretString).tenantId).toBe(INPUT.tenantId);
    // Registry row insert carries the pinned hash.
    expect(insertCalls[1]!.url_hash).toBeTruthy();
    expect(insertCalls[1]!.status).toBe("approved");
    // Both agents materialized + dual-write once for the batch.
    expect(result.workspaces.agents).toBe(2);
    // Two agents × two connectors (digital-twin + brain-kb).
    expect(folderCalls.length).toBe(4);
    // The operations list must name the server's REAL tools — it becomes
    // the runtime toolWhitelist; a wrong list silently drops every tool.
    const sidecar = folderCalls[0]!.sidecar as {
      permissions: { operations: string[] };
    };
    expect(sidecar.permissions.operations).toEqual([
      ...TWIN_CONNECTOR_OPERATIONS,
    ]);
    expect(dualWriteCalls).toEqual([
      {
        agentIds: ["agent-1", "agent-2"],
        tenantId: INPUT.tenantId,
        registryServerId: "server-1",
      },
      {
        agentIds: ["agent-1", "agent-2"],
        tenantId: INPUT.tenantId,
        registryServerId: "server-kb-1",
      },
    ]);
  });

  it("re-run rotates: existing server row updated in place (same id), old key revoked first", async () => {
    selectQueue.push([]); // outgoing active keys (manifest grace scan)
    returningQueue.push([{ id: "key-2" }]);
    selectQueue.push([{ id: "server-1", auth_config: null }]); // existing server
    selectQueue.push([]); // no existing kb row
    returningQueue.push([{ id: "server-kb-1" }]);
    selectQueue.push([
      {
        id: "server-1",
        slug: "digital-twin",
        name: "Company Brain",
        url: INPUT.twinMcpUrl,
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([{ id: "agent-1" }]);
    selectQueue.push([
      {
        id: "server-kb-1",
        slug: "brain-kb",
        name: "Company Brain KB",
        url: "https://mcp.brain.example/kb",
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([{ id: "agent-1" }]);
    const result = await provisionTwinConnector(INPUT, { sm });
    expect(result.provisioned).toBe("rotated");
    expect(result.tenantMcpServerId).toBe("server-1");
    // update #1 = key revoke, update #2 = server row rewrite w/ re-pinned hash.
    expect(updateCalls[1]!.url_hash).toBeTruthy();
    expect(updateCalls[1]!.status).toBe("approved");
  });

  it("machine-lane preservation: a row repointed at the m2m lane secret KEEPS it across reprovision (THINK-628)", async () => {
    selectQueue.push([]); // outgoing keys scan
    returningQueue.push([{ id: "key-2" }]);
    selectQueue.push([
      {
        id: "server-1",
        auth_config: {
          secretRef: "etl-platform/brain-mcp/m2m/platform-agent",
          headers: [
            {
              name: "Authorization",
              secretJsonKey: "token",
              valuePrefix: "Bearer ",
            },
          ],
        },
      },
    ]); // existing twin row — already flipped onto the lane
    selectQueue.push([]); // no existing kb row
    returningQueue.push([{ id: "server-kb-1" }]);
    selectQueue.push([
      {
        id: "server-1",
        slug: "digital-twin",
        name: "Company Brain",
        url: INPUT.twinMcpUrl,
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([]); // no agents (twin)
    selectQueue.push([
      {
        id: "server-kb-1",
        slug: "brain-kb",
        name: "Company Brain KB",
        url: "https://mcp.brain.example/kb",
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([]); // no agents (kb)

    await provisionTwinConnector(INPUT, { sm });

    // update #1 = key revoke; #2 = twin row rewrite. The lane secretRef
    // survives — clobbering it back to the tkt_ secret was the trap that
    // silently un-flipped the lane (and killed KB citations) on rotation.
    const twinUpdate = updateCalls[1] as {
      auth_config: { secretRef: string };
      url_hash: string;
    };
    expect(twinUpdate.auth_config.secretRef).toBe(
      "etl-platform/brain-mcp/m2m/platform-agent",
    );
    // And the hash is re-pinned against the PRESERVED config, so the
    // url_hash approval fence keeps passing.
    expect(twinUpdate.url_hash).toBeTruthy();
  });

  it("an agent without a workspace prefix is skipped, others proceed", async () => {
    queueFreshTenant([{ id: "agent-no-workspace" }, { id: "agent-2" }]);
    const result = await provisionTwinConnector(INPUT, { sm });
    expect(result.workspaces.agents).toBe(1);
    // The workspace-less agent is skipped by BOTH connector materializations.
    expect(result.workspaces.skipped).toEqual([
      { agentId: "agent-no-workspace", reason: "no_workspace_prefix" },
      { agentId: "agent-no-workspace", reason: "no_workspace_prefix" },
    ]);
  });
});

describe("provisionTwinConnector key-manifest publishing (U12 KTD amendment)", () => {
  const BUCKET = "thinkwork-test-brain-artifacts";
  interface CapturedPut {
    Bucket?: string;
    Key?: string;
    Body?: string;
    ContentType?: string;
  }
  const puts: CapturedPut[] = [];
  const manifestS3 = {
    send: async (command: unknown) => {
      puts.push((command as { input: CapturedPut }).input);
      return {};
    },
  };
  const manifestHashes = (index: number): string[] =>
    (
      JSON.parse(puts[index]!.Body!) as {
        keys: Array<{ keyHash: string }>;
      }
    ).keys.map((k) => k.keyHash);

  beforeEach(() => {
    puts.length = 0;
  });

  it("fresh mint publishes the active-only manifest once, after the key row exists", async () => {
    selectQueue.push([]); // no outgoing keys → no grace publish
    returningQueue.push([{ id: "key-1" }]);
    selectQueue.push([]); // no existing server
    returningQueue.push([{ id: "server-1" }]);
    selectQueue.push([]); // no existing kb row
    returningQueue.push([{ id: "server-kb-1" }]);
    selectQueue.push([
      {
        id: "server-1",
        slug: "digital-twin",
        name: "Company Brain",
        url: INPUT.twinMcpUrl,
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([]); // no agents (twin)
    selectQueue.push([
      {
        id: "server-kb-1",
        slug: "brain-kb",
        name: "Company Brain KB",
        url: "https://mcp.brain.example/kb",
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([]); // no agents (kb)
    selectQueue.push([
      {
        id: "key-1",
        key_hash: "new-hash",
        name: "default",
        created_at: new Date("2026-07-24T00:00:00Z"),
        security_groups: ["*"],
        kb_collections: ["*"],
      },
    ]); // final publish active scan

    const result = await provisionTwinConnector(INPUT, {
      sm,
      manifestS3,
      manifestBucket: BUCKET,
    });
    expect(result.keyManifest).toEqual({ published: true, errors: [] });
    expect(puts.length).toBe(1);
    expect(puts[0]!.Bucket).toBe(BUCKET);
    expect(puts[0]!.Key).toBe(`twin-mcp-keys/${INPUT.tenantId}/latest.json`);
    expect(puts[0]!.ContentType).toBe("application/json");
    expect(manifestHashes(0)).toEqual(["new-hash"]);
    // v2: the connector key publishes with the wildcard grants.
    const doc = JSON.parse(puts[0]!.Body!) as {
      formatVersion: string;
      keys: Array<{ securityGroups: string[]; kbCollections: string[] }>;
    };
    expect(doc.formatVersion).toBe("twin-mcp-keys/v2");
    expect(doc.keys[0]!.securityGroups).toEqual(["*"]);
    expect(doc.keys[0]!.kbCollections).toEqual(["*"]);
  });

  it("rotation keeps BOTH hashes live: grace publish carries old+new, final publish is active-only", async () => {
    const oldCreated = new Date("2026-01-01T00:00:00Z");
    selectQueue.push([
      {
        id: "key-1",
        key_hash: "old-hash",
        name: "default",
        created_at: oldCreated,
        security_groups: ["*"],
        kb_collections: ["*"],
      },
    ]); // outgoing scan
    returningQueue.push([{ id: "key-2" }]);
    selectQueue.push([
      { key_hash: "new-hash", created_at: new Date("2026-07-24T00:00:00Z") },
    ]); // grace publish active scan (old row already revoked)
    selectQueue.push([{ id: "server-1", auth_config: null }]); // existing server
    selectQueue.push([]); // no existing kb row
    returningQueue.push([{ id: "server-kb-1" }]);
    selectQueue.push([
      {
        id: "server-1",
        slug: "digital-twin",
        name: "Company Brain",
        url: INPUT.twinMcpUrl,
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([]); // no agents (twin)
    selectQueue.push([
      {
        id: "server-kb-1",
        slug: "brain-kb",
        name: "Company Brain KB",
        url: "https://mcp.brain.example/kb",
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([]); // no agents (kb)
    selectQueue.push([
      { key_hash: "new-hash", created_at: new Date("2026-07-24T00:00:00Z") },
    ]); // final publish active scan

    const result = await provisionTwinConnector(INPUT, {
      sm,
      manifestS3,
      manifestBucket: BUCKET,
    });
    expect(result.provisioned).toBe("rotated");
    expect(result.keyManifest).toEqual({ published: true, errors: [] });
    expect(puts.length).toBe(2);
    // Grace publish (before the secret repoint completes): both hashes.
    expect(manifestHashes(0).sort()).toEqual(["new-hash", "old-hash"]);
    const graceOld = (
      JSON.parse(puts[0]!.Body!) as {
        keys: Array<{
          keyHash: string;
          createdAt: string | null;
          securityGroups: string[];
          kbCollections: string[];
        }>;
      }
    ).keys.find((k) => k.keyHash === "old-hash");
    expect(graceOld!.createdAt).toBe(oldCreated.toISOString());
    // The rotated-out key keeps its grants for the cache overlap window.
    expect(graceOld!.securityGroups).toEqual(["*"]);
    expect(graceOld!.kbCollections).toEqual(["*"]);
    // Final publish: the rotated-out hash is gone.
    expect(manifestHashes(1)).toEqual(["new-hash"]);
  });

  it("manifest publish failure never fails the provisioning mutation — it surfaces in keyManifest", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      selectQueue.push([{ key_hash: "old-hash", created_at: null }]); // outgoing
      returningQueue.push([{ id: "key-2" }]);
      selectQueue.push([{ key_hash: "new-hash", created_at: null }]); // grace scan
      selectQueue.push([{ id: "server-1", auth_config: null }]);
      selectQueue.push([]); // no existing kb row
      returningQueue.push([{ id: "server-kb-1" }]);
      selectQueue.push([
        {
          id: "server-1",
          slug: "digital-twin",
          name: "Company Brain",
          url: INPUT.twinMcpUrl,
          transport: "streamable-http",
          tools: null,
          status: "approved",
        },
      ]);
      selectQueue.push([]); // no agents (twin)
      selectQueue.push([
        {
          id: "server-kb-1",
          slug: "brain-kb",
          name: "Company Brain KB",
          url: "https://mcp.brain.example/kb",
          transport: "streamable-http",
          tools: null,
          status: "approved",
        },
      ]);
      selectQueue.push([]); // no agents (kb)
      selectQueue.push([{ key_hash: "new-hash", created_at: null }]); // final scan

      const result = await provisionTwinConnector(INPUT, {
        sm,
        manifestS3: {
          send: async () => {
            throw new Error("s3 exploded");
          },
        },
        manifestBucket: BUCKET,
      });
      // The ceremony still completed end-to-end.
      expect(result.provisioned).toBe("rotated");
      expect(result.keyId).toBe("key-2");
      expect(smSends.length).toBe(1); // secret still written
      // ...and the failure is loud in the response metadata.
      expect(result.keyManifest.published).toBe(false);
      expect(result.keyManifest.errors).toEqual([
        "grace publish failed: s3 exploded",
        "publish failed: s3 exploded",
      ]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("Brain tool surface + routing guidance (THINK-629)", () => {
  // The operations list IS the runtime toolAllowlist. Pinning the exact
  // names here is deliberate: a rename on the Brain side must fail this
  // test rather than silently strand the agent with a connected server
  // and zero tools.
  it("names exactly the end-user Brain tools", () => {
    expect([...TWIN_CONNECTOR_OPERATIONS]).toEqual([
      "brain_search",
      "brain_ask",
      "brain_ask_submit",
      "brain_ask_result",
      "brain_capabilities",
      "brain_counts",
      "brain_describe_entity",
    ]);
  });

  it("never grants the operator-only query surface", () => {
    // brain_cypher and brain_describe_ontology are gated operator-only
    // server-side under the retrieval-agent cutover — listing them would
    // advertise tools the Brain refuses to run for this key.
    for (const operatorOnly of ["brain_cypher", "brain_describe_ontology"]) {
      expect([...TWIN_CONNECTOR_OPERATIONS]).not.toContain(operatorOnly);
      expect(TWIN_CONNECTION_GUIDANCE).not.toContain(operatorOnly);
    }
  });

  it("teaches the two lanes in the generated CONNECTION.md", () => {
    // Routing KB/document questions through brain_ask was a customer-
    // visible quality regression (2026-08-06): the direct search tool
    // returns reranked, cited excerpts with no Brain-side model call.
    // Reflowed to one line — the source is hard-wrapped prose.
    const guidance = TWIN_CONNECTION_GUIDANCE.replace(/\s+/g, " ");
    expect(guidance).toContain("brain_knowledge_search");
    expect(guidance).toContain(
      "Never route a pure document question through `brain_ask`",
    );
    expect(guidance).toContain("call `brain_ask` with the question");
    expect(guidance).toContain("`brain_ask_submit`");
    expect(guidance).toContain("poll `brain_ask_result`");
    expect(guidance).toContain("Call `brain_capabilities` once");
  });

  it("appends the guidance to every materialized connector folder", async () => {
    selectQueue.push([]); // no outgoing active keys
    returningQueue.push([{ id: "key-1" }]);
    selectQueue.push([]); // no existing server row
    returningQueue.push([{ id: "server-1" }]);
    selectQueue.push([]); // no existing kb row
    returningQueue.push([{ id: "server-kb-1" }]);
    selectQueue.push([
      {
        id: "server-1",
        slug: "digital-twin",
        name: "Company Brain",
        url: INPUT.twinMcpUrl,
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([{ id: "agent-1" }, { id: "agent-2" }]);
    selectQueue.push([
      {
        id: "server-kb-1",
        slug: "brain-kb",
        name: "Company Brain KB",
        url: "https://mcp.brain.example/kb",
        transport: "streamable-http",
        tools: null,
        status: "approved",
      },
    ]);
    selectQueue.push([{ id: "agent-1" }, { id: "agent-2" }]);

    await provisionTwinConnector(INPUT, { sm });

    // 2 agents × 2 connectors; the first two calls are the twin folders.
    expect(folderCalls.length).toBe(4);
    const kbDefinition = String(folderCalls[2]!.definition);
    expect(kbDefinition).toContain("## Searching company knowledge");
    expect(kbDefinition).toContain("brain_knowledge_search");
    const kbSidecar = folderCalls[2]!.sidecar as {
      permissions: { operations: string[] };
    };
    expect(kbSidecar.permissions.operations).toEqual([
      "brain_knowledge_search",
    ]);
    for (const call of folderCalls.slice(0, 2)) {
      const definition = String(call.definition);
      expect(definition).toContain("## Querying the company brain");
      expect(definition).toContain("brain_knowledge_search");
      expect(definition).toContain("brain_ask");
    }
  });
});
