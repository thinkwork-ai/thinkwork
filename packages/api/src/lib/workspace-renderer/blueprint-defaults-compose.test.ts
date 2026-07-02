/**
 * Fresh-tenant blueprint-shape compose tests (Composer plan
 * 2026-07-02-001 U6; R6 defaults, AE3).
 *
 * A tenant that never customized its governance files must render in the
 * workspace-blueprint 3-layer shape out of the box:
 *
 *   - the generated AGENTS.md carries the Layer-1 map (managed headings,
 *     quick-navigation table, operator routing table) with the default
 *     baseline preserved byte-for-byte ahead of the generated
 *     Workspace Routing section;
 *   - the workspace serves the default CONTEXT.md as the Layer-2 router
 *     (task-routing table with the "You'll Also Need" column plus the
 *     managed `## Routing` heading);
 *   - the managed-sections engine can fill the default managed headings
 *     without disturbing any surrounding blueprint prose (the U5
 *     activation contract for the CONTEXT.md Routing section).
 */

import { describe, expect, it } from "vitest";
import { loadFile } from "@thinkwork/workspace-defaults";
import { EMPTY_PLUGIN_GATE } from "../plugins/gating.js";
import { substitute } from "../placeholder-substitution.js";
import { replaceDerivedAgentsMdSections } from "../workspace-map-generator.js";
import { composeContextMdManagedSections } from "./managed-sections.js";
import { renderWorkspaceTuple } from "./compose-tuple.js";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceSpaceIndexEntry,
  WorkspaceSpaceParticipantEntry,
  WorkspaceAgentProfileRoutingEntry,
  WorkspaceTupleRepository,
} from "./types.js";

const TUPLE: ResolvedWorkspaceRenderTuple = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  agentId: "agent-1",
  agentSlug: "fresh-agent",
  agentName: "Fresh Agent",
  spaceId: "space-1",
  spaceSlug: "default",
  spaceName: "Default",
  spaceKind: "default",
  spaceAccessMode: "public",
  spacePrompt: null,
  spaceToolPolicy: {},
  spaceMcpPolicy: {},
  threadId: "thread-1",
  threadSlug: "thread-1",
  userId: "user-1",
  userSlug: "eric",
  userName: "Eric",
};

class FakeRepository implements WorkspaceTupleRepository {
  async resolve(): Promise<ResolvedWorkspaceRenderTuple | null> {
    return TUPLE;
  }

  async listAuthorizedSpaces(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceSpaceIndexEntry[]> {
    return [
      {
        id: tuple.spaceId,
        slug: tuple.spaceSlug,
        name: tuple.spaceName,
        accessMode: tuple.spaceAccessMode,
        isActive: true,
      },
    ];
  }

  async listSpaceParticipants(): Promise<WorkspaceSpaceParticipantEntry[]> {
    return [];
  }

  async listRoutableAgentProfiles(): Promise<
    WorkspaceAgentProfileRoutingEntry[]
  > {
    return [];
  }
}

class FakeStore implements WorkspaceRendererObjectStore {
  readonly puts: { key: string; content: string }[] = [];

  constructor(private readonly objects: Map<string, string>) {}

  async listObjects(input: {
    prefix: string;
  }): Promise<WorkspaceObjectMetadata[]> {
    return Array.from(this.objects.entries())
      .filter(([key]) => key.startsWith(input.prefix))
      .map(([key, content]) => ({
        key,
        lastModified: new Date("2026-07-01T09:00:00.000Z"),
        etag: `"${key}"`,
        size: content.length,
      }));
  }

  async getText(input: { key: string }): Promise<string | null> {
    return this.objects.get(input.key) ?? null;
  }

