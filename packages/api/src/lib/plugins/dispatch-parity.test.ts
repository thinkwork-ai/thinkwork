/**
 * Dispatch-parity test for plugin activation gating (plan 2026-06-12-001
 * U7). THE seam test: chat-agent-invoke and wakeup-processor build their
 * payloads through separate code paths, and this seam has produced three
 * prior bugs. After U7 both paths flow through the SAME chokepoints:
 *
 *   MCP side   — buildMcpConfigs(agentId, { humanPairId, requesterUserId })
 *                followed by applyWorkspaceMcpPolicyFilter (gating.ts).
 *   Skills side — renderWorkspaceTuple → resolvePluginGate (gating.ts),
 *                which excludes plugin skill folders + CONTEXT.md routing
 *                entries from the hydrate manifest.
 *
 * This test drives both builders' chokepoints with each path's exact
 * identity construction:
 *
 *   chat:   requesterUserId = currentUserId ?? null; render userId =
 *           currentUserId (chat-agent-invoke.ts ~1014/~664).
 *   wakeup: invokerUserId = requested_by_actor_type === 'user' ?
 *           requested_by_actor_id : undefined; requesterUserId =
 *           invokerUserId ?? null; render userId = costOwnerUserId ?? null
 *           (wakeup-processor.ts ~558/~1562/~1711).
 *
 * and asserts: same user, same tenant, same plugin state + MCP auth state →
 * IDENTICAL gated tool surface and IDENTICAL skill-folder exclusions on the
 * chat turn and the wakeup/resume turn; clearing both user auth states between
 * turns drops tools AND skills on the resume turn; no resolvable requester
 * fails closed in both builders.
 *
 * Fixture approach mirrors mcp-configs-plugin-auth.test.ts (mocked getDb
 * runtime config rows + in-memory plugin store/secrets through the injectable
 * seams) plus compose-tuple.test.ts (fake repository/object store).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgentRows,
  mockJoinRows,
  mockAssignmentRows,
  mockUserTokenRows,
  mockSecretString,
} = vi.hoisted(() => ({
  mockAgentRows: vi.fn(),
  mockJoinRows: vi.fn(),
  mockAssignmentRows: vi.fn(),
  mockUserTokenRows: vi.fn(),
  mockSecretString: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: () => ({
            where: () => Promise.resolve(mockJoinRows()),
          }),
          where: () => {
            if (table === actual.schema.agents) {
              return {
                limit: () => Promise.resolve(mockAgentRows()),
              };
            }
            if (table === actual.schema.tenantMcpServers) {
              return Promise.resolve(mockJoinRows());
            }
            if (table === actual.schema.agentMcpServers) {
              return Promise.resolve(mockAssignmentRows());
            }
            return {
              limit: () => Promise.resolve(mockUserTokenRows()),
            };
          },
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }),
  };
});

vi.mock("@aws-sdk/client-secrets-manager", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aws-sdk/client-secrets-manager")>();
  class Stub {
    async send() {
      return { SecretString: mockSecretString() };
    }
  }
  return {
    ...actual,
    SecretsManagerClient: Stub,
  };
});

/* eslint-disable import/first */
import { buildMcpConfigs } from "../mcp-configs.js";
import {
  createPluginDispatchAuthResolver,
  type PluginDispatchAuthResolver,
} from "./activation.js";
import { applyWorkspaceMcpPolicyFilter, resolvePluginGate } from "./gating.js";
import {
  createInMemoryPluginEngineStore,
  createInMemoryPluginSecrets,
  type InMemoryPluginEngineStore,
  type InMemoryPluginSecrets,
} from "./testing.js";
import { renderWorkspaceTuple } from "../workspace-renderer/compose-tuple.js";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceTupleRepository,
  WorkspaceRenderTupleInput,
} from "../workspace-renderer/types.js";
/* eslint-enable import/first */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = "tenant-1";
const AGENT = "agent-1";
const HUMAN_PAIR = "human-pair-1";
const ALICE = "user-alice"; // activated
const BOB = "user-bob"; // never activated
const INSTALL = "install-lastmile-1";
const PLUGIN_SKILL_FOLDER = "skills/lastmile--crm-basics/";
const PLAIN_SKILL_FOLDER = "skills/notes-helper/";

