/**
 * Twin MCP key manifest publisher tests (repo-consolidation U14 / U12 KTD
 * amendment). Chain-mock Drizzle db — same approach as provision-connector.
 */
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
  keys: Array<{ keyHash: string; createdAt: string | null }>;
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
      { key_hash: "a".repeat(64), created_at: created },
      { key_hash: "b".repeat(64), created_at: null },
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
    expect(doc.formatVersion).toBe("twin-mcp-keys/v1");
    expect(doc.tenantId).toBe(TENANT_ID);
    expect(doc.generatedAt).toBe(now.toISOString());
    expect(doc.keys).toEqual([
      {
        keyHash: "a".repeat(64),
        createdAt: created.toISOString(),
        expiresAt: null,
      },
      { keyHash: "b".repeat(64), createdAt: null, expiresAt: null },
    ]);
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