  async putText(input: { key: string; content: string }): Promise<void> {
    this.puts.push({ key: input.key, content: input.content });
    this.objects.set(input.key, input.content);
  }
}

const VALUES = { AGENT_NAME: "Fresh Agent", TENANT_NAME: "Acme" };

/** Bootstrap-shape agent workspace: substituted defaults, nothing else. */
function freshDefaultsStore(): FakeStore {
  return new FakeStore(
    new Map([
      [
        "tenants/acme/agents/fresh-agent/AGENTS.md",
        substitute(VALUES, loadFile("AGENTS.md")),
      ],
      [
        "tenants/acme/agents/fresh-agent/CONTEXT.md",
        substitute(VALUES, loadFile("CONTEXT.md")),
      ],
      [
        "tenants/acme/agents/fresh-agent/GUARDRAILS.md",
        substitute(VALUES, loadFile("GUARDRAILS.md")),
      ],
      ["tenants/acme/users/eric/USER.md", "# User\n"],
    ]),
  );
}

async function renderFresh(store: FakeStore) {
  return renderWorkspaceTuple(
    { tenantId: "tenant-1", agentId: "agent-1", spaceId: "space-1" },
    {
      bucket: "workspace",
      repository: new FakeRepository(),
      objectStore: store,
      pluginGateResolver: async () => EMPTY_PLUGIN_GATE,
      now: () => new Date("2026-07-01T10:00:00.000Z"),
    },
  );
}

describe("fresh-tenant compose — blueprint shape end-to-end (AE3)", () => {
  it("renders the generated AGENTS.md as the Layer-1 map with the default baseline byte-preserved", async () => {
    const store = freshDefaultsStore();
    const result = await renderFresh(store);

    const generated = store.puts.find((put) =>
      put.key.endsWith("/AGENTS.md"),
    )?.content;
    expect(generated).toBeDefined();

    // Baseline preserved byte-for-byte ahead of the generated section.
    const baseline = substitute(VALUES, loadFile("AGENTS.md")).trimEnd();
    expect(generated!.startsWith(baseline)).toBe(true);

    // Blueprint map shape: managed headings + operator routing table +
    // quick-navigation table + layer language.
    expect(generated).toMatch(/^## Folder Structure$/m);
    expect(generated).toMatch(/^## Skills & Tools$/m);
    expect(generated).toContain("| Task | Go to | Read | Skills |");
    expect(generated).toMatch(/\| Want to\.\.\. +\| Go here +\|/);
    expect(generated).toContain("Layer 2");

    // The generated routing-tree section follows the baseline.
    expect(generated).toContain("## Workspace Routing");
    expect(result.hydrateManifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "AGENTS.md",
          owner: "agent",
          generated: true,
        }),
      ]),
    );
  });

  it("serves the default CONTEXT.md as the Layer-2 router with the You'll Also Need column", async () => {
    const store = freshDefaultsStore();
    const result = await renderFresh(store);

    const contextEntry = result.hydrateManifest.files.find(
      (file) => file.path === "CONTEXT.md",
    );
    expect(contextEntry).toBeDefined();
    expect(contextEntry?.owner).toBe("agent");

    const served = await store.getText({ key: contextEntry!.sourceKey });
    expect(served).toContain("| Your Task | Go Here | You'll Also Need |");
    expect(served).toMatch(/^## Task Routing$/m);
    expect(served).toMatch(/^## Routing$/m);
    expect(served).toMatch(/^## Workspace Summary$/m);
  });
});

describe("managed-sections engine over the blueprint defaults", () => {
  it("fills the AGENTS.md managed headings while preserving blueprint prose", () => {
    const next = replaceDerivedAgentsMdSections(loadFile("AGENTS.md"), {
      "Folder Structure": "\n```text\nfresh-agent/\n```\n",
      "Skills & Tools": "\n| Skill | Scope |\n| --- | --- |\n",
    });

    // Managed bodies replaced…
    expect(next).toContain("```text\nfresh-agent/\n```");
    expect(next).toContain("| Skill | Scope |");
    expect(next).not.toContain("No skills discovered yet.");

    // …every blueprint prose region survives.
    expect(next).toMatch(/^## Quick Navigation$/m);
    expect(next).toMatch(/\| Want to\.\.\. +\| Go here +\|/);
    expect(next).toContain("| Task | Go to | Read | Skills |");
    expect(next).toContain("Each workspace is siloed");
    expect(next).toMatch(/^## Token Management$/m);
  });

  it("fills the CONTEXT.md Routing section with computed rows while preserving the router table (U5 activation contract)", () => {
    const composed = composeContextMdManagedSections({
      baseline: loadFile("CONTEXT.md"),
      skills: [
        {
          slug: "renewal-prep",
          description: "Prepare customer renewal briefs",
        },
      ],
    });

    // Computed row replaces the shipped placeholder body.
    expect(composed).toContain("For tasks covered by the `renewal-prep` skill");
    expect(composed).not.toContain(
      "Rows appear here as skills are attached to the agent.",
    );

    // Blueprint router prose survives around the managed section.
    expect(composed).toContain("| Your Task | Go Here | You'll Also Need |");
    expect(composed).toMatch(/^## Task Routing$/m);
    expect(composed).toMatch(/^## Workspace Summary$/m);
    expect(composed).toMatch(/^## What NOT to Do$/m);
  });
});