const CONTEXT_MD = [
  "# Context",
  "",
  "- For tasks covered by the `lastmile--crm-basics` skill, read skills/lastmile--crm-basics/SKILL.md and follow it.",
  "- For tasks covered by the `notes-helper` skill, read skills/notes-helper/SKILL.md and follow it.",
  "",
].join("\n");

function pluginMcpRow(key: string) {
  return {
    mcp_server_id: `srv-${key}`,
    name: key.toUpperCase(),
    slug: `lastmile--${key}`,
    url: `https://${key}.lastmile.invalid/mcp`,
    transport: "streamable-http",
    auth_type: "oauth",
    auth_config: { oauth_resource: `https://${key}.lastmile.invalid` },
    tools: null,
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "plugin",
    plugin_install_id: INSTALL,
    assignment_enabled: true,
    assignment_config: null,
  };
}

function directMcpRow() {
  return {
    mcp_server_id: "srv-direct",
    name: "Direct",
    slug: "direct-server",
    url: "https://direct.example.invalid/mcp",
    transport: "streamable-http",
    auth_type: "none",
    auth_config: null,
    tools: null,
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "manual",
    plugin_install_id: null,
    assignment_enabled: true,
    assignment_config: null,
  };
}

class PerUserFakeRepository implements WorkspaceTupleRepository {
  async resolve(
    input: WorkspaceRenderTupleInput,
  ): Promise<ResolvedWorkspaceRenderTuple> {
    return {
      tenantId: TENANT,
      tenantSlug: "acme",
      agentId: AGENT,
      agentSlug: "platform-agent",
      agentName: "Platform Agent",
      spaceId: "default-space",
      spaceSlug: "default",
      spaceName: "Default",
      spaceKind: "default",
      spaceAccessMode: "public",
      spacePrompt: null,
      spaceToolPolicy: {},
      spaceMcpPolicy: {},
      threadId: input.threadId ?? null,
      threadSlug: input.threadSlug ?? input.threadId ?? null,
      userId: input.userId ?? null,
      userSlug: input.userId ? `slug-${input.userId}` : null,
      userName: null,
    };
  }
}

class FakeObjectStore implements WorkspaceRendererObjectStore {
  constructor(
    readonly objects = new Map<
      string,
      { content: string; lastModified: Date }
    >(),
  ) {}

  async listObjects(input: {
    prefix: string;
  }): Promise<WorkspaceObjectMetadata[]> {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(input.prefix))
      .map(([key, value]) => ({
        key,
        lastModified: value.lastModified,
        etag: `"${key}"`,
        size: value.content.length,
      }));
  }

  async getText(input: { key: string }): Promise<string | null> {
    return this.objects.get(input.key)?.content ?? null;
  }

  async putText(input: { key: string; content: string }): Promise<void> {
    this.objects.set(input.key, {
      content: input.content,
      lastModified: new Date("2026-06-12T12:00:00.000Z"),
    });
  }

  set(key: string, content: string): void {
    this.objects.set(key, {
      content,
      lastModified: new Date("2026-06-12T09:00:00.000Z"),
    });
  }
}

function seededObjectStore(): FakeObjectStore {
  const store = new FakeObjectStore();
  const prefix = "tenants/acme/agents/platform-agent/";
  store.set(`${prefix}AGENTS.md`, "# AGENTS.md\n\nRoot routing.\n");
  store.set(`${prefix}CONTEXT.md`, CONTEXT_MD);
  store.set(`${prefix}${PLUGIN_SKILL_FOLDER}SKILL.md`, "# LastMile CRM\n");
  store.set(`${prefix}${PLUGIN_SKILL_FOLDER}reference.md`, "# CRM reference\n");
  store.set(`${prefix}${PLAIN_SKILL_FOLDER}SKILL.md`, "# Notes helper\n");
  return store;
}

