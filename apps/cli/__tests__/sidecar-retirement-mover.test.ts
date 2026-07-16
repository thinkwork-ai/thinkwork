import { describe, it, expect } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  signCapabilitySidecar,
  type CapabilitySignedBy,
} from "@thinkwork/api/src/lib/capabilities/sidecar-signing.js";
import {
  migrateSidecarRetirement,
  type SidecarBindingInput,
  type SidecarRetirementScopeDb,
  type WorkspaceObjectStore,
} from "../src/lib/migrations/sidecar-retirement-mover.js";

// ── Fakes ────────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const PREFIX = "tenants/acme/agents/helper/";

class InMemoryStore implements WorkspaceObjectStore {
  files = new Map<string, string>();
  writes: string[] = [];
  deletes: string[] = [];
  copies: Array<[string, string]> = [];

  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix));
  }
  async read(key: string): Promise<string | null> {
    return this.files.get(key) ?? null;
  }
  async write(key: string, body: string): Promise<void> {
    this.writes.push(key);
    this.files.set(key, body);
  }
  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.deletes.push(key);
      this.files.delete(key);
    }
  }
  async copy(source: string, target: string): Promise<void> {
    this.copies.push([source, target]);
    const value = this.files.get(source);
    if (value != null) this.files.set(target, value);
  }
}

