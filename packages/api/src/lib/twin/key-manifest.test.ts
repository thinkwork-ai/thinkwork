/**
 * Twin MCP key manifest publisher tests (repo-consolidation U14 / U12 KTD
 * amendment). Chain-mock Drizzle db — same approach as provision-connector.
 *
 * The contract block below is the PRODUCER half of the one shared
 * cross-repo artifact: `contracts/key-manifest.v2.{schema,golden}.json` are
 * vendored byte-identical from company-brain, and the generated document is
 * validated against the schema here so a shape the Brain reader would
 * reject cannot ship unnoticed. Parallel mocks are deliberately avoided —
 * they let each side pass against its own idea of the wire (THINK-467/R15).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, selectQueue, whereConditions } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const whereConditions: unknown[] = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn((condition: unknown) => {
          whereConditions.push(condition);
          return Promise.resolve(selectQueue.shift() ?? []);
        }),
      };
      return chain;
    }),
  };
  return { mockDb, selectQueue, whereConditions };
});

vi.mock("../../graphql/utils.js", () => ({ db: mockDb }));

import {
  publishTwinKeyManifest,
  TWIN_KEY_MANIFEST_FORMAT,
  twinKeyManifestKey,
} from "./key-manifest.js";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const BUCKET = "thinkwork-test-brain-artifacts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contract = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `./contracts/${name}`), "utf8"));
const CONTRACT = contract("key-manifest.v2.schema.json");
const GOLDEN = contract("key-manifest.v2.golden.json");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateManifest = ajv.compile(CONTRACT);

interface CapturedPut {
  Bucket?: string;
  Key?: string;
  Body?: string;
  ContentType?: string;
}
const puts: CapturedPut[] = [];
const s3 = {
  send: async (command: unknown) => {
    puts.push((command as { input: CapturedPut }).input);
    return {};
  },
};

function manifestBody(index = 0): {
  formatVersion: string;
  tenantId: string;
  generatedAt: string;
  keys: Array<{
    keyHash: string;
    keyId?: string;
    name?: string;
    createdAt: string | null;
    securityGroups?: string[];
    kbCollections?: string[];
    trustedSubsystem?: true;
  }>;
} {
  return JSON.parse(puts[index]!.Body!);
}

/** Collect every column name referenced by a drizzle condition tree. */
function columnNames(condition: unknown): string[] {
  const names: string[] = [];
  const seen = new Set<unknown>();
  (function walk(value: unknown) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const rec = value as Record<string, unknown>;
    if (typeof rec.name === "string") names.push(rec.name);
    walk(rec.queryChunks);
  })(condition);
  return names;
}

beforeEach(() => {
  selectQueue.length = 0;
  whereConditions.length = 0;
  puts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
});