let pluginStore: InMemoryPluginEngineStore;
let pluginSecrets: InMemoryPluginSecrets;

function seedInstalledPlugin(): void {
  pluginStore.seedInstall({
    id: INSTALL,
    tenant_id: TENANT,
    plugin_key: "lastmile",
    state: "installed",
  });
  pluginStore.seedComponent({
    plugin_install_id: INSTALL,
    component_key: "skills",
    component_type: "skills",
    state: "provisioned",
    handler_ref: {
      seededCatalogPrefixes: [
        "tenants/acme/skill-catalog/lastmile--crm-basics/",
      ],
      workspaceFolders: [PLUGIN_SKILL_FOLDER],
      agentSlug: "platform-agent",
    },
  });
  pluginStore.seedComponent({
    plugin_install_id: INSTALL,
    component_key: "crm-mcp",
    component_type: "mcp-server",
    state: "provisioned",
  });
}

function activate(userId: string): void {
  const activation = pluginStore.seedActivation({
    user_id: userId,
    plugin_install_id: INSTALL,
    granted_scopes: ["openid"],
  });
  const resource = "https://crm.lastmile.invalid";
  const ref = `thinkwork/test/plugin-tokens/${userId}/${INSTALL}/crm`;
  pluginStore.seedToken({
    activation_id: activation.id,
    resource_indicator: resource,
    secret_ref: ref,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
  });
  pluginSecrets.values.set(
    ref,
    JSON.stringify({
      access_token: `plugin-token-${userId}`,
      refresh_token: "rt",
      token_type: "Bearer",
      client_id: "client-1",
      token_endpoint: "https://auth.example.invalid/token",
      resource,
    }),
  );
}

