/**
 * compose-tuple plugin activation gating tests (plan 2026-06-12-001 U7;
 * computed CONTEXT.md Routing activation per Composer plan U5, KTD-9).
 *
 * Plugin-installed skills materialize as namespaced
 * `skills/<pluginKey>--<slug>/` folders in the agent workspace source;
 * the render must exclude those folders from the hydrate manifest for
 * requesters without an ACTIVE activation, while leaving non-plugin
 * skills untouched. No requester → exclude ALL plugin folders (fail
 * closed).
 *
 * Since U5 the rendered CONTEXT.md is GENERATED on every render: its
 * `## Routing` managed section is computed from the gate-filtered skill
 * folders, so a gated requester's rendered CONTEXT.md omits blocked
 * plugin-skill rows — the computed rows are the only gate enforcement
 * (install-time snippet lines no longer exist).
 */

import { describe, expect, it, vi } from "vitest";
import { renderWorkspaceTuple } from "./compose-tuple.js";
import { getMarkdownSectionBody } from "./managed-sections.js";
import {
  FAIL_CLOSED_PLUGIN_GATE,
  resolvePluginGate,
  type PluginActivationGate,
  type ResolvePluginGateArgs,
} from "../plugins/gating.js";
import { createInMemoryPluginEngineStore } from "../plugins/testing.js";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceRenderTupleInput,
  WorkspaceTupleRepository,
} from "./types.js";

const TENANT = "tenant-1";
const AGENT_PREFIX = "tenants/acme/agents/platform-agent/";
const THREAD_PREFIX = "tenants/acme/threads/thread-1/";

// Post-U5 source shape: operator prose only — routing rows are computed
// into the generated file, never appended to source at install time.
const CONTEXT_MD = "# Context\n\nOperator routing prose stays.\n";

class FakeRepository implements WorkspaceTupleRepository {
  async resolve(
    input: WorkspaceRenderTupleInput,
  ): Promise<ResolvedWorkspaceRenderTuple> {
    return {
      tenantId: TENANT,
      tenantSlug: "acme",
      agentId: "agent-1",
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
      threadId: "thread-1",
      threadSlug: "thread-1",
      userId: input.userId ?? null,
      userSlug: null,
      userName: null,
    };
  }
}

class FakeStore implements WorkspaceRendererObjectStore {
  readonly puts: { key: string; content: string }[] = [];

