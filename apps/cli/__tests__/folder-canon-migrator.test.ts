import { describe, expect, it } from "vitest";
import {
  migrateFolderCanon,
  type WorkspaceObjectStore,
} from "../src/lib/migrations/folder-canon-migrator.js";

class MemoryStore implements WorkspaceObjectStore {
  writes: string[] = [];
  copies: Array<{ sourceKey: string; targetKey: string }> = [];
  deletes: string[] = [];
  listCalls: string[] = [];
  failNextCopy = false;

  constructor(readonly objects: Map<string, string>) {}

  async list(prefix: string): Promise<string[]> {
    this.listCalls.push(prefix);
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort((left, right) => left.localeCompare(right));
  }

  async read(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }

  async write(key: string, body: string): Promise<void> {
    this.writes.push(key);
    this.objects.set(key, body);
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    if (this.failNextCopy) {
      this.failNextCopy = false;
      throw new Error("copy failed");
    }
    const body = this.objects.get(sourceKey);
    if (body === undefined) throw new Error(`missing ${sourceKey}`);
    this.copies.push({ sourceKey, targetKey });
    this.objects.set(targetKey, body);
  }

  async delete(keys: string[]): Promise<void> {
    this.deletes.push(...keys);
    for (const key of keys) this.objects.delete(key);
  }
}

const PREFIX = "tenants/acme/agents/master/workspace/";

function seededStore(): MemoryStore {
  return new MemoryStore(
    new Map([
      [
        `${PREFIX}AGENTS.md`,
        [
          "# Master",
          "",
          "## What This Is",
          "Existing intro.",
          "",
          "## Routing",
          "",
          "| Task | Go to | Read | Skills |",
          "| ---- | ----- | ---- | ------ |",
          "| SQL | sql/   | sql/CONTEXT.md | snowflake |",
          "",
        ].join("\n"),
      ],
      [`${PREFIX}SOUL.md`, "Original soul.\n\n  Keep my indentation.\n"],
      [`${PREFIX}IDENTITY.md`, "Original identity."],
      [`${PREFIX}PLATFORM.md`, "Original platform."],
      [`${PREFIX}CAPABILITIES.md`, "Original capabilities."],
      [`${PREFIX}sql/CONTEXT.md`, "# SQL\n"],
      [`${PREFIX}sql/notes.md`, "warehouse notes"],
      [`${PREFIX}finance-analyst/CONTEXT.md`, "# Finance\n"],
    ]),
  );
}