const scopeDb: SidecarRetirementScopeDb = {
  async resolveScope({ subAgentSlug }) {
    return {
      tenantId: TENANT_ID,
      scopeRef: subAgentSlug
        ? `agent:${AGENT_ID}/sub:${subAgentSlug}`
        : `agent:${AGENT_ID}`,
    };
  },
  async mcpOrigin({ slug }) {
    return slug === "dagster" ? "operator-installed" : "plugin-reconciler";
  },
};

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = capabilitySignerFromKey(privateKey);
const verifier = capabilityVerifierFromKey(publicKey);

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Build the on-disk signed sidecar JSON (matches folder-write's shape). */
function signedSidecar(
  base: Record<string, unknown>,
  definitionBytes: string,
  signedBy: CapabilitySignedBy,
): string {
  const { signed_content_sha, signature } = signCapabilitySidecar({
    signer,
    sidecar: base,
    definitionBytes,
    signedBy,
  });
  return `${JSON.stringify({ ...base, signed_content_sha, signature }, null, 2)}\n`;
}

const CONNECTION_MD = `---
name: slack
description: Slack connector for the team
type: mcp
---

Slack connection body.
`;

const TOOL_MD = `---
name: calc
description: A little calculator tool
---

Tool body.
`;

const SKILL_MD = `---
name: writer
description: Drafts documents from an outline
---

Skill body.
`;

interface RunResult {
  store: InMemoryStore;
  bindings: SidecarBindingInput[];
  summary: Awaited<ReturnType<typeof migrateSidecarRetirement>>;
}

async function run(
  store: InMemoryStore,
  mode: "dry-run" | "apply",
): Promise<RunResult> {
  const bindings: SidecarBindingInput[] = [];
  const summary = await migrateSidecarRetirement({
    store,
    db: scopeDb,
    recordBinding: async (input) => {
      bindings.push(input);
    },
    verifier,
    mode,
  });
  return { store, bindings, summary };
}

/** A world with one clean signed connection folder. */
function connectionWorld(): InMemoryStore {
  const store = new InMemoryStore();
  store.files.set(`${PREFIX}connectors/slack/CONNECTION.md`, CONNECTION_MD);
  store.files.set(
    `${PREFIX}connectors/slack/.assignment.json`,
    signedSidecar(
      {
        slug: "slack",
        class: "connection",
        updated_at: "2026-01-01T00:00:00.000Z",
        permissions: { operations: ["chat.post", "channels.list"] },
        approval: "once",
        config: { registryServerId: "srv_1" },
      },
      CONNECTION_MD,
      "operator:eric",
    ),
  );
  return store;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("migrateSidecarRetirement", () => {
  it("clean connection: binding carries the POST-merge sha (regression)", async () => {
    const store = connectionWorld();
    const preMergeSha = sha256(CONNECTION_MD);

    const { bindings, summary } = await run(store, "apply");

    expect(summary.plans).toHaveLength(1);
    const plan = summary.plans[0];
    expect(plan.disposition).toBe("clean-binding");

    // The merged marker bytes differ from the pre-merge bytes...
    const mergedBytes = store.files.get(
      `${PREFIX}connectors/slack/CONNECTION.md`,
    );
    expect(mergedBytes).toBeDefined();
    const postMergeSha = sha256(mergedBytes!);
    expect(postMergeSha).not.toBe(preMergeSha);

    // ...and the binding pins the POST-merge sha, not the pre-merge one.
    expect(bindings).toHaveLength(1);
    expect(bindings[0].markerSha).toBe(postMergeSha);
    expect(bindings[0].markerSha).not.toBe(preMergeSha);
    expect(plan.markerShaBefore).toBe(preMergeSha);
    expect(plan.markerShaAfter).toBe(postMergeSha);

    // Config was actually merged into the frontmatter.
    expect(mergedBytes).toContain("registryServerId: srv_1");
    expect(mergedBytes).toContain("approval: once");

    // Sidecar deleted LAST (present in the delete log, gone from the store).
    expect(store.deletes).toContain(
      `${PREFIX}connectors/slack/.assignment.json`,
    );
    expect(store.files.has(`${PREFIX}connectors/slack/.assignment.json`)).toBe(
      false,
    );
  });

  it("provenance preserved: enveloped pair records the envelope signed_by/signed_at", async () => {
    const store = connectionWorld();
    const sidecarRaw = store.files.get(
      `${PREFIX}connectors/slack/.assignment.json`,
    )!;
    const envelope = (
      JSON.parse(sidecarRaw) as { signature: Record<string, string> }
    ).signature;

    const { bindings } = await run(store, "apply");

    expect(bindings[0].signedBy).toBe("operator:eric");
    expect(bindings[0].signedBy).not.toBe("backfill");
    expect(bindings[0].signedAt).toBe(envelope.signed_at);
  });

  it("clean tool: enveloped pair → binding at post-merge sha", async () => {
    const store = new InMemoryStore();
    store.files.set(`${PREFIX}tools/calc/TOOL.md`, TOOL_MD);
    store.files.set(
      `${PREFIX}tools/calc/.assignment.json`,
      signedSidecar(
        {
          slug: "calc",
          class: "tool",
          updated_at: "2026-01-01T00:00:00.000Z",
          approval: "always",
          permissions: { operations: ["evaluate"] },
        },
        TOOL_MD,
        "operator:eric",
      ),
    );

    const { bindings, summary } = await run(store, "apply");

    expect(summary.plans[0].disposition).toBe("clean-binding");
    const merged = store.files.get(`${PREFIX}tools/calc/TOOL.md`)!;
    expect(bindings[0].markerSha).toBe(sha256(merged));
    expect(sha256(merged)).not.toBe(sha256(TOOL_MD));
  });

  it("envelope-absent skill: backfill binding (active)", async () => {
    const store = new InMemoryStore();
    store.files.set(`${PREFIX}skills/writer/SKILL.md`, SKILL_MD);
    store.files.set(
      `${PREFIX}skills/writer/.assignment.json`,
      JSON.stringify(
        {
          slug: "writer",
          permissions: { operations: ["draft"] },
          config: { connectionId: "conn_1" },
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const { bindings, summary } = await run(store, "apply");

    expect(summary.plans[0].disposition).toBe("clean-binding");
    expect(bindings).toHaveLength(1);
    expect(bindings[0].class).toBe("skill");
    expect(bindings[0].signedBy).toBe("backfill");
    const merged = store.files.get(`${PREFIX}skills/writer/SKILL.md`)!;
    expect(bindings[0].markerSha).toBe(sha256(merged));
    expect(sha256(merged)).not.toBe(sha256(SKILL_MD));
    expect(merged).toContain("connectionId: conn_1");
  });

  it("drifted marker: config merged, NO binding, folder stays", async () => {
    const store = new InMemoryStore();
    store.files.set(`${PREFIX}connectors/drifted/CONNECTION.md`, CONNECTION_MD);
    // Envelope pins DIFFERENT (older) bytes → definition_drift at verify time.
    store.files.set(
      `${PREFIX}connectors/drifted/.assignment.json`,
      signedSidecar(
        {
          slug: "drifted",
          class: "connection",
          updated_at: "2026-01-01T00:00:00.000Z",
          approval: "once",
          config: { registryServerId: "srv_2" },
        },
        "---\nname: drifted\ndescription: OLD reviewed bytes\ntype: mcp\n---\n",
        "operator:eric",
      ),
    );

    const { bindings, summary } = await run(store, "apply");

    const plan = summary.plans[0];
    expect(plan.disposition).toBe("drift-no-binding");
    expect(plan.reason).toBe("definition_drift");
    expect(bindings).toHaveLength(0);

    // Behavioral config still merged into the frontmatter...
    const merged = store.files.get(`${PREFIX}connectors/drifted/CONNECTION.md`);
    expect(merged).toBeDefined();
    expect(merged).toContain("registryServerId: srv_2");
    // ...and the sidecar is retired (would re-compile withheld).
    expect(
      store.files.has(`${PREFIX}connectors/drifted/.assignment.json`),
    ).toBe(false);
  });

  it("envelope-absent connection: NO binding (unsigned proposal)", async () => {
    const store = new InMemoryStore();
    store.files.set(
      `${PREFIX}connectors/proposal/CONNECTION.md`,
      CONNECTION_MD,
    );
    store.files.set(
      `${PREFIX}connectors/proposal/.assignment.json`,
      JSON.stringify(
        {
          slug: "proposal",
          class: "connection",
          permissions: { operations: ["chat.post"] },
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const { bindings, summary } = await run(store, "apply");

    expect(summary.plans[0].disposition).toBe("drift-no-binding");
    expect(summary.plans[0].reason).toBe("unsigned");
    expect(bindings).toHaveLength(0);
  });

  it("McpAssignmentState: MCP.md written + agent-root binding + origin annotation", async () => {
    const store = new InMemoryStore();
    store.files.set(
      `${PREFIX}mcp/dagster/.assignment.json`,
      JSON.stringify(
        {
          slug: "dagster",
          name: "Dagster",
          registryServerId: "srv_9",
          transport: "streamable-http",
          authType: "service_credential",
          secretRef: "arn:aws:secretsmanager:us-east-1:1:secret:x",
          enabledTools: ["run_pipeline"],
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const { bindings, summary } = await run(store, "apply");

    const plan = summary.plans[0];
    expect(plan.disposition).toBe("mcp-backfill");
    expect(plan.origin).toBe("operator-installed");

    const mcpMd = store.files.get(`${PREFIX}mcp/dagster/MCP.md`);
    expect(mcpMd).toBeDefined();
    expect(mcpMd).toContain("server: srv_9");

    expect(bindings).toHaveLength(1);
    expect(bindings[0].class).toBe("mcp");
    expect(bindings[0].slug).toBe("dagster");
    expect(bindings[0].scopeRef).toBe(`agent:${AGENT_ID}`);
    expect(bindings[0].signedBy).toBe("backfill");
    expect(bindings[0].origin).toBe("operator-installed");
    expect(bindings[0].markerSha).toBe(sha256(mcpMd!));

    // Sidecar retired last.
    expect(store.files.has(`${PREFIX}mcp/dagster/.assignment.json`)).toBe(
      false,
    );
  });

  it("idempotent: a second apply run over migrated folders is a no-op", async () => {
    const store = connectionWorld();
    await run(store, "apply");

    // Reset the mutation logs so the second run's deltas are measured cleanly.
    store.writes = [];
    store.deletes = [];
    const second = await run(store, "apply");

    expect(second.summary.plans).toHaveLength(0);
    expect(second.bindings).toHaveLength(0);
    expect(second.store.deletes).toHaveLength(0);
    expect(second.store.writes).toHaveLength(0);
  });

  it("dry-run writes nothing: no PutObject, no DeleteObject, no binding", async () => {
    const store = connectionWorld();

    const { bindings, summary } = await run(store, "dry-run");

    expect(summary.plans[0].disposition).toBe("clean-binding");
    // The plan is computed, but nothing was mutated.
    expect(store.writes).toHaveLength(0);
    expect(store.deletes).toHaveLength(0);
    expect(bindings).toHaveLength(0);
    // The sidecar and original marker are untouched.
    expect(store.files.get(`${PREFIX}connectors/slack/CONNECTION.md`)).toBe(
      CONNECTION_MD,
    );
    expect(store.files.has(`${PREFIX}connectors/slack/.assignment.json`)).toBe(
      true,
    );
  });
});