  constructor(
    private readonly objects = new Map<
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
    this.puts.push({ key: input.key, content: input.content });
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

function seededStore(): FakeStore {
  const store = new FakeStore();
  store.set(`${AGENT_PREFIX}AGENTS.md`, "# AGENTS.md\n");
  store.set(`${AGENT_PREFIX}CONTEXT.md`, CONTEXT_MD);
  store.set(`${AGENT_PREFIX}skills/lastmile--crm-basics/SKILL.md`, "# CRM\n");
  store.set(
    `${AGENT_PREFIX}skills/lastmile--crm-basics/reference.md`,
    "# Ref\n",
  );
  store.set(`${AGENT_PREFIX}skills/notes-helper/SKILL.md`, "# Notes\n");
  return store;
}

function gateFor(
  states: Record<string, boolean>, // installId → requester activated
): (args: ResolvePluginGateArgs) => Promise<PluginActivationGate> {
  const pluginStore = createInMemoryPluginEngineStore();
  pluginStore.seedInstall({
    id: "install-lastmile",
    tenant_id: TENANT,
    plugin_key: "lastmile",
    state: "installed",
  });
  pluginStore.seedComponent({
    plugin_install_id: "install-lastmile",
    component_key: "skills",
    component_type: "skills",
    handler_ref: {
      workspaceFolders: ["skills/lastmile--crm-basics/"],
      seededCatalogPrefixes: [],
      agentSlug: "platform-agent",
    },
  });
  if (states["install-lastmile"]) {
    pluginStore.seedActivation({
      user_id: "user-activated",
      plugin_install_id: "install-lastmile",
    });
  }
  return (args) => resolvePluginGate(args, { store: pluginStore });
}

async function render(
  store: FakeStore,
  userId: string | null,
  pluginGateResolver: (
    args: ResolvePluginGateArgs,
  ) => Promise<PluginActivationGate>,
) {
  return renderWorkspaceTuple(
    {
      tenantId: TENANT,
      agentId: "agent-1",
      spaceId: "default-space",
      threadId: "thread-1",
      userId,
    },
    {
      bucket: "workspace",
      repository: new FakeRepository(),
      objectStore: store,
      pluginGateResolver,
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    },
  );
}

function filePaths(result: Awaited<ReturnType<typeof render>>): string[] {
  return result.hydrateManifest.files.map((file) => file.path).sort();
}

async function renderedContext(store: FakeStore): Promise<string> {
  return (await store.getText({ key: `${THREAD_PREFIX}CONTEXT.md` }))!;
}

describe("renderWorkspaceTuple — plugin activation gating", () => {
  it("an ACTIVATED requester gets plugin skill folders and computed routing rows for both skills", async () => {
    const store = seededStore();
    const result = await render(
      store,
      "user-activated",
      gateFor({ "install-lastmile": true }),
    );

    const paths = filePaths(result);
    expect(paths).toContain("skills/lastmile--crm-basics/SKILL.md");
    expect(paths).toContain("skills/lastmile--crm-basics/reference.md");
    expect(paths).toContain("skills/notes-helper/SKILL.md");

    const context = result.hydrateManifest.files.find(
      (file) => file.path === "CONTEXT.md",
    )!;
    // CONTEXT.md is generated per render (computed Routing section, U5).
    expect(context.generated).toBe(true);
    expect(context.sourceKey).toBe(`${THREAD_PREFIX}CONTEXT.md`);
    const generated = await renderedContext(store);
    expect(generated.startsWith(CONTEXT_MD)).toBe(true);
    const routing = getMarkdownSectionBody(generated, "Routing")!;
    expect(routing).toContain("skills/lastmile--crm-basics/SKILL.md");
    expect(routing).toContain("skills/notes-helper/SKILL.md");
    expect(result.writtenFiles).toEqual([
      "AGENTS.md",
      "CONTEXT.md",
      ".hydrate_manifest.json",
    ]);
  });

  it("a gated requester's rendered CONTEXT.md omits blocked plugin-skill rows (fail-closed); non-plugin skills unaffected", async () => {
    const store = seededStore();
    const result = await render(
      store,
      "user-other",
      gateFor({ "install-lastmile": true }),
    );

    const paths = filePaths(result);
    expect(paths.some((path) => path.startsWith("skills/lastmile--"))).toBe(
      false,
    );
    expect(paths).toContain("skills/notes-helper/SKILL.md");

    const context = result.hydrateManifest.files.find(
      (file) => file.path === "CONTEXT.md",
    )!;
    expect(context.generated).toBe(true);
    expect(context.sourceKey).toBe(`${THREAD_PREFIX}CONTEXT.md`);
    const generated = await renderedContext(store);
    expect(generated).not.toContain("lastmile--crm-basics");
    expect(generated).toContain("skills/notes-helper/SKILL.md");
    expect(generated.startsWith(CONTEXT_MD)).toBe(true);
    expect(result.writtenFiles).toEqual([
      "AGENTS.md",
      "CONTEXT.md",
      ".hydrate_manifest.json",
    ]);
  });

  it("a disabled skill assignment carries no computed routing row", async () => {
    const store = seededStore();
    store.set(
      `${AGENT_PREFIX}skills/notes-helper/.assignment.json`,
      JSON.stringify({ slug: "notes-helper", enabled: false }),
    );
    await render(
      store,
      "user-activated",
      gateFor({ "install-lastmile": true }),
    );

    const generated = await renderedContext(store);
    const routing = getMarkdownSectionBody(generated, "Routing")!;
    expect(routing).not.toContain("notes-helper");
    expect(routing).toContain("skills/lastmile--crm-basics/SKILL.md");
  });

  it("read-only compose exposes the generated CONTEXT.md byte-identical to the persisting write (Composer U1)", async () => {
    const gate = gateFor({ "install-lastmile": true });

    const persistingStore = seededStore();
    await render(persistingStore, "user-other", gate);
    const persistedContext = persistingStore.puts.find(
      (put) => put.key === `${THREAD_PREFIX}CONTEXT.md`,
    );
    const persistedAgentsMd = persistingStore.puts.find(
      (put) => put.key === `${THREAD_PREFIX}AGENTS.md`,
    );
    expect(persistedContext).toBeDefined();

    const readOnlyStore = seededStore();
    const readOnly = await renderWorkspaceTuple(
      {
        tenantId: TENANT,
        agentId: "agent-1",
        spaceId: "default-space",
        threadId: "thread-1",
        userId: "user-other",
      },
      {
        bucket: "workspace",
        repository: new FakeRepository(),
        objectStore: readOnlyStore,
        pluginGateResolver: gate,
        now: () => new Date("2026-06-12T10:00:00.000Z"),
        persist: false,
        includeGeneratedContents: true,
      },
    );

    // Purity: not a single put — the generated CONTEXT.md exists only in memory.
    expect(readOnlyStore.puts).toEqual([]);
    const generatedContext = readOnly.generatedFiles?.find(
      (file) => file.path === "CONTEXT.md",
    );
    expect(generatedContext?.content).toBe(persistedContext?.content);
    expect(generatedContext?.content).not.toContain("lastmile--crm-basics");
    const generatedAgentsMd = readOnly.generatedFiles?.find(
      (file) => file.path === "AGENTS.md",
    );
    expect(generatedAgentsMd?.content).toBe(persistedAgentsMd?.content);
  });

  it("NO resolvable requester excludes ALL plugin skill folders and routing rows (fail closed)", async () => {
    const store = seededStore();
    const result = await render(
      store,
      null,
      gateFor({ "install-lastmile": true }),
    );
    const paths = filePaths(result);
    expect(paths.some((path) => path.startsWith("skills/lastmile--"))).toBe(
      false,
    );
    expect(paths).toContain("skills/notes-helper/SKILL.md");
    const generated = await renderedContext(store);
    expect(generated).not.toContain("lastmile--crm-basics");
    expect(generated).toContain("skills/notes-helper/SKILL.md");
  });

  it("a degraded fail-closed gate (resolution error) pattern-excludes namespaced folders and rows, never fails open", async () => {
    const store = seededStore();
    const result = await render(store, "user-activated", async () => {
      return FAIL_CLOSED_PLUGIN_GATE;
    });
    const paths = filePaths(result);
    expect(paths.some((path) => path.startsWith("skills/lastmile--"))).toBe(
      false,
    );
    expect(paths).toContain("skills/notes-helper/SKILL.md");
    const generated = await renderedContext(store);
    expect(generated).not.toContain("lastmile--crm-basics");
  });

  it("the gate resolver is NOT consulted when the agent source has no plugin-namespaced folders", async () => {
    const store = new FakeStore();
    store.set(`${AGENT_PREFIX}AGENTS.md`, "# AGENTS.md\n");
    store.set(`${AGENT_PREFIX}CONTEXT.md`, "# Context\n");
    store.set(`${AGENT_PREFIX}skills/notes-helper/SKILL.md`, "# Notes\n");
    const resolver = vi.fn();
    await render(store, "user-activated", resolver);
    expect(resolver).not.toHaveBeenCalled();
    // The computed Routing section still renders for non-plugin skills.
    const generated = await renderedContext(store);
    expect(getMarkdownSectionBody(generated, "Routing")).toContain(
      "skills/notes-helper/SKILL.md",
    );
  });

  it("CACHE REGRESSION: a manifest cached for an activated requester never serves a cache hit to a gated requester (no superset fail-open)", async () => {
    const store = seededStore();
    const gate = gateFor({ "install-lastmile": true });

    const first = await render(store, "user-activated", gate);
    expect(first.cacheStatus).toBe("miss");
    expect(filePaths(first)).toContain("skills/lastmile--crm-basics/SKILL.md");

    // Same thread, gated requester: the cached (superset) manifest must
    // be rewritten, not served.
    const second = await render(store, "user-other", gate);
    expect(second.cacheStatus).toBe("miss");
    expect(
      filePaths(second).some((path) => path.startsWith("skills/lastmile--")),
    ).toBe(false);
    // And the manifest persisted to the thread prefix matches the gated view.
    const persisted = JSON.parse(
      (await store.getText({
        key: `${THREAD_PREFIX}.hydrate_manifest.json`,
      }))!,
    ) as { files: { path: string }[] };
    expect(
      persisted.files.some((file) => file.path.startsWith("skills/lastmile--")),
    ).toBe(false);
    // The persisted generated CONTEXT.md matches the gated view too.
    const generated = await renderedContext(store);
    expect(generated).not.toContain("lastmile--crm-basics");
  });

  it("a repeat render for the SAME gated requester is a cache hit with the gated manifest", async () => {
    const store = seededStore();
    const gate = gateFor({ "install-lastmile": true });

    const first = await render(store, "user-other", gate);
    expect(first.cacheStatus).toBe("miss");
    const second = await render(store, "user-other", gate);
    expect(second.cacheStatus).toBe("hit");
    expect(filePaths(second)).toEqual(filePaths(first));
    expect(
      filePaths(second).some((path) => path.startsWith("skills/lastmile--")),
    ).toBe(false);
  });

  it("an activation flip between renders re-renders and restores the plugin folders and routing rows", async () => {
    const store = seededStore();

    const blocked = await render(
      store,
      "user-activated",
      gateFor({ "install-lastmile": false }),
    );
    expect(
      filePaths(blocked).some((path) => path.startsWith("skills/lastmile--")),
    ).toBe(false);
    expect(await renderedContext(store)).not.toContain("lastmile--crm-basics");

    const allowed = await render(
      store,
      "user-activated",
      gateFor({ "install-lastmile": true }),
    );
    expect(allowed.cacheStatus).toBe("miss");
    expect(filePaths(allowed)).toContain(
      "skills/lastmile--crm-basics/SKILL.md",
    );
    expect(await renderedContext(store)).toContain(
      "skills/lastmile--crm-basics/SKILL.md",
    );
  });

  it("INTEGRATION SHAPE: the rendered file set diverges from the gate report nowhere", async () => {
    const pluginStore = createInMemoryPluginEngineStore();
    pluginStore.seedInstall({
      id: "install-lastmile",
      tenant_id: TENANT,
      plugin_key: "lastmile",
      state: "installed",
    });
    pluginStore.seedComponent({
      plugin_install_id: "install-lastmile",
      component_key: "skills",
      component_type: "skills",
      handler_ref: { workspaceFolders: ["skills/lastmile--crm-basics/"] },
    });
    pluginStore.seedActivation({
      user_id: "user-activated",
      plugin_install_id: "install-lastmile",
    });

    for (const userId of ["user-activated", "user-other", null]) {
      const gate = await resolvePluginGate(
        { tenantId: TENANT, requesterUserId: userId },
        { store: pluginStore },
      );
      const result = await render(seededStore(), userId, (args) =>
        resolvePluginGate(args, { store: pluginStore }),
      );
      const paths = filePaths(result);
      for (const prefix of gate.blockedSkillFolderPrefixes) {
        expect(paths.some((path) => path.startsWith(prefix))).toBe(false);
      }
      if (gate.allowedInstallIds.has("install-lastmile")) {
        expect(paths).toContain("skills/lastmile--crm-basics/SKILL.md");
      }
    }
  });
});