function authenticateMcp(): void {
  mockUserTokenRows.mockReturnValue([
    {
      id: "tok-lastmile-crm",
      secret_ref: "arn:lastmile-crm-user-token",
      status: "active",
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  ]);
  mockSecretString.mockReturnValue(
    JSON.stringify({ access_token: "lastmile-crm-user-token" }),
  );
}

function clearMcpAuth(): void {
  mockUserTokenRows.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
}

async function deactivate(userId: string): Promise<void> {
  const activation = await pluginStore.getActivationByUserAndInstall(
    userId,
    INSTALL,
  );
  if (!activation) throw new Error("activation not seeded");
  await pluginStore.deleteActivationTokens(activation.id);
  await pluginStore.updateActivationStatus(activation.id, "revoked");
}

function pluginAuth(): PluginDispatchAuthResolver {
  return createPluginDispatchAuthResolver({
    store: pluginStore,
    secrets: pluginSecrets,
    fetchFn: (async () => new Response("{}", { status: 500 })) as typeof fetch,
    now: () => new Date(),
  });
}

// ---------------------------------------------------------------------------
// One "gated turn surface" per builder, built EXACTLY the way each
// handler builds it.
// ---------------------------------------------------------------------------

interface GatedTurnSurface {
  toolNames: string[];
  workspaceFiles: string[];
  pluginSkillFiles: string[];
  contextMd: string | null;
}

async function renderSurface(
  objectStore: FakeObjectStore,
  renderUserId: string | null,
  threadId: string,
): Promise<{
  workspaceFiles: string[];
  pluginSkillFiles: string[];
  contextMd: string | null;
}> {
  const rendered = await renderWorkspaceTuple(
    {
      tenantId: TENANT,
      agentId: AGENT,
      spaceId: "default-space",
      threadId,
      threadSlug: threadId,
      userId: renderUserId,
    },
    {
      bucket: "workspace",
      repository: new PerUserFakeRepository(),
      objectStore,
      pluginGateResolver: (args) =>
        resolvePluginGate(args, { store: pluginStore }),
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    },
  );
  const workspaceFiles = rendered.hydrateManifest.files
    .map((file) => file.path)
    .sort();
  const pluginSkillFiles = workspaceFiles.filter((path) =>
    path.startsWith("skills/lastmile--"),
  );
  const contextEntry = rendered.hydrateManifest.files.find(
    (file) => file.path === "CONTEXT.md",
  );
  const contextMd = contextEntry
    ? await objectStore.getText({ key: contextEntry.sourceKey })
    : null;
  return { workspaceFiles, pluginSkillFiles, contextMd };
}

/** chat-agent-invoke shape: currentUserId drives BOTH halves. */
async function chatTurnSurface(
  objectStore: FakeObjectStore,
  currentUserId: string | null,
  threadId = "thread-chat",
): Promise<GatedTurnSurface> {
  const mcpConfigs = await buildMcpConfigs(
    AGENT,
    // resolve-agent-runtime-config.ts:664 — requesterUserId: opts.currentUserId ?? null
    { humanPairId: HUMAN_PAIR, requesterUserId: currentUserId ?? null },
    "[chat-agent-invoke]",
    { pluginAuth: pluginAuth() },
  );
  // chat-agent-invoke.ts effectiveMcpConfigs chokepoint (no TOOLS.md policy here)
  const effectiveMcpConfigs = applyWorkspaceMcpPolicyFilter(mcpConfigs, null);
  const render = await renderSurface(objectStore, currentUserId, threadId);
  return {
    toolNames: effectiveMcpConfigs.map((config) => config.name).sort(),
    ...render,
  };
}

/** wakeup-processor shape: invoker derived from requested_by_actor_*. */
async function wakeupTurnSurface(
  objectStore: FakeObjectStore,
  wakeup: {
    requested_by_actor_type: string | null;
    requested_by_actor_id: string | null;
  },
  threadId = "thread-wakeup",
): Promise<GatedTurnSurface> {
  // wakeup-processor.ts:558 — only 'user' actors produce an invoker.
  const invokerUserId =
    wakeup.requested_by_actor_type === "user" && wakeup.requested_by_actor_id
      ? wakeup.requested_by_actor_id
      : undefined;
  // wakeup-processor.ts:707 — costOwnerUserId is the invoker verified to
  // exist in the tenant (all test users exist).
  const costOwnerUserId = invokerUserId;
  const mcpConfigsRaw = await buildMcpConfigs(
    AGENT,
    { humanPairId: HUMAN_PAIR, requesterUserId: invokerUserId ?? null },
    "[wakeup-processor]",
    { pluginAuth: pluginAuth() },
  );
  const mcpConfigs = applyWorkspaceMcpPolicyFilter(mcpConfigsRaw, null);
  const render = await renderSurface(
    objectStore,
    costOwnerUserId ?? null,
    threadId,
  );
  return {
    toolNames: mcpConfigs.map((config) => config.name).sort(),
    ...render,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  pluginStore = createInMemoryPluginEngineStore();
  pluginSecrets = createInMemoryPluginSecrets();
  mockAgentRows.mockReturnValue([{ tenant_id: TENANT }]);
  mockAssignmentRows.mockReturnValue([]);
  mockUserTokenRows.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
  mockJoinRows.mockReturnValue([pluginMcpRow("crm"), directMcpRow()]);
  seedInstalledPlugin();
});

describe("dispatch parity — plugin activation gating (U7)", () => {
  it("PARITY: same user, same tenant, same plugin state → identical gated tool surface and skill-folder exclusions on the chat turn AND the wakeup/resume turn", async () => {
    activate(ALICE);
    authenticateMcp();

    const chat = await chatTurnSurface(seededObjectStore(), ALICE);
    const wakeup = await wakeupTurnSurface(seededObjectStore(), {
      requested_by_actor_type: "user",
      requested_by_actor_id: ALICE,
    });

    expect(chat.toolNames).toEqual(wakeup.toolNames);
    expect(chat.workspaceFiles).toEqual(wakeup.workspaceFiles);
    expect(chat.pluginSkillFiles).toEqual(wakeup.pluginSkillFiles);
    expect(chat.contextMd).toEqual(wakeup.contextMd);

    // Plugin activation exposes plugin skills; MCP auth exposes OAuth MCP tools.
    expect(chat.toolNames).toEqual(["direct-server", "lastmile--crm"]);
    expect(chat.pluginSkillFiles).toEqual([
      "skills/lastmile--crm-basics/SKILL.md",
      "skills/lastmile--crm-basics/reference.md",
    ]);
    expect(chat.contextMd).toContain("skills/lastmile--crm-basics/SKILL.md");
    expect(chat.contextMd).toContain("skills/notes-helper/SKILL.md");
  });

  it("PARITY: a user without plugin activation or MCP auth gets the identical empty plugin surface from both builders, with non-plugin skills and direct servers intact", async () => {
    activate(ALICE); // someone else is activated — must not leak to Bob

    const chat = await chatTurnSurface(seededObjectStore(), BOB);
    const wakeup = await wakeupTurnSurface(seededObjectStore(), {
      requested_by_actor_type: "user",
      requested_by_actor_id: BOB,
    });

    expect(chat.toolNames).toEqual(wakeup.toolNames);
    expect(chat.workspaceFiles).toEqual(wakeup.workspaceFiles);
    expect(chat.contextMd).toEqual(wakeup.contextMd);

    expect(chat.toolNames).toEqual(["direct-server"]);
    expect(chat.pluginSkillFiles).toEqual([]);
    expect(chat.workspaceFiles).toContain("skills/notes-helper/SKILL.md");
    expect(chat.contextMd).not.toContain("lastmile--crm-basics");
    expect(chat.contextMd).toContain("skills/notes-helper/SKILL.md");
  });

  it("PARITY: clearing plugin activation and MCP auth between turns drops tools AND skills on the resume (wakeup) turn", async () => {
    activate(ALICE);
    authenticateMcp();
    const objectStore = seededObjectStore();

    // Turn 1 — chat turn while plugin-activated and MCP-authenticated.
    const first = await chatTurnSurface(objectStore, ALICE, "thread-shared");
    expect(first.toolNames).toContain("lastmile--crm");
    expect(first.pluginSkillFiles).not.toEqual([]);

    // Alice disconnects between turns. Plugin activation controls skills;
    // per-user MCP auth controls plugin-registered OAuth MCP tools.
    await deactivate(ALICE);
    clearMcpAuth();

    // Turn 2 — the wakeup/resume turn for the SAME user and thread.
    const resume = await wakeupTurnSurface(
      objectStore,
      { requested_by_actor_type: "user", requested_by_actor_id: ALICE },
      "thread-shared",
    );
    expect(resume.toolNames).toEqual(["direct-server"]);
    expect(resume.pluginSkillFiles).toEqual([]);
    expect(resume.contextMd).not.toContain("lastmile--crm-basics");

    // And a follow-up chat turn agrees with the resume turn (no drift).
    const followUp = await chatTurnSurface(objectStore, ALICE, "thread-shared");
    expect(followUp.toolNames).toEqual(resume.toolNames);
    expect(followUp.workspaceFiles).toEqual(resume.workspaceFiles);
  });

  it("scheduled-job turns gate on the job OWNER's current activation and MCP auth at dispatch time", async () => {
    activate(ALICE);
    authenticateMcp();
    // Job scheduled while Alice was connected…
    await deactivate(ALICE);
    clearMcpAuth();
    // …but dispatch evaluates the CURRENT activation and MCP auth state.
    const dispatch = await wakeupTurnSurface(seededObjectStore(), {
      requested_by_actor_type: "user",
      requested_by_actor_id: ALICE,
    });
    expect(dispatch.toolNames).toEqual(["direct-server"]);
    expect(dispatch.pluginSkillFiles).toEqual([]);
  });

  it("FAIL CLOSED: no resolvable requester (system/agent actor) excludes plugin tools AND plugin skill folders in both builders — never open", async () => {
    activate(ALICE); // an active activation exists, but no requester claims it

    const chat = await chatTurnSurface(seededObjectStore(), null);
    const systemWakeup = await wakeupTurnSurface(seededObjectStore(), {
      requested_by_actor_type: "system",
      requested_by_actor_id: "scheduler",
    });
    const agentWakeup = await wakeupTurnSurface(seededObjectStore(), {
      requested_by_actor_type: "agent",
      requested_by_actor_id: AGENT,
    });

    for (const surface of [chat, systemWakeup, agentWakeup]) {
      expect(surface.toolNames).toEqual(["direct-server"]);
      expect(surface.pluginSkillFiles).toEqual([]);
      expect(surface.contextMd).not.toContain("lastmile--crm-basics");
      // Non-plugin capability is unaffected by the fail-closed gate.
      expect(surface.workspaceFiles).toContain("skills/notes-helper/SKILL.md");
    }
    expect(chat.toolNames).toEqual(systemWakeup.toolNames);
    expect(chat.workspaceFiles).toEqual(systemWakeup.workspaceFiles);
    expect(systemWakeup.workspaceFiles).toEqual(agentWakeup.workspaceFiles);
  });

  it("INTEGRATION SHAPE: the rendered folder set matches what the gate reports — no DB/manifest divergence", async () => {
    activate(ALICE);

    for (const user of [ALICE, BOB]) {
      const gate = await resolvePluginGate(
        { tenantId: TENANT, requesterUserId: user },
        { store: pluginStore },
      );
      const { workspaceFiles } = await renderSurface(
        seededObjectStore(),
        user,
        `thread-${user}`,
      );
      const renderedPluginFiles = workspaceFiles.filter((path) =>
        path.startsWith("skills/lastmile--"),
      );
      if (gate.allowedInstallIds.has(INSTALL)) {
        expect(gate.blockedSkillFolderPrefixes).toEqual([]);
        expect(renderedPluginFiles).not.toEqual([]);
      } else {
        expect(gate.blockedSkillFolderPrefixes).toContain(PLUGIN_SKILL_FOLDER);
        // Every gate-blocked prefix is absent from the rendered file set.
        for (const prefix of gate.blockedSkillFolderPrefixes) {
          expect(workspaceFiles.some((path) => path.startsWith(prefix))).toBe(
            false,
          );
        }
        expect(renderedPluginFiles).toEqual([]);
      }
    }
  });

  it("the shared MCP policy chokepoint applies TOOLS.md policy identically for both builders", async () => {
    activate(ALICE);
    authenticateMcp();
    const policy = {
      mcpAllowedServers: null,
      mcpBlockedServers: ["direct-server"],
    };

    const chatConfigs = applyWorkspaceMcpPolicyFilter(
      await buildMcpConfigs(
        AGENT,
        { humanPairId: HUMAN_PAIR, requesterUserId: ALICE },
        "[chat-agent-invoke]",
        { pluginAuth: pluginAuth() },
      ),
      policy,
    );
    const wakeupConfigs = applyWorkspaceMcpPolicyFilter(
      await buildMcpConfigs(
        AGENT,
        { humanPairId: HUMAN_PAIR, requesterUserId: ALICE },
        "[wakeup-processor]",
        { pluginAuth: pluginAuth() },
      ),
      policy,
    );

    expect(chatConfigs.map((config) => config.name)).toEqual(
      wakeupConfigs.map((config) => config.name),
    );
    expect(chatConfigs.map((config) => config.name)).toEqual(["lastmile--crm"]);
  });
});
