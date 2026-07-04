import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const ARTIFACT_ID = "44444444-4444-4444-4444-444444444444";

const mocks = vi.hoisted(() => ({
  tables: {
    artifactVersions: {
      tenant_id: { name: "artifact_versions.tenant_id" },
      artifact_id: { name: "artifact_versions.artifact_id" },
      version: { name: "artifact_versions.version" },
    },
    artifactDataBindings: {
      tenant_id: { name: "artifact_data_bindings.tenant_id" },
      artifact_id: { name: "artifact_data_bindings.artifact_id" },
    },
  },
  // Rows the next db query chain will resolve to.
  nextRows: [] as Array<Record<string, unknown>>,
}));

// Thenable query-builder stub: `.where()` resolves to nextRows and also exposes
// `.orderBy()` which resolves to the same rows (mirrors drizzle's builder).
function makeChain() {
  const rowsPromise = () => Promise.resolve(mocks.nextRows);
  const whereResult: any = {
    orderBy: () => rowsPromise(),
    then: (onFulfilled: any, onRejected: any) =>
      rowsPromise().then(onFulfilled, onRejected),
  };
  return {
    from: () => ({ where: () => whereResult }),
  };
}

vi.mock("../../utils.js", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
  desc: (field: unknown) => ({ desc: field }),
  db: { select: () => makeChain() },
  artifactVersions: mocks.tables.artifactVersions,
  artifactDataBindings: mocks.tables.artifactDataBindings,
  snakeToCamel: (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())] = v;
    }
    return out;
  },
}));

import { artifactTypeResolvers } from "./types.js";

beforeEach(() => {
  mocks.nextRows = [];
});

describe("Artifact.versions field resolver", () => {
  it("camel-maps pinned versions for the parent artifact", async () => {
    mocks.nextRows = [
      {
        id: "v2",
        tenant_id: TENANT_ID,
        artifact_id: ARTIFACT_ID,
        version: 2,
        s3_key: "key/2",
        content_hash: "hash2",
        created_by: null,
      },
    ];

    const result = await artifactTypeResolvers.versions({
      id: ARTIFACT_ID,
      tenantId: TENANT_ID,
    });

    expect(result).toEqual([
      {
        id: "v2",
        tenantId: TENANT_ID,
        artifactId: ARTIFACT_ID,
        version: 2,
        s3Key: "key/2",
        contentHash: "hash2",
        createdBy: null,
      },
    ]);
  });

  it("returns [] without querying when the parent has no tenant id", async () => {
    const result = await artifactTypeResolvers.versions({ id: ARTIFACT_ID });
    expect(result).toEqual([]);
  });
});

describe("Artifact.bindings field resolver", () => {
  it("uppercases authContext + quality enum tokens on the way out", async () => {
    mocks.nextRows = [
      {
        id: "b1",
        tenant_id: TENANT_ID,
        artifact_id: ARTIFACT_ID,
        part_id: "part-1",
        element_id: "el-1",
        auth_context: "per_user_oauth",
        quality: "schema_stale",
      },
    ];

    const [binding] = await artifactTypeResolvers.bindings({
      id: ARTIFACT_ID,
      tenantId: TENANT_ID,
    });

    expect(binding).toMatchObject({
      partId: "part-1",
      elementId: "el-1",
      authContext: "PER_USER_OAUTH",
      quality: "SCHEMA_STALE",
    });
  });

  it("exposes redactedArgs (KTD9) and never the raw frozen_args", async () => {
    mocks.nextRows = [
      {
        id: "b1",
        tenant_id: TENANT_ID,
        artifact_id: ARTIFACT_ID,
        part_id: "part-1",
        element_id: "",
        auth_context: "tenant_mcp",
        quality: "good",
        frozen_args: { region: "us-east-1", apiKey: "sk-live-secret" },
      },
    ];

    const [binding] = (await artifactTypeResolvers.bindings({
      id: ARTIFACT_ID,
      tenantId: TENANT_ID,
    })) as Array<Record<string, unknown>>;

    expect(binding.frozenArgs).toBeUndefined();
    expect(binding.redactedArgs).toEqual({
      region: "us-east-1",
      apiKey: "[redacted]",
    });
  });

  it("tolerates a draft canvas (null spaceId) parent and resolves by artifact id", async () => {
    mocks.nextRows = [];
    const result = await artifactTypeResolvers.bindings({
      id: ARTIFACT_ID,
      tenantId: TENANT_ID,
      spaceId: null,
    });
    expect(result).toEqual([]);
  });
});
