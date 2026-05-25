import { describe, expect, it } from "vitest";

import { parseAgentsMd } from "../src/lib/agents-md-parser.js";
import {
  planWorkspaceBlueprintRepair,
  renderRootAgentsMd,
  renderSubAgentContextMd,
  repairWorkspaceBlueprint,
  type WorkspaceBlueprintObjectStore,
  type WorkspaceObject,
} from "./repair-agent-workspace-blueprint.js";

class MemoryWorkspaceStore implements WorkspaceBlueprintObjectStore {
  readonly objects = new Map<string, { body: string; contentType: string }>();
  readonly copies: Array<{ sourceKey: string; targetKey: string }> = [];
  readonly deletes: string[] = [];

  constructor(entries: Record<string, string>) {
    for (const [key, body] of Object.entries(entries)) {
      this.objects.set(key, { body, contentType: "text/plain" });
    }
  }

  async listObjects(prefix: string): Promise<WorkspaceObject[]> {
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => ({
        key,
        etag: `"${key}"`,
        size: this.objects.get(key)?.body.length ?? 0,
        lastModified: "2026-05-23T00:00:00.000Z",
      }));
  }

  async getObjectText(key: string): Promise<string | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    const source = this.objects.get(sourceKey);
    if (!source) throw new Error(`missing source ${sourceKey}`);
    this.copies.push({ sourceKey, targetKey });
    this.objects.set(targetKey, { ...source });
  }

  async putObject(
    key: string,
    body: string,
    contentType: string,
  ): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    this.deletes.push(...keys);
    for (const key of keys) this.objects.delete(key);
  }
}

const prefix =
  "tenants/sleek-squirrel-230/agents/fleet-caterpillar-456/workspace/";

function storeWithLegacyAgents(): MemoryWorkspaceStore {
  return new MemoryWorkspaceStore({
    [`${prefix}AGENTS.md`]: "# Old root\n",
    [`${prefix}CONTEXT.md`]: "# Old context\n",
    [`${prefix}memory/preferences.md`]: "Keep root memory.\n",
    [`${prefix}skills/finance-audit-xls/SKILL.md`]: "# Skill\n",
    [`${prefix}agents/earnest-falcon-947/AGENTS.md`]: "# Duplicated root\n",
    [`${prefix}agents/earnest-falcon-947/CONTEXT.md`]:
      "# Cruz - Context\n\nNo knowledge domains configured.\n",
    [`${prefix}agents/earnest-falcon-947/skills/account-health-review/SKILL.md`]:
      "# Account Health Review\n",
    [`${prefix}agents/earnest-falcon-947/skills/renewal-prep/README.md`]:
      "# Renewal Prep\n",
    [`${prefix}agents/jovial-narwhal-612/CONTEXT.md`]: "# Loki - Context\n",
    [`${prefix}agents/jovial-narwhal-612/skills/artifact-builder/SKILL.md`]:
      "# Artifact Builder\n",
  });
}

describe("planWorkspaceBlueprintRepair", () => {
  it("archives the current workspace and maps legacy agents to root folders", async () => {
    const store = storeWithLegacyAgents();
    const plan = await planWorkspaceBlueprintRepair({
      store,
      tenantSlug: "sleek-squirrel-230",
      agentSlug: "fleet-caterpillar-456",
      runId: "test-run",
    });

    expect(plan.archiveCopies).toHaveLength(10);
    expect(plan.skillCopies.map((copy) => copy.targetKey)).toEqual([
      `${prefix}earnest-falcon-947/skills/account-health-review/SKILL.md`,
      `${prefix}earnest-falcon-947/skills/renewal-prep/README.md`,
      `${prefix}jovial-narwhal-612/skills/artifact-builder/SKILL.md`,
    ]);
    expect(plan.deleteKeys).toEqual(
      expect.arrayContaining([
        `${prefix}agents/earnest-falcon-947/AGENTS.md`,
        `${prefix}agents/jovial-narwhal-612/CONTEXT.md`,
      ]),
    );
    expect(plan.generatedFiles.map((file) => file.key)).toEqual(
      expect.arrayContaining([
        `${prefix}AGENTS.md`,
        `${prefix}CONTEXT.md`,
        `${prefix}earnest-falcon-947/CONTEXT.md`,
        `${prefix}jovial-narwhal-612/CONTEXT.md`,
      ]),
    );
    expect(plan.model).toMatchObject({
      rootSkillSlugs: ["finance-audit-xls"],
      subAgents: [
        {
          slug: "earnest-falcon-947",
          displayName: "Cruz",
          skillSlugs: ["account-health-review", "renewal-prep"],
        },
        {
          slug: "jovial-narwhal-612",
          displayName: "Loki",
          skillSlugs: ["artifact-builder"],
        },
      ],
    });
  });

  it("discovers already-migrated root sub-agent folders on rerun", async () => {
    const store = new MemoryWorkspaceStore({
      [`${prefix}AGENTS.md`]: "# Current root\n",
      [`${prefix}CONTEXT.md`]: "# Current context\n",
      [`${prefix}memory/preferences.md`]: "Keep root memory.\n",
      [`${prefix}earnest-falcon-947/CONTEXT.md`]: "# Cruz Workspace Context\n",
      [`${prefix}earnest-falcon-947/skills/account-health-review/SKILL.md`]:
        "# Account Health Review\n",
    });

    const plan = await planWorkspaceBlueprintRepair({
      store,
      tenantSlug: "sleek-squirrel-230",
      agentSlug: "fleet-caterpillar-456",
      runId: "rerun",
    });

    expect(plan.skillCopies).toEqual([]);
    expect(plan.deleteKeys).toEqual([]);
    expect(plan.model.subAgents).toEqual([
      {
        slug: "earnest-falcon-947",
        displayName: "Cruz",
        skillSlugs: ["account-health-review"],
      },
    ]);
  });

  it("rejects unsafe run ids before composing archive and report keys", async () => {
    await expect(
      planWorkspaceBlueprintRepair({
        store: storeWithLegacyAgents(),
        tenantSlug: "sleek-squirrel-230",
        agentSlug: "fleet-caterpillar-456",
        runId: "../escape",
      }),
    ).rejects.toThrow(/Invalid run id/);
  });
});

