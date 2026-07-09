/**
 * rds_iam mutation-branch tests (THINK-229 U1 / R2).
 *
 * The metadata-only kind must never touch Secrets Manager: create stores
 * an empty secret_ref sentinel and rejects a pasted secret, rotate is
 * blocked with a redirect to metadata updates, delete skips secret
 * deletion, and update enforces the metadata contract.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbState, secretStoreCalls } = vi.hoisted(() => ({
  dbState: {
    // Row returned by loadTenantCredentialForMutation-style lookups.
    currentRow: null as Record<string, unknown> | null,
    inserted: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
  },
  secretStoreCalls: {
    put: 0,
    rotate: 0,
    scheduleDeletion: 0,
  },
}));

vi.mock("../../utils.js", () => {
  const insertChain = {
    values: (v: Record<string, unknown>) => {
      dbState.inserted.push(v);
      return { returning: async () => [v] };
    },
  };
  const updateChain = {
    set: (v: Record<string, unknown>) => {
      dbState.updated.push(v);
      return {
        where: () => ({
          returning: async () => [{ ...dbState.currentRow, ...v }],
        }),
      };
    },
  };
  return {
    db: {
      insert: () => insertChain,
      update: () => updateChain,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (dbState.currentRow ? [dbState.currentRow] : []),
          }),
        }),
      }),
    },
    eq: () => ({}),
    and: () => ({}),
    tenantCredentials: {},
    snakeToCamel: (value: Record<string, unknown>) => value,
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrApiKeyCaller: async () => undefined,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: async () => "user-1",
}));
vi.mock("../../../lib/routines/repo-connection.js", () => ({
  validateGithubRepoConnection: async () => undefined,
}));

vi.mock("../../../lib/tenant-credentials/secret-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/tenant-credentials/secret-store.js")
  >("../../../lib/tenant-credentials/secret-store.js");
  return {
    ...actual,
    putTenantCredentialSecret: async () => {
      secretStoreCalls.put += 1;
      return "arn:aws:secretsmanager:created";
    },
    rotateTenantCredentialSecret: async () => {
      secretStoreCalls.rotate += 1;
    },
    scheduleTenantCredentialSecretDeletion: async () => {
      secretStoreCalls.scheduleDeletion += 1;
    },
  };
});

import { createTenantCredential } from "./createTenantCredential.mutation.js";
import { rotateTenantCredential } from "./rotateTenantCredential.mutation.js";
import { deleteTenantCredential } from "./deleteTenantCredential.mutation.js";
import { updateTenantCredential } from "./updateTenantCredential.mutation.js";

const ctx = { auth: { principalId: "user-1" } } as never;

const RDS_IAM_METADATA = {
  clusterEndpoint: "thinkwork-dev-db.cluster-abc.us-east-1.rds.amazonaws.com",
  port: 5432,
  database: "thinkwork",
  dbUser: "analyst_reader",
  clusterResourceId: "cluster-ABC123",
};

describe("rds_iam credential mutations (THINK-229 U1)", () => {
  beforeEach(() => {
    dbState.currentRow = null;
    dbState.inserted.length = 0;
    dbState.updated.length = 0;
    secretStoreCalls.put = 0;
    secretStoreCalls.rotate = 0;
    secretStoreCalls.scheduleDeletion = 0;
  });

  it("create: stores empty secret_ref, validates metadata, never touches Secrets Manager", async () => {
    await createTenantCredential(
      undefined,
      {
        input: {
          tenantId: "tenant-1",
          displayName: "Analyst reader (RDS IAM)",
          kind: "rds_iam",
          metadataJson: RDS_IAM_METADATA,
          secretJson: {},
        },
      },
      ctx,
    );
    expect(secretStoreCalls.put).toBe(0);
    expect(dbState.inserted).toHaveLength(1);
    expect(dbState.inserted[0]).toMatchObject({
      kind: "rds_iam",
      secret_ref: "",
    });
  });

  it("create: rejects missing metadata before writing anything", async () => {
    await expect(
      createTenantCredential(
        undefined,
        {
          input: {
            tenantId: "tenant-1",
            displayName: "Analyst reader (RDS IAM)",
            kind: "rds_iam",
            metadataJson: { clusterEndpoint: "host" },
            secretJson: {},
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/missing required field/);
    expect(dbState.inserted).toHaveLength(0);
    expect(secretStoreCalls.put).toBe(0);
  });

  it("create: rejects a pasted secret instead of silently discarding it", async () => {
    await expect(
      createTenantCredential(
        undefined,
        {
          input: {
            tenantId: "tenant-1",
            displayName: "Analyst reader (RDS IAM)",
            kind: "rds_iam",
            metadataJson: RDS_IAM_METADATA,
            secretJson: { password: "should-not-be-here" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/store no secret/);
    expect(dbState.inserted).toHaveLength(0);
    expect(secretStoreCalls.put).toBe(0);
  });

  it("rotate: blocked for rds_iam, never calls Secrets Manager", async () => {
    dbState.currentRow = {
      id: "cred-1",
      tenant_id: "tenant-1",
      kind: "rds_iam",
      secret_ref: "",
      status: "active",
      deleted_at: null,
    };
    await expect(
      rotateTenantCredential(
        undefined,
        { input: { id: "cred-1", secretJson: {} } },
        ctx,
      ),
    ).rejects.toThrow(/no stored secret to rotate/);
    expect(secretStoreCalls.rotate).toBe(0);
  });

  it("delete: skips secret deletion for the empty sentinel but still soft-deletes the row", async () => {
    dbState.currentRow = {
      id: "cred-1",
      tenant_id: "tenant-1",
      kind: "rds_iam",
      secret_ref: "",
      status: "active",
      deleted_at: null,
    };
    await deleteTenantCredential(undefined, { id: "cred-1" }, ctx);
    expect(secretStoreCalls.scheduleDeletion).toBe(0);
    expect(dbState.updated).toHaveLength(1);
    expect(dbState.updated[0]).toMatchObject({ status: "deleted" });
  });

  it("update: enforces the rds_iam metadata contract on the sanctioned edit path", async () => {
    dbState.currentRow = {
      id: "cred-1",
      tenant_id: "tenant-1",
      kind: "rds_iam",
      secret_ref: "",
      status: "active",
      deleted_at: null,
    };
    await expect(
      updateTenantCredential(
        undefined,
        { id: "cred-1", input: { metadataJson: { clusterEndpoint: "only" } } },
        ctx,
      ),
    ).rejects.toThrow(/missing required field/);

    dbState.updated.length = 0;
    await updateTenantCredential(
      undefined,
      { id: "cred-1", input: { metadataJson: RDS_IAM_METADATA } },
      ctx,
    );
    expect(dbState.updated).toHaveLength(1);
  });
});
