/**
 * User claims manifest publisher tests (THINK-625). Chain-mock Drizzle db —
 * same approach as key-manifest / provision-connector.
 *
 * The golden-shape test doubles as the producer half of the cross-repo
 * contract: the generated document is validated against the vendored
 * user-claims.v1 JSON schema, so a field the Brain reader would reject
 * cannot ship from here unnoticed.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, selectQueue } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      };
      return chain;
    }),
  };
  return { mockDb, selectQueue };
});

vi.mock("../../graphql/utils.js", () => ({ db: mockDb }));

import {
  publishUserClaimsManifest,
  USER_CLAIMS_MANIFEST_FORMAT,
  userClaimsManifestKey,
} from "./user-claims-manifest.js";
import { twinKeyManifestKey } from "./artifact-keys.js";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const BUCKET = "thinkwork-test-brain-artifacts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = JSON.parse(
  readFileSync(
    resolve(__dirname, "./contracts/user-claims.v1.schema.json"),
    "utf8",
  ),
);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateManifest = ajv.compile(CONTRACT);

interface CapturedCall {
  kind: "put" | "delete";
  Bucket?: string;
  Key?: string;
  Body?: string;
  ContentType?: string;
}
const calls: CapturedCall[] = [];
const s3 = {
  send: async (command: unknown) => {
    const input = (command as { input: CapturedCall }).input;
    const kind =
      (command as object).constructor.name === "DeleteObjectCommand"
        ? "delete"
        : "put";
    calls.push({ ...input, kind });
    return {};
  },
};

const puts = () => calls.filter((c) => c.kind === "put");
const deletes = () => calls.filter((c) => c.kind === "delete");

function manifestBody(index = 0): Record<string, any> {
  return JSON.parse(puts()[index]!.Body!);
}

/** Queue the enable-flag read, then the claims-rows read. */
function seed(enabled: boolean, rows: unknown[] = []) {
  selectQueue.push([{ enabled }]);
  if (enabled) selectQueue.push(rows);
}

function claimsRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER_ID,
    security_groups: ["FINANCE"],
    kb_collections: ["handbook"],
    kb_bundles: { onboarding: ["handbook"] },
    default_kb_bundle: "onboarding",
    tool_allowlist: ["brain_ask", "brain_search_knowledge"],
    is_operator: false,
    kb_trace: false,
    analytics_key: true,
    enabled: true,
    cognito_sub: "cognito-sub-1",
    email: "Person@Customer.com",
    member_status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
});