describe("generated workspace map", () => {
  it("keeps routing rows parseable by the AGENTS.md parser", () => {
    const markdown = renderRootAgentsMd({
      tenantSlug: "sleek-squirrel-230",
      agentSlug: "fleet-caterpillar-456",
      rootSkillSlugs: ["finance-audit-xls"],
      subAgents: [
        {
          slug: "earnest-falcon-947",
          displayName: "Cruz",
          skillSlugs: ["account-health-review", "renewal-prep"],
        },
      ],
    });

    const parsed = parseAgentsMd(markdown);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.routing).toEqual([
      {
        task: "Cruz account health review, renewal prep",
        goTo: "earnest-falcon-947/",
        reads: ["earnest-falcon-947/CONTEXT.md"],
        skills: ["account-health-review", "renewal-prep"],
      },
    ]);
    expect(markdown).not.toContain("skills/ - root-level skills");
  });

  it("keeps skills out of generated Folder Structure prose", () => {
    const markdown = renderSubAgentContextMd({
      slug: "earnest-falcon-947",
      displayName: "Cruz",
      skillSlugs: ["account-health-review"],
    });

    expect(markdown).toContain("## Folder Structure");
    expect(markdown).not.toContain("skills/ - local skills");
    expect(markdown).toContain(
      "| account-health-review | skills/account-health-review/SKILL.md |",
    );
  });
});

describe("repairWorkspaceBlueprint", () => {
  it("dry-runs by only writing the report", async () => {
    const store = storeWithLegacyAgents();

    await repairWorkspaceBlueprint({
      store,
      tenantSlug: "sleek-squirrel-230",
      agentSlug: "fleet-caterpillar-456",
      runId: "dry-run",
      dryRun: true,
    });

    expect(store.copies).toEqual([]);
    expect(store.deletes).toEqual([]);
    expect(
      store.objects.has(
        "tenants/_ops/migrations/fleet-caterpillar-456-blueprint/dry-run.json",
      ),
    ).toBe(true);
  });

  it("applies the archive, folder rewrite, active agents deletion, and manifest", async () => {
    const store = storeWithLegacyAgents();

    await repairWorkspaceBlueprint({
      store,
      tenantSlug: "sleek-squirrel-230",
      agentSlug: "fleet-caterpillar-456",
      runId: "apply-run",
      dryRun: false,
    });

    expect(
      store.objects.has(`${prefix}agents/earnest-falcon-947/CONTEXT.md`),
    ).toBe(false);
    expect(
      store.objects.has(
        `${prefix}earnest-falcon-947/skills/account-health-review/SKILL.md`,
      ),
    ).toBe(true);
    expect(
      store.objects.has(
        "tenants/sleek-squirrel-230/agents/fleet-caterpillar-456/workspace-archives/blueprint-repair-apply-run/agents/earnest-falcon-947/CONTEXT.md",
      ),
    ).toBe(true);

    const manifest = JSON.parse(
      store.objects.get(`${prefix}manifest.json`)?.body ?? "{}",
    );
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "CONTEXT.md",
        "earnest-falcon-947/CONTEXT.md",
        "earnest-falcon-947/skills/account-health-review/SKILL.md",
      ]),
    );
    expect(
      manifest.files.some((file: { path: string }) =>
        file.path.startsWith("agents/"),
      ),
    ).toBe(false);
  });
});