describe("publishTwinKeyManifest", () => {
  it("publishes the format-gated manifest shape to twin-mcp-keys/<tenantId>/latest.json", async () => {
    const created = new Date("2026-07-01T00:00:00.000Z");
    selectQueue.push([
      {
        id: "key-a",
        key_hash: "a".repeat(64),
        name: "ChatGPT app",
        created_at: created,
        security_groups: ["FINANCE"],
        kb_collections: ["handbook"],
      },
      {
        id: "key-b",
        key_hash: "b".repeat(64),
        name: "default",
        created_at: null,
        security_groups: ["*"],
        kb_collections: ["*"],
      },
    ]);
    const now = new Date("2026-07-24T12:00:00.000Z");
    const result = await publishTwinKeyManifest(TENANT_ID, {
      s3,
      bucket: BUCKET,
      now: () => now,
    });

    expect(result).toEqual({
      published: true,
      key: `twin-mcp-keys/${TENANT_ID}/latest.json`,
      keyCount: 2,
    });
    expect(twinKeyManifestKey(TENANT_ID)).toBe(
      `twin-mcp-keys/${TENANT_ID}/latest.json`,
    );
    expect(puts.length).toBe(1);
    expect(puts[0]!.Bucket).toBe(BUCKET);
    expect(puts[0]!.Key).toBe(`twin-mcp-keys/${TENANT_ID}/latest.json`);
    expect(puts[0]!.ContentType).toBe("application/json");
    const doc = manifestBody();
    expect(doc.formatVersion).toBe(TWIN_KEY_MANIFEST_FORMAT);
    // Cross-repo contract with company-brain brain-mcp/src/auth.ts (#246).
    expect(doc.formatVersion).toBe("twin-mcp-keys/v2");
    expect(doc.tenantId).toBe(TENANT_ID);
    expect(doc.generatedAt).toBe(now.toISOString());
    expect(doc.keys).toEqual([
      {
        keyHash: "a".repeat(64),
        keyId: "key-a",
        name: "ChatGPT app",
        createdAt: created.toISOString(),
        expiresAt: null,
        securityGroups: ["FINANCE"],
        kbCollections: ["handbook"],
      },
      {
        keyHash: "b".repeat(64),
        keyId: "key-b",
        name: "default",
        createdAt: null,
        expiresAt: null,
        securityGroups: ["*"],
        kbCollections: ["*"],
      },
    ]);
  });

  it("emits trustedSubsystem: true ONLY for flagged rows (THINK-626)", async () => {
    selectQueue.push([
      {
        id: "key-platform",
        key_hash: "d".repeat(64),
        name: "default",
        created_at: null,
        security_groups: ["*"],
        kb_collections: ["*"],
        trusted_subsystem: true,
      },
      {
        id: "key-customer",
        key_hash: "e".repeat(64),
        name: "ChatGPT app",
        created_at: null,
        security_groups: [],
        kb_collections: [],
        trusted_subsystem: false,
      },
    ]);
    await publishTwinKeyManifest(TENANT_ID, { s3, bucket: BUCKET });
    const [platform, customer] = manifestBody().keys;
    expect(platform!.trustedSubsystem).toBe(true);
    // Absent, not `false`: the reader is literal-true-only, and omitting
    // keeps every ordinary key's entry byte-identical to pre-THINK-626.
    expect(customer).not.toHaveProperty("trustedSubsystem");
  });

  it("a key with no grants publishes empty lists — PUBLIC graph only, no KB", async () => {
    selectQueue.push([
      {
        id: "key-c",
        key_hash: "c".repeat(64),
        name: "narrow",
        created_at: null,
        security_groups: [],
        kb_collections: [],
      },
    ]);
    await publishTwinKeyManifest(TENANT_ID, { s3, bucket: BUCKET });
    const [entry] = manifestBody().keys;
    expect(entry!.securityGroups).toEqual([]);
    expect(entry!.kbCollections).toEqual([]);
  });

  it("queries ACTIVE keys only — the where clause pins tenant_id AND revoked_at IS NULL", async () => {
    selectQueue.push([]);
    await publishTwinKeyManifest(TENANT_ID, { s3, bucket: BUCKET });
    expect(whereConditions.length).toBe(1);
    const names = columnNames(whereConditions[0]);
    expect(names).toContain("tenant_id");
    expect(names).toContain("revoked_at");
  });

  it("merges grace extraKeys, active rows winning on hash collision", async () => {
    selectQueue.push([
      { key_hash: "new-hash", created_at: new Date("2026-07-24T00:00:00Z") },
      { key_hash: "shared", created_at: new Date("2026-07-24T01:00:00Z") },
    ]);
    const result = await publishTwinKeyManifest(TENANT_ID, {
      s3,
      bucket: BUCKET,
      extraKeys: [
        { keyHash: "old-hash", createdAt: "2026-01-01T00:00:00.000Z" },
        { keyHash: "shared", createdAt: null },
      ],
    });
    expect(result.published).toBe(true);
    const hashes = manifestBody().keys.map((k) => k.keyHash);
    expect(hashes.sort()).toEqual(["new-hash", "old-hash", "shared"]);
    const shared = manifestBody().keys.find((k) => k.keyHash === "shared");
    expect(shared!.createdAt).toBe("2026-07-24T01:00:00.000Z"); // active row won
  });

  it("returns { published: false } without throwing when the bucket is unset", async () => {
    const result = await publishTwinKeyManifest(TENANT_ID, { s3 });
    expect(result).toEqual({ published: false, reason: "no_bucket" });
    expect(puts.length).toBe(0);
    expect(selectQueue.length).toBe(0); // bailed before the db read
    expect(console.error).toHaveBeenCalled();
  });

  it("returns { published: false, reason } without throwing on S3 failure", async () => {
    selectQueue.push([{ key_hash: "x".repeat(64), created_at: null }]);
    const result = await publishTwinKeyManifest(TENANT_ID, {
      s3: {
        send: async () => {
          throw new Error("s3 exploded");
        },
      },
      bucket: BUCKET,
    });
    expect(result).toEqual({ published: false, reason: "s3 exploded" });
    expect(console.error).toHaveBeenCalled();
  });
});

/**
 * Cross-repo wire contract (twin-mcp-keys/v2). The schema and golden are
 * vendored byte-identical from company-brain
 * `mcp/brain/contracts/` — when the Brain changes the accepted shape,
 * re-copy both files and let these tests decide whether the producer must
 * change with them.
 */
describe("key-manifest.v2 contract", () => {
  it("the vendored golden validates against the vendored schema", () => {
    expect(validateManifest(GOLDEN)).toBe(true);
  });

  it("the golden covers the trustedSubsystem case (proves the copies are current)", () => {
    const entry = (GOLDEN.keys as Array<Record<string, unknown>>).find(
      (key) => key.keyId === "key_trusted_subsystem",
    );
    expect(entry?.trustedSubsystem).toBe(true);
  });

  it("a published manifest validates against the schema", async () => {
    selectQueue.push([
      {
        id: "key-platform",
        key_hash: "f".repeat(64),
        name: "default",
        created_at: new Date("2026-07-01T00:00:00.000Z"),
        expires_at: new Date("2026-12-01T00:00:00.000Z"),
        security_groups: ["*"],
        kb_collections: ["*"],
        trusted_subsystem: true,
      },
      {
        id: "key-customer",
        key_hash: "0".repeat(64),
        name: "ChatGPT app",
        // Non-null on purpose: `tenant_mcp_twin_keys.created_at` is NOT
        // NULL DEFAULT now(), so this is the only shape a real row can
        // take. The publisher's `created_at ? … : null` branch is
        // defensive-only and would emit `createdAt: null`, which the
        // schema (`createdAt: {type: "string"}`) does not accept — a
        // divergence that is unreachable from the database and that the
        // consumer ignores anyway (createdAt is informational).
        created_at: new Date("2026-07-02T00:00:00.000Z"),
        security_groups: ["FINANCE"],
        kb_collections: [],
        trusted_subsystem: false,
      },
    ]);
    await publishTwinKeyManifest(TENANT_ID, { s3, bucket: BUCKET });
    const valid = validateManifest(manifestBody());
    if (!valid) console.log(validateManifest.errors);
    expect(valid).toBe(true);
  });
});
