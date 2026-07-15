import {
  createHash,
  generateKeyPairSync,
  verify as edVerify,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  convertLegacyProfile,
  migrateAgentFolders,
  parseLegacyProfileFile,
  type AgentFolderMigrationOptions,
} from "../src/lib/migrations/agent-folder-migrator.js";
import type { WorkspaceObjectStore } from "../src/lib/migrations/folder-canon-migrator.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const PREFIX = "tenants/acme/agents/marco/workspace/";

function memoryStore(seed: Record<string, string>): WorkspaceObjectStore & {
  objects: Map<string, string>;
} {
  const objects = new Map(Object.entries(seed));
  return {
    objects,
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
    async read(key) {
      return objects.get(key) ?? null;
    },
    async write(key, body) {
      objects.set(key, body);
    },
    async copy(sourceKey, targetKey) {
      objects.set(targetKey, objects.get(sourceKey) ?? "");
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
}

const BUILT_INS: Record<string, string> = {
  "agents/research/INSTRUCTIONS.md":
    "---\ndescription: Researcher\n---\n\nResearch.\n",
  "agents/reviewer/INSTRUCTIONS.md":
    "---\ndescription: Reviewer\n---\n\nReview.\n",
};

function legacyProfile(extra = ""): string {
  return [
    "---",
    "name: Helper",
    "builtInKey: helper",
    "model: anthropic/claude-sonnet-5",
    "routingGuidance: Use for helping.",
    "tools:",
    "  builtInTools: [web-search]",
    "  mcpServers: [postgres-dev]",
    "skills: [crm]",
    "execution:",
    "  maxTokens: 2000",
    extra,
    "---",
    "",
    "# Instructions",
    "",
    "Help with things.",
  ]
    .filter(Boolean)
    .join("\n");
}

function options(
  store: WorkspaceObjectStore,
  overrides: Partial<AgentFolderMigrationOptions> = {},
): AgentFolderMigrationOptions {
  return {
    tenantSlug: "acme",
    agentSlug: "marco",
    mode: "apply",
    store,
    signingKey: privateKey,
    builtInFolders: BUILT_INS,
    now: () => "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("migrateAgentFolders", () => {
  it("materializes missing built-in folders and skips existing ones", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/research/INSTRUCTIONS.md`]: "existing",
    });
    const summary = await migrateAgentFolders(options(store));
    const report = summary.reports[0]!;
    expect(report.builtInsMaterialized).toEqual(["reviewer"]);
    expect(report.skipped.some((s) => s.includes("already_installed"))).toBe(
      true,
    );
    expect(store.objects.get(`${PREFIX}agents/research/INSTRUCTIONS.md`)).toBe(
      "existing",
    );
    expect(
      store.objects.get(`${PREFIX}agents/reviewer/INSTRUCTIONS.md`),
    ).toContain("Reviewer");
  });

  it("covers AE4: converts a legacy file with the full field mapping, preserving the legacy file", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/helper.md`]: legacyProfile(),
      [`${PREFIX}connections/postgres-dev/CONNECTION.md`]: "---\n---\nconn",
    });
    const summary = await migrateAgentFolders(options(store));
    const report = summary.reports[0]!;
    expect(report.converted).toEqual([`${PREFIX}agents/helper.md`]);

    const instructions = store.objects.get(
      `${PREFIX}agents/helper/INSTRUCTIONS.md`,
    )!;
    // description derived from routingGuidance (description absent)
    expect(instructions).toContain("description: Use for helping.");
    expect(instructions).toContain("model: anthropic/claude-sonnet-5");
    expect(instructions).toContain("web-search");
    expect(instructions).toContain("maxTokens: 2000");
    expect(instructions).toContain("Help with things.");
    expect(instructions).not.toContain("# Instructions");
    expect(instructions).not.toContain("name:");
    expect(instructions).not.toContain("builtInKey");

    // Grant folders: signed markers/narrowing sidecars.
    const skillGrant = JSON.parse(
      store.objects.get(`${PREFIX}agents/helper/skills/crm/.assignment.json`)!,
    );
    expect(skillGrant).toMatchObject({ slug: "crm", class: "skill" });
    const connectorGrant = JSON.parse(
      store.objects.get(
        `${PREFIX}agents/helper/connectors/postgres-dev/.assignment.json`,
      )!,
    );
    expect(connectorGrant).toMatchObject({
      slug: "postgres-dev",
      class: "connection",
    });
    // Signature verifies over the canonical payload (parity with the
    // api verifier: canonical key-sorted JSON, Ed25519 over utf8 bytes).
    const { signature, ...payload } = connectorGrant;
    const canonical = JSON.stringify(sortValue(payload));
    expect(createHash("sha256").update(canonical, "utf8").digest("hex")).toBe(
      signature.payloadHash,
    );
    expect(
      edVerify(
        null,
        Buffer.from(canonical, "utf8"),
        publicKey,
        Buffer.from(signature.signature, "hex"),
      ),
    ).toBe(true);
    // Empty-definition-bytes pin.
    expect(payload.signed_content_sha).toBe(
      createHash("sha256").update("").digest("hex"),
    );

    // name/builtInKey dropped but recorded.
    expect(report.droppedFields[0]?.fields).toEqual(
      expect.arrayContaining(["name", "builtInKey"]),
    );
    // Legacy file preserved — deletion is U12 delete-on-write only.
    expect(store.objects.has(`${PREFIX}agents/helper.md`)).toBe(true);
  });

  it("flags unresolvable mcpServers names and writes no grant (no silent grant loss)", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/helper.md`]: legacyProfile(),
    });
    const summary = await migrateAgentFolders(options(store));
    expect(
      store.objects.has(
        `${PREFIX}agents/helper/connectors/postgres-dev/.assignment.json`,
      ),
    ).toBe(false);
    expect(summary.flags).toMatchObject([{ reason: "unresolvable_connector" }]);
  });

  it("covers AE4: neither description nor routingGuidance → folder written + flagged", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/bare.md`]:
        "---\nmodel: anthropic/claude-sonnet-5\n---\n\nBody.\n",
    });
    const summary = await migrateAgentFolders(options(store));
    expect(
      store.objects.get(`${PREFIX}agents/bare/INSTRUCTIONS.md`),
    ).not.toContain("description:");
    expect(summary.flags).toMatchObject([{ reason: "missing_description" }]);
  });

  it("second run is a no-op", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/helper.md`]: legacyProfile(),
      [`${PREFIX}connections/postgres-dev/CONNECTION.md`]: "---\n---\nconn",
    });
    await migrateAgentFolders(options(store));
    const before = new Map(store.objects);
    const second = await migrateAgentFolders(options(store));
    const report = second.reports[0]!;
    expect(report.status).toBe("noop");
    expect(report.converted).toEqual([]);
    expect(store.objects).toEqual(before);
  });

  it("dry-run writes nothing and reports accurately", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/helper.md`]: legacyProfile(),
      [`${PREFIX}connections/postgres-dev/CONNECTION.md`]: "---\n---\nconn",
    });
    const summary = await migrateAgentFolders(
      options(store, { mode: "dry-run" }),
    );
    const report = summary.reports[0]!;
    expect(report.writes.length).toBeGreaterThan(0);
    expect(store.objects.has(`${PREFIX}agents/helper/INSTRUCTIONS.md`)).toBe(
      false,
    );
    expect(summary.pendingWrites).toBe(report.writes.length);
  });

  it("converts space-local profile files in place without materializing built-ins", async () => {
    const spacePrefix = "tenants/acme/spaces/eng/";
    const store = memoryStore({
      [`${spacePrefix}agents/helper.md`]: legacyProfile(),
    });
    const summary = await migrateAgentFolders(
      options(store, { tenantSlug: "acme", agentSlug: undefined }),
    );
    const report = summary.reports.find((r) => r.prefix === spacePrefix)!;
    expect(report.builtInsMaterialized).toEqual([]);
    expect(report.converted).toEqual([`${spacePrefix}agents/helper.md`]);
    expect(
      store.objects.has(`${spacePrefix}agents/helper/INSTRUCTIONS.md`),
    ).toBe(true);
  });

  it("skips grant sidecars with a flag when signing is unavailable", async () => {
    const store = memoryStore({
      [`${PREFIX}agents/helper.md`]: legacyProfile(),
      [`${PREFIX}connections/postgres-dev/CONNECTION.md`]: "---\n---\nconn",
    });
    const summary = await migrateAgentFolders(
      options(store, { signingKey: null }),
    );
    expect(
      summary.flags.filter((f) => f.reason === "signing_unavailable").length,
    ).toBe(2);
    expect(store.objects.has(`${PREFIX}agents/helper/INSTRUCTIONS.md`)).toBe(
      true,
    );
  });
});

describe("convertLegacyProfile", () => {
  it("merges description and routingGuidance", () => {
    const parsed = parseLegacyProfileFile(
      "---\ndescription: Helps.\nroutingGuidance: Use often.\nmodel: m\n---\n\nBody.\n",
    )!;
    const conversion = convertLegacyProfile("helper", parsed);
    expect(conversion.description).toBe("Helps. Use often.");
  });
});

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      out[key] = sortValue(record[key]);
    }
    return out;
  }
  return value;
}
