import { describe, expect, it } from "vitest";
import {
  connectorsTombstoneMarkdown,
  moveConnectionsToConnectors,
} from "../src/lib/migrations/connectors-mover.js";
import type { WorkspaceObjectStore } from "../src/lib/migrations/folder-canon-migrator.js";

class MemoryStore implements WorkspaceObjectStore {
  writes: string[] = [];
  copies: Array<{ sourceKey: string; targetKey: string }> = [];
  deletes: string[] = [];

  constructor(readonly objects: Map<string, string>) {}

  async list(prefix: string): Promise<string[]> {
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

const PREFIX = "tenants/acme/agents/master/";

function seededStore(): MemoryStore {
  return new MemoryStore(
    new Map([
      [`${PREFIX}AGENTS.md`, "# Master\n"],
      [
        `${PREFIX}connections/postgres-dev/CONNECTION.md`,
        "---\nname: postgres-dev\n---\n",
      ],
      [
        `${PREFIX}connections/postgres-dev/.assignment.json`,
        '{"enabled":true}',
      ],
      [`${PREFIX}connections/postgres-dev/SCHEMA.md`, "# Schema\n"],
      // Hand-authored api-type connection folder — moved verbatim too.
      [
        `${PREFIX}connections/billing-api/CONNECTION.md`,
        "---\nname: billing-api\ntype: api\n---\n",
      ],
      // A folder already at the new spelling stays untouched.
      [
        `${PREFIX}connectors/existing-new/CONNECTION.md`,
        "---\nname: existing-new\n---\n",
      ],
    ]),
  );
}

describe("moveConnectionsToConnectors", () => {
  it("dry-run reports operations without mutating", async () => {
    const store = seededStore();
    const before = new Map(store.objects);
    const summary = await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "dry-run",
      store,
    });
    expect(summary.agentReports).toHaveLength(1);
    const report = summary.agentReports[0]!;
    expect(report.status).toBe("dry-run");
    expect(report.movedSlugs).toEqual(["billing-api", "postgres-dev"]);
    // 4 copies + 4 deletes + 1 tombstone
    expect(report.operations).toHaveLength(9);
    expect(store.objects).toEqual(before);
    expect(store.writes).toEqual([]);
    expect(store.deletes).toEqual([]);
  });

  it("apply copies to connectors/, deletes legacy objects, and writes the tombstone", async () => {
    const store = seededStore();
    const summary = await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "apply",
      store,
      movedDate: "2026-07-15",
    });
    expect(summary.agentReports[0]!.status).toBe("moved");
    expect(
      store.objects.get(`${PREFIX}connectors/postgres-dev/CONNECTION.md`),
    ).toBe("---\nname: postgres-dev\n---\n");
    expect(
      store.objects.get(`${PREFIX}connectors/postgres-dev/.assignment.json`),
    ).toBe('{"enabled":true}');
    expect(
      store.objects.get(`${PREFIX}connectors/postgres-dev/SCHEMA.md`),
    ).toBe("# Schema\n");
    expect(
      store.objects.get(`${PREFIX}connectors/billing-api/CONNECTION.md`),
    ).toContain("billing-api");
    // Legacy folder holds ONLY the tombstone now.
    const legacyKeys = [...store.objects.keys()].filter((key) =>
      key.startsWith(`${PREFIX}connections/`),
    );
    expect(legacyKeys).toEqual([`${PREFIX}connections/README.md`]);
    expect(store.objects.get(`${PREFIX}connections/README.md`)).toBe(
      connectorsTombstoneMarkdown("2026-07-15"),
    );
    // Untouched pre-existing new-spelling folder.
    expect(
      store.objects.get(`${PREFIX}connectors/existing-new/CONNECTION.md`),
    ).toBe("---\nname: existing-new\n---\n");
  });

  it("is idempotent: second run is a noop and noop-check passes", async () => {
    const store = seededStore();
    await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "apply",
      store,
      movedDate: "2026-07-15",
    });
    const second = await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "apply",
      store,
      movedDate: "2026-07-16",
    });
    expect(second.agentReports[0]!.status).toBe("noop");
    expect(second.pendingOperations).toBe(0);
    // Tombstone not rewritten (date preserved from the first run).
    expect(store.objects.get(`${PREFIX}connections/README.md`)).toBe(
      connectorsTombstoneMarkdown("2026-07-15"),
    );
    const check = await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "noop-check",
      store,
    });
    expect(check.agentReports[0]!.status).toBe("noop");
  });

  it("completes a partial run: existing connectors/ copy wins, legacy still deleted", async () => {
    const store = seededStore();
    // Simulate: post-flip writer already re-materialized the folder under
    // connectors/ with NEWER bytes, while the stale legacy copy remains.
    store.objects.set(
      `${PREFIX}connectors/postgres-dev/CONNECTION.md`,
      "---\nname: postgres-dev\nversion: 2\n---\n",
    );
    const summary = await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "apply",
      store,
      movedDate: "2026-07-15",
    });
    expect(summary.agentReports[0]!.status).toBe("moved");
    // The connectors/ copy was NOT overwritten by the stale legacy bytes.
    expect(
      store.objects.get(`${PREFIX}connectors/postgres-dev/CONNECTION.md`),
    ).toContain("version: 2");
    expect(
      store.objects.has(`${PREFIX}connections/postgres-dev/CONNECTION.md`),
    ).toBe(false);
  });

  it("workspaces that never had connections/ stay untouched (no tombstone)", async () => {
    const store = new MemoryStore(
      new Map([["tenants/acme/agents/clean/AGENTS.md", "# Clean\n"]]),
    );
    const summary = await moveConnectionsToConnectors({
      tenantSlug: "acme",
      mode: "apply",
      store,
    });
    expect(summary.agentReports[0]!.status).toBe("noop");
    expect(store.writes).toEqual([]);
    expect(
      store.objects.has(
        "tenants/acme/agents/clean/connections/README.md",
      ),
    ).toBe(false);
  });

  it("discovers agents across tenants when no tenant is given", async () => {
    const store = new MemoryStore(
      new Map([
        [
          "tenants/acme/agents/master/connections/a/CONNECTION.md",
          "a",
        ],
        ["tenants/tei/agents/ops/connections/b/CONNECTION.md", "b"],
      ]),
    );
    const summary = await moveConnectionsToConnectors({
      mode: "dry-run",
      store,
    });
    expect(summary.agentReports.map((report) => report.prefix)).toEqual([
      "tenants/acme/agents/master/",
      "tenants/tei/agents/ops/",
    ]);
  });
});