describe("migrateFolderCanon", () => {
  it("applies AGENTS.md section migration and moves flat workspaces", async () => {
    const store = seededStore();

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.pendingOperations).toBeGreaterThan(0);
    expect(summary.tenantReports[0]?.status).toBe("migrated");
    const agentsMd = store.objects.get(`${PREFIX}AGENTS.md`) ?? "";
    expect(agentsMd).toContain("## Personality");
    expect(agentsMd).toContain(
      "<!-- migrated from SOUL.md on 2026-05-24 -->\nOriginal soul.\n\n  Keep my indentation.\n<!-- /migrated from SOUL.md -->",
    );
    expect(agentsMd).toContain("## Identity");
    expect(agentsMd).toContain("Original identity.");
    expect(agentsMd).toContain("## Platform Behavior");
    expect(agentsMd).toContain("Original platform.");
    expect(agentsMd).toContain("Original capabilities.");
    expect(agentsMd).toContain(
      "| SQL | workspaces/sql/   | workspaces/sql/CONTEXT.md | snowflake |",
    );
    expect(store.objects.get(`${PREFIX}workspaces/sql/CONTEXT.md`)).toBe(
      "# SQL\n",
    );
    expect(store.objects.get(`${PREFIX}workspaces/sql/notes.md`)).toBe(
      "warehouse notes",
    );
    expect(
      store.objects.get(`${PREFIX}workspaces/finance-analyst/CONTEXT.md`),
    ).toBe("# Finance\n");
    expect(store.objects.has(`${PREFIX}sql/CONTEXT.md`)).toBe(false);
    expect(store.objects.has(`${PREFIX}sql/notes.md`)).toBe(false);
  });

  it("is idempotent on a second apply", async () => {
    const store = seededStore();
    await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });
    store.writes = [];
    store.copies = [];
    store.deletes = [];

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.pendingOperations).toBe(0);
    expect(summary.tenantReports[0]?.status).toBe("noop");
    expect(store.writes).toEqual([]);
    expect(store.copies).toEqual([]);
    expect(store.deletes).toEqual([]);
  });

  it("deletes retired legacy files only after migrated AGENTS.md sections are verified", async () => {
    const store = seededStore();
    await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });

    store.writes = [];
    store.copies = [];
    store.deletes = [];

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
      cleanupLegacyFiles: true,
    });

    expect(summary.tenantReports[0]?.status).toBe("migrated");
    expect(store.deletes).toEqual([
      `${PREFIX}SOUL.md`,
      `${PREFIX}IDENTITY.md`,
      `${PREFIX}PLATFORM.md`,
      `${PREFIX}CAPABILITIES.md`,
    ]);
    expect(store.objects.has(`${PREFIX}SOUL.md`)).toBe(false);
    expect(store.objects.has(`${PREFIX}IDENTITY.md`)).toBe(false);
    expect(store.objects.has(`${PREFIX}PLATFORM.md`)).toBe(false);
    expect(store.objects.has(`${PREFIX}CAPABILITIES.md`)).toBe(false);
  });

  it("refreshes stale migrated blocks before deleting retired legacy files", async () => {
    const store = seededStore();
    await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });
    store.objects.set(`${PREFIX}SOUL.md`, "Updated soul after first pass.\n");
    store.writes = [];
    store.copies = [];
    store.deletes = [];

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
      cleanupLegacyFiles: true,
    });

    expect(summary.tenantReports[0]?.status).toBe("migrated");
    expect(store.writes).toEqual([`${PREFIX}AGENTS.md`]);
    expect(store.objects.get(`${PREFIX}AGENTS.md`)).toContain(
      "<!-- migrated from SOUL.md on 2026-05-24 -->\nUpdated soul after first pass.\n<!-- /migrated from SOUL.md -->",
    );
    expect(store.objects.has(`${PREFIX}SOUL.md`)).toBe(false);
  });

  it("reports pending operations in noop-check without mutating", async () => {
    const store = seededStore();

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "noop-check",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.pendingOperations).toBeGreaterThan(0);
    expect(summary.tenantReports[0]?.status).toBe("needs-migration");
    expect(store.objects.has(`${PREFIX}sql/CONTEXT.md`)).toBe(true);
    expect(store.objects.has(`${PREFIX}workspaces/sql/CONTEXT.md`)).toBe(false);
  });

  it("reports noop from noop-check after migration is complete", async () => {
    const store = seededStore();
    await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });
    store.writes = [];
    store.copies = [];
    store.deletes = [];

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "noop-check",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.pendingOperations).toBe(0);
    expect(summary.tenantReports[0]?.status).toBe("noop");
    expect(store.writes).toEqual([]);
    expect(store.copies).toEqual([]);
    expect(store.deletes).toEqual([]);
  });

  it("repair completes a partial run after AGENTS.md was already written", async () => {
    const store = seededStore();
    const migratedAgentsMd = `${store.objects.get(
      `${PREFIX}AGENTS.md`,
    )}\n## Personality\n\n<!-- migrated from SOUL.md on 2026-05-24 -->\nOriginal soul.\n<!-- /migrated from SOUL.md -->\n`;
    store.objects.set(`${PREFIX}AGENTS.md`, migratedAgentsMd);

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "repair",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.tenantReports[0]?.status).toBe("migrated");
    expect(store.objects.get(`${PREFIX}workspaces/sql/CONTEXT.md`)).toBe(
      "# SQL\n",
    );
  });

  it("repair deletes flat sources when a prior run copied targets already", async () => {
    const store = seededStore();
    store.objects.set(`${PREFIX}workspaces/sql/CONTEXT.md`, "# SQL\n");
    store.objects.set(
      `${PREFIX}AGENTS.md`,
      `${store.objects.get(`${PREFIX}AGENTS.md`)}`.replace(
        "sql/CONTEXT.md",
        "workspaces/sql/CONTEXT.md",
      ),
    );

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "repair",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.tenantReports[0]?.movedWorkspaceSlugs).toContain("sql");
    expect(store.objects.has(`${PREFIX}sql/CONTEXT.md`)).toBe(false);
    expect(store.objects.has(`${PREFIX}sql/notes.md`)).toBe(false);
    expect(store.objects.get(`${PREFIX}workspaces/sql/notes.md`)).toBe(
      "warehouse notes",
    );
    expect(store.objects.get(`${PREFIX}AGENTS.md`)).toContain(
      "workspaces/sql/CONTEXT.md",
    );
    expect(store.objects.get(`${PREFIX}AGENTS.md`)).not.toContain(
      "workspaces/workspaces/sql/CONTEXT.md",
    );
  });

  it("reports a failed migration when canonical target content diverges", async () => {
    const store = seededStore();
    store.objects.set(`${PREFIX}workspaces/sql/CONTEXT.md`, "# Different\n");

    const summary = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "repair",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.tenantReports[0]?.status).toBe("failed");
    expect(summary.tenantReports[0]?.message).toContain("Workspace collision");
    expect(store.objects.has(`${PREFIX}sql/CONTEXT.md`)).toBe(true);
  });

  it("leaves flat sources after copy failure so repair can complete", async () => {
    const store = seededStore();
    store.failNextCopy = true;

    const failed = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "apply",
      store,
      migratedDate: "2026-05-24",
    });

    expect(failed.tenantReports[0]?.status).toBe("failed");
    expect(store.objects.has(`${PREFIX}sql/CONTEXT.md`)).toBe(true);
    expect(store.objects.has(`${PREFIX}sql/notes.md`)).toBe(true);

    const repaired = await migrateFolderCanon({
      tenantSlug: "acme",
      agentSlug: "master",
      mode: "repair",
      store,
      migratedDate: "2026-05-24",
    });

    expect(repaired.tenantReports[0]?.status).toBe("migrated");
    expect(store.objects.get(`${PREFIX}workspaces/sql/CONTEXT.md`)).toBe(
      "# SQL\n",
    );
    expect(store.objects.get(`${PREFIX}workspaces/sql/notes.md`)).toBe(
      "warehouse notes",
    );
    expect(store.objects.has(`${PREFIX}sql/CONTEXT.md`)).toBe(false);
  });

  it("operates on a snapshot prefix without requiring tenant discovery", async () => {
    const store = new MemoryStore(
      new Map([
        ["snapshots/run-1/AGENTS.md", "# Snapshot\n"],
        ["snapshots/run-1/SOUL.md", "Snapshot soul"],
      ]),
    );

    const summary = await migrateFolderCanon({
      snapshotPrefix: "snapshots/run-1",
      mode: "dry-run",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.tenantReports[0]?.prefix).toBe("snapshots/run-1/");
    expect(summary.pendingOperations).toBe(1);
    expect(store.listCalls).toEqual(["snapshots/run-1/"]);
    for (const operation of summary.tenantReports[0]?.operations ?? []) {
      expect(operation.key).toMatch(/^snapshots\/run-1\//);
      if (operation.sourceKey) {
        expect(operation.sourceKey).toMatch(/^snapshots\/run-1\//);
      }
    }
  });

  it("discovers all tenant agent prefixes when --tenant is omitted", async () => {
    const store = new MemoryStore(
      new Map([
        ["tenants/acme/agents/master/workspace/AGENTS.md", "# Acme\n"],
        ["tenants/beta/agents/main/workspace/AGENTS.md", "# Beta\n"],
        [
          "tenants/acme/agents/_catalog/defaults/workspace/AGENTS.md",
          "# Defaults\n",
        ],
      ]),
    );

    const summary = await migrateFolderCanon({
      mode: "dry-run",
      store,
      migratedDate: "2026-05-24",
    });

    expect(summary.tenantReports.map((report) => report.prefix)).toEqual([
      "tenants/acme/agents/master/workspace/",
      "tenants/beta/agents/main/workspace/",
    ]);
  });
});