describe("publishUserClaimsManifest", () => {
  it("publishes the format-gated shape to user-claims/<tenantId>/latest.json", async () => {
    seed(true, [claimsRow()]);
    const now = new Date("2026-08-06T12:00:00.000Z");

    const result = await publishUserClaimsManifest(TENANT_ID, {
      s3,
      bucket: BUCKET,
      now: () => now,
    });

    expect(result).toEqual({
      published: true,
      key: `user-claims/${TENANT_ID}/latest.json`,
      userCount: 1,
    });
    expect(puts().length).toBe(1);
    expect(puts()[0]!.Bucket).toBe(BUCKET);
    expect(puts()[0]!.Key).toBe(`user-claims/${TENANT_ID}/latest.json`);
    expect(puts()[0]!.ContentType).toBe("application/json");

    const doc = manifestBody();
    expect(doc.formatVersion).toBe(USER_CLAIMS_MANIFEST_FORMAT);
    // Cross-repo contract with the company-brain reader.
    expect(doc.formatVersion).toBe("user-claims/v1");
    expect(doc.tenantId).toBe(TENANT_ID);
    expect(doc.generatedAt).toBe(now.toISOString());
    expect(doc.users).toEqual([
      {
        userId: USER_ID,
        subject: "cognito-sub-1",
        email: "person@customer.com",
        disabled: false,
        operator: false,
        securityGroups: ["FINANCE"],
        kbCollections: ["handbook"],
        kbBundles: { onboarding: ["handbook"] },
        defaultKbBundle: "onboarding",
        toolAllowlist: ["brain_ask", "brain_search_knowledge"],
        kbTrace: false,
        analyticsKey: true,
      },
    ]);
  });

  it("analyticsKey follows the per-row column — true by default, false when opted out (THINK-656 D4)", async () => {
    seed(true, [
      claimsRow(),
      claimsRow({
        user_id: "66666666-6666-4666-8666-666666666666",
        analytics_key: false,
      }),
    ]);
    await publishUserClaimsManifest(TENANT_ID, { s3, bucket: BUCKET });
    const [byDefault, optedOut] = manifestBody().users;
    expect(byDefault.analyticsKey).toBe(true);
    expect(optedOut.analyticsKey).toBe(false);
  });

  it("validates the generated document against the vendored user-claims/v1 schema", async () => {
    seed(true, [
      claimsRow(),
      claimsRow({
        user_id: "44444444-4444-4444-8444-444444444444",
        cognito_sub: null,
        email: null,
        tool_allowlist: null,
        default_kb_bundle: null,
        security_groups: ["*"],
        kb_collections: [],
        kb_bundles: {},
        is_operator: true,
        kb_trace: true,
        member_status: "disabled",
      }),
    ]);

    await publishUserClaimsManifest(TENANT_ID, { s3, bucket: BUCKET });

    const valid = validateManifest(manifestBody());
    expect(validateManifest.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("carries no secret material — no key hashes or tokens anywhere in the body", async () => {
    seed(true, [claimsRow()]);
    await publishUserClaimsManifest(TENANT_ID, { s3, bucket: BUCKET });
    const body = puts()[0]!.Body!;
    expect(body).not.toMatch(/tkt_/);
    expect(body).not.toMatch(/keyHash|key_hash|password|secret/i);
  });

  it("emits disabled members with disabled:true rather than omitting them", async () => {
    seed(true, [
      claimsRow({ member_status: "suspended" }),
      claimsRow({
        user_id: "55555555-5555-4555-8555-555555555555",
        enabled: false,
      }),
      claimsRow({
        user_id: "66666666-6666-4666-8666-666666666666",
        member_status: null,
      }),
    ]);

    const result = await publishUserClaimsManifest(TENANT_ID, {
      s3,
      bucket: BUCKET,
    });

    expect(result.userCount).toBe(3);
    expect(manifestBody().users.map((u: any) => u.disabled)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("preserves null toolAllowlist as distinct from an empty one", async () => {
    seed(true, [
      claimsRow({ tool_allowlist: null }),
      claimsRow({
        user_id: "77777777-7777-4777-8777-777777777777",
        tool_allowlist: [],
      }),
    ]);
    await publishUserClaimsManifest(TENANT_ID, { s3, bucket: BUCKET });
    const [surfaceDefault, noTools] = manifestBody().users;
    expect(surfaceDefault.toolAllowlist).toBeNull();
    expect(noTools.toolAllowlist).toEqual([]);
  });

  it("publishes nothing for a flag-off tenant and deletes any stale object", async () => {
    seed(false);
    const result = await publishUserClaimsManifest(TENANT_ID, {
      s3,
      bucket: BUCKET,
    });

    expect(result).toEqual({
      published: false,
      reason: "claims_disabled",
      deleted: true,
      key: `user-claims/${TENANT_ID}/latest.json`,
    });
    expect(puts().length).toBe(0);
    expect(deletes().length).toBe(1);
    expect(deletes()[0]!.Key).toBe(`user-claims/${TENANT_ID}/latest.json`);
    // Bailed before ever reading claims rows.
    expect(selectQueue.length).toBe(0);
  });

  it("treats a tenant with no settings row as flag-off", async () => {
    selectQueue.push([]);
    const result = await publishUserClaimsManifest(TENANT_ID, {
      s3,
      bucket: BUCKET,
    });
    expect(result.published).toBe(false);
    expect(result.reason).toBe("claims_disabled");
    expect(puts().length).toBe(0);
  });

  it("returns { published: false } without throwing when the bucket is unset", async () => {
    const result = await publishUserClaimsManifest(TENANT_ID, { s3 });
    expect(result).toEqual({ published: false, reason: "no_bucket" });
    expect(calls.length).toBe(0);
    expect(selectQueue.length).toBe(0); // bailed before the db read
    expect(console.error).toHaveBeenCalled();
  });

  it("returns { published: false, reason } without throwing on S3 failure", async () => {
    seed(true, [claimsRow()]);
    const result = await publishUserClaimsManifest(TENANT_ID, {
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

describe("userClaimsManifestKey", () => {
  it("is derived from the same tenant scope as the twin key manifest", () => {
    expect(userClaimsManifestKey(TENANT_ID)).toBe(
      `user-claims/${TENANT_ID}/latest.json`,
    );
    // The Brain resolves one keyspace and reads both documents under it, so
    // the tenant segment must be byte-identical.
    const scopeOf = (key: string) => key.split("/")[1];
    expect(scopeOf(userClaimsManifestKey(TENANT_ID))).toBe(
      scopeOf(twinKeyManifestKey(TENANT_ID)),
    );
  });
});

describe("subject prefers the captured Brain-pool sub (THINK-625 backfill)", () => {
  it("publishes brain_subject when the mcp-oauth callback captured one", async () => {
    seed(true, [claimsRow({ brain_subject: "brain-pool-sub-9" })]);
    await publishUserClaimsManifest(TENANT_ID, { s3, bucket: BUCKET });
    // users.cognito_sub is THIS product's pool; the Brain matches its own
    // access token's sub, which is what the callback captured.
    expect(manifestBody().users[0].subject).toBe("brain-pool-sub-9");
  });

  it("falls back to cognito_sub for rows that never connected the Brain", async () => {
    seed(true, [claimsRow({ brain_subject: null })]);
    await publishUserClaimsManifest(TENANT_ID, { s3, bucket: BUCKET });
    expect(manifestBody().users[0].subject).toBe("cognito-sub-1");
  });
});
