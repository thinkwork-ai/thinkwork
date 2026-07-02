/**
 * Legacy CONTEXT.md snippet migration tests (Composer plan U5, KTD-4).
 *
 * Precision contract: exact-match strips only — stored `.catalog-ref.json`
 * snippets (pass 1) and exact reconstructions for orphaned skill folders
 * (pass 2). Edited wiring text is reported and left untouched, dry-run
 * performs zero writes, a missing CONTEXT.md is tolerated, and a second
 * apply run is a no-op.
 */

import { describe, expect, it } from "vitest";
import {
  defaultSkillRoutingSnippet,
  migrateWorkspaceContext,
  runContextSnippetMigration,
  stripExactOccurrence,
  type SnippetMigrationStore,
} from "./context-snippet-migration.js";
import { pluginSkillWiringMd } from "./plugins/handlers/skills.js";
import { parseWiringMd } from "./wiring-md.js";

const AGENT_PREFIX = "tenants/acme/agents/platform-agent/";

class FakeStore implements SnippetMigrationStore {
  readonly puts: { key: string; content: string }[] = [];

  constructor(readonly objects = new Map<string, string>()) {}

  async listKeys(prefix: string): Promise<string[]> {
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix) && key !== prefix)
      .sort();
  }

  async listChildPrefixes(prefix: string): Promise<string[]> {
    const children = new Set<string>();
    for (const key of this.objects.keys()) {
      if (!key.startsWith(prefix)) continue;
      const segment = key.slice(prefix.length).split("/")[0];
      if (segment) children.add(`${prefix}${segment}/`);
    }
    return [...children].sort();
  }

  async getText(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }

  async putText(key: string, content: string): Promise<void> {
    this.puts.push({ key, content });
    this.objects.set(key, content);
  }
}

const SNIPPET =
  "- For tasks covered by the `notes-helper` skill, read skills/notes-helper/SKILL.md and follow it.\n";

function seedInstalledSkill(
  store: FakeStore,
  slug: string,
  snippet: string,
  prefix = AGENT_PREFIX,
): void {
  store.objects.set(`${prefix}skills/${slug}/SKILL.md`, `# ${slug}\n`);
  store.objects.set(
    `${prefix}skills/${slug}/.catalog-ref.json`,
    JSON.stringify({
      slug,
      source_sha256: "a".repeat(64),
      installed_at: "2026-06-01T00:00:00.000Z",
      wiring_choice: "default",
      snippet,
    }),
  );
}

describe("stripExactOccurrence", () => {
  it("removes the snippet and collapses only the junction", () => {
    expect(stripExactOccurrence("A\n\nSNIP\n\nB\n", "SNIP")).toBe("A\n\nB\n");
    expect(stripExactOccurrence("A\nSNIP\nB\n", "SNIP")).toBe("A\nB\n");
    expect(stripExactOccurrence("A\n\nSNIP\n", "SNIP")).toBe("A\n");
    expect(stripExactOccurrence("SNIP\n\nB\n", "SNIP")).toBe("B\n");
  });

  it("returns null when the snippet is absent (never fuzzy)", () => {
    expect(stripExactOccurrence("A\n\nSNIPX\n", "SNIP-Y")).toBeNull();
    expect(stripExactOccurrence("anything", "")).toBeNull();
  });
});

describe("migrateWorkspaceContext — pass 1 (installed snippets)", () => {
  it("strips the stored snippet exactly and preserves surrounding prose byte-for-byte", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);
    const before = "# Context\n\nOperator prose ABOVE stays.\n";
    const after = "## Escalation\n\nOperator prose BELOW stays.\n";
    store.objects.set(
      `${AGENT_PREFIX}CONTEXT.md`,
      `${before}\n${SNIPPET}\n${after}`,
    );

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.status).toBe("changed");
    expect(report.strippedSnippets).toEqual(["notes-helper"]);
    expect(report.wrote).toBe(true);
    const written = store.objects.get(`${AGENT_PREFIX}CONTEXT.md`)!;
    expect(written).toContain("Operator prose ABOVE stays.");
    expect(written).toContain("Operator prose BELOW stays.");
    expect(written).not.toContain("notes-helper");
    expect(written.startsWith(before)).toBe(true);
    expect(written.endsWith(after)).toBe(true);
  });

  it("reports an edited snippet and leaves the file untouched — never fuzzy-strips", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);
    const edited =
      "# Context\n\n- For notes work (operator reworded this), read skills/notes-helper/SKILL.md first.\n";
    store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, edited);

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.status).toBe("clean");
    expect(report.editedSnippets).toEqual(["notes-helper"]);
    expect(report.wrote).toBe(false);
    expect(store.puts).toEqual([]);
    expect(store.objects.get(`${AGENT_PREFIX}CONTEXT.md`)).toBe(edited);
  });

  it("treats an installed skill with no snippet trace as already clean (post-U5 installs)", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);
    store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, "# Context\n\nProse.\n");

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.status).toBe("clean");
    expect(report.editedSnippets).toEqual([]);
    expect(store.puts).toEqual([]);
  });
});

