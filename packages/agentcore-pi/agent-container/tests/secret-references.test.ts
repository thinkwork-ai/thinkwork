import { describe, expect, it } from "vitest";

import {
  resolveRuntimeSecretReference,
  SecretReferenceError,
  tenantSecretAliasParameterName,
} from "../src/runtime/secret-references.js";

const base = {
  tenantId: "tenant-1",
  userId: "user-1",
  stage: "dev",
  region: "us-east-1",
  accountId: "123456789012",
};

describe("runtime secret references", () => {
  it("resolves tenant-scoped secret aliases from SSM", async () => {
    const ssmCalls: unknown[] = [];
    const value = await resolveRuntimeSecretReference({
      ...base,
      ref: "secret://browser/nova-act",
      grants: [{ tenantId: "tenant-1", ref: "secret://browser/nova-act" }],
      ssmClient: {
        send: async (command) => {
          ssmCalls.push(command.input);
          return { Parameter: { Value: "nova-key" } };
        },
      },
    });

    expect(value).toBe("nova-key");
    expect(ssmCalls).toEqual([
      {
        Name: tenantSecretAliasParameterName({
          stage: "dev",
          tenantId: "tenant-1",
          alias: "browser/nova-act",
        }),
        WithDecryption: true,
      },
    ]);
  });

  it("resolves alias values that point at approved Secrets Manager ARNs", async () => {
    const secretArn =
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/tenants/tenant-1/browser/nova-act-AbCd";

    const value = await resolveRuntimeSecretReference({
      ...base,
      ref: "secret://browser/nova-act",
      grants: [{ tenantId: "tenant-1", ref: "secret://browser/nova-act" }],
      ssmClient: {
        send: async () => ({ Parameter: { Value: secretArn } }),
      },
      secretsManagerClient: {
        send: async (command) => {
          expect(command.input).toEqual({ SecretId: secretArn });
          return { SecretString: "resolved-secret" };
        },
      },
    });

    expect(value).toBe("resolved-secret");
  });

  it("rejects raw ARNs outside the approved account, stage, and tenant prefix", async () => {
    await expect(
      resolveRuntimeSecretReference({
        ...base,
        ref: "arn:aws:secretsmanager:us-east-1:123456789012:secret:other/prod/shared-AbCd",
        grants: [
          {
            tenantId: "tenant-1",
            ref: "arn:aws:secretsmanager:us-east-1:123456789012:secret:other/prod/shared-AbCd",
          },
        ],
        secretsManagerClient: {
          send: async () => ({ SecretString: "should-not-read" }),
        },
      }),
    ).rejects.toMatchObject({
      code: "SECRET_REFERENCE_UNAPPROVED",
    } satisfies Partial<SecretReferenceError>);
  });

  it("requires a tenant/user grant before resolving", async () => {
    await expect(
      resolveRuntimeSecretReference({
        ...base,
        ref: "secret://browser/nova-act",
        grants: [
          {
            tenantId: "tenant-1",
            userId: "other",
            ref: "secret://browser/nova-act",
          },
        ],
        ssmClient: {
          send: async () => ({ Parameter: { Value: "should-not-read" } }),
        },
      }),
    ).rejects.toMatchObject({
      code: "SECRET_GRANT_REQUIRED",
    } satisfies Partial<SecretReferenceError>);
  });

  it("rejects non-canonical aliases", async () => {
    await expect(
      resolveRuntimeSecretReference({
        ...base,
        ref: "secret://../prod/root",
        grants: [{ tenantId: "tenant-1", ref: "secret://../prod/root" }],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_SECRET_REFERENCE",
    } satisfies Partial<SecretReferenceError>);
  });
});