describe("migrateWorkspaceContext — pass 2 (orphans)", () => {
  it("strips an orphan snippet reconstructed from the tenant catalog's WIRING.md", async () => {
    const store = new FakeStore();
    const orphanSnippet =
      "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n";
    store.objects.set(
      "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
      `# Wiring suggestions\n\n## Stage 3 gate\n\nWire into the review table.\n\n\`\`\`context-md\n${orphanSnippet}\`\`\`\n`,
    );
    store.objects.set(
      `${AGENT_PREFIX}CONTEXT.md`,
      `# Context\n\nProse stays.\n\n${orphanSnippet}`,
    );

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.strippedOrphans).toEqual(["finance-audit-xls"]);
    expect(report.unmatchedOrphanLines).toEqual([]);
    const written = store.objects.get(`${AGENT_PREFIX}CONTEXT.md`)!;
    expect(written).toContain("Prose stays.");
    expect(written).not.toContain("finance-audit-xls");
  });

  it("strips an orphan matching the plugin default snippet template when no catalog WIRING.md survives", async () => {
    const store = new FakeStore();
    store.objects.set(
      `${AGENT_PREFIX}CONTEXT.md`,
      `# Context\n\n${defaultSkillRoutingSnippet("lastmile--crm-basics")}`,
    );

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.strippedOrphans).toEqual(["lastmile--crm-basics"]);
    expect(store.objects.get(`${AGENT_PREFIX}CONTEXT.md`)).not.toContain(
      "lastmile--crm-basics",
    );
  });

  it("reports an unmatched orphan line and leaves it untouched", async () => {
    const store = new FakeStore();
    const custom =
      "- Weird operator-authored pointer into skills/gone-skill/notes.md here.";
    const content = `# Context\n\n${custom}\n`;
    store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, content);

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.status).toBe("clean");
    expect(report.unmatchedOrphanLines).toEqual([
      { slug: "gone-skill", line: custom },
    ]);
    expect(store.puts).toEqual([]);
    expect(store.objects.get(`${AGENT_PREFIX}CONTEXT.md`)).toBe(content);
  });

  it("pins the plugin snippet template parity with pluginSkillWiringMd", () => {
    const wiring = pluginSkillWiringMd({
      slug: "lastmile--crm-basics",
      skillMd: "# CRM\n",
    } as never);
    const [suggestion] = parseWiringMd(wiring).suggestions;
    expect(suggestion?.snippet).toBe(
      defaultSkillRoutingSnippet("lastmile--crm-basics"),
    );
  });
});

describe("migrateWorkspaceContext — tolerances", () => {
  it("tolerates a missing CONTEXT.md", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);

    const report = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(report.status).toBe("no_context_md");
    expect(store.puts).toEqual([]);
  });

  it("dry-run produces the same report with ZERO writes", async () => {
    const seed = () => {
      const store = new FakeStore();
      seedInstalledSkill(store, "notes-helper", SNIPPET);
      store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, `# Context\n\n${SNIPPET}`);
      return store;
    };

    const dryStore = seed();
    const dry = await migrateWorkspaceContext(dryStore, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "dry-run",
    });
    const applyStore = seed();
    const applied = await migrateWorkspaceContext(applyStore, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(dry.status).toBe("changed");
    expect(dry.wrote).toBe(false);
    expect(dryStore.puts).toEqual([]);
    expect(dryStore.objects.get(`${AGENT_PREFIX}CONTEXT.md`)).toBe(
      `# Context\n\n${SNIPPET}`,
    );
    expect({ ...dry, wrote: false }).toEqual({ ...applied, wrote: false });
    expect(applyStore.puts).toHaveLength(1);
  });

  it("is idempotent: a second apply run is a no-op", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);
    store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, `# Context\n\n${SNIPPET}`);

    const first = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });
    const second = await migrateWorkspaceContext(store, {
      workspacePrefix: AGENT_PREFIX,
      tenantSlug: "acme",
      mode: "apply",
    });

    expect(first.status).toBe("changed");
    expect(second.status).toBe("clean");
    expect(second.strippedSnippets).toEqual([]);
    expect(second.editedSnippets).toEqual([]);
    expect(store.puts).toHaveLength(1);
  });
});

describe("runContextSnippetMigration — workspace walk", () => {
  it("walks agent AND space workspaces across tenants and summarizes", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);
    store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, `# Context\n\n${SNIPPET}`);
    // Space workspace with a snippet (spaces are install targets too).
    const spacePrefix = "tenants/acme/spaces/engineering/";
    seedInstalledSkill(store, "notes-helper", SNIPPET, spacePrefix);
    store.objects.set(`${spacePrefix}CONTEXT.md`, `# Space\n\n${SNIPPET}`);
    // Second tenant, agent without CONTEXT.md.
    store.objects.set(
      "tenants/globex/agents/ops-agent/AGENTS.md",
      "# AGENTS\n",
    );

    const result = await runContextSnippetMigration({
      store,
      bucket: "workspace",
      mode: "apply",
    });

    expect(result.summary).toEqual({
      workspaces: 3,
      changed: 2,
      wrote: 2,
      missingContextMd: 1,
      snippetsStripped: 2,
      orphansStripped: 0,
      editedSkipped: 0,
      unmatchedOrphanLines: 0,
    });
    expect(store.puts.map((put) => put.key).sort()).toEqual([
      `${AGENT_PREFIX}CONTEXT.md`,
      `${spacePrefix}CONTEXT.md`,
    ]);
  });

  it("restricts the walk to --tenant when given", async () => {
    const store = new FakeStore();
    seedInstalledSkill(store, "notes-helper", SNIPPET);
    store.objects.set(`${AGENT_PREFIX}CONTEXT.md`, `# Context\n\n${SNIPPET}`);
    store.objects.set(
      "tenants/globex/agents/ops-agent/CONTEXT.md",
      `# Context\n\n${SNIPPET}`,
    );

    const result = await runContextSnippetMigration({
      store,
      bucket: "workspace",
      tenantSlug: "acme",
      mode: "dry-run",
    });

    expect(result.reports.map((report) => report.workspacePrefix)).toEqual([
      AGENT_PREFIX,
    ]);
  });
});
