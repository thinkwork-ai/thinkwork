import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  __resetTenantCredentialSecretStoreForTest,
  normalizeCredentialSecret,
  parseAwsJsonObject,
  putTenantCredentialSecret,
  readTenantCredentialSecret,
  rotateTenantCredentialSecret,
  scheduleTenantCredentialSecretDeletion,
  tenantCredentialSecretName,
} from "./secret-store";

const sm = mockClient(SecretsManagerClient);

describe("tenant credential secret store", () => {
  beforeEach(() => {
    sm.reset();
    __resetTenantCredentialSecretStoreForTest();
    delete process.env.STAGE;
  });

  it("builds stage/tenant scoped secret names", () => {
    expect(
      tenantCredentialSecretName({
        stage: "dev",
        tenantId: "tenant-1",
        credentialId: "cred-1",
      }),
    ).toBe("thinkwork/dev/routines/tenant-1/credentials/cred-1");
  });

  it("validates required fields for SOAP partner credentials", () => {
    expect(() =>
      normalizeCredentialSecret("soap_partner", {
        apiUrl: "https://pdi.example/ws",
        username: "user",
        password: "",
        partnerId: "partner",
      }),
    ).toThrow(/password/);

    expect(
      normalizeCredentialSecret("soap_partner", {
        apiUrl: "https://pdi.example/ws",
        username: "user",
        password: "secret",
        partnerId: "partner",
      }),
    ).toEqual({
      apiUrl: "https://pdi.example/ws",
      username: "user",
      password: "secret",
      partnerId: "partner",
    });
  });

  it("parses AWSJSON wire strings and rejects arrays", () => {
    expect(parseAwsJsonObject('{"label":"PDI"}', "metadataJson")).toEqual({
      label: "PDI",
    });
    expect(() => parseAwsJsonObject("[]", "metadataJson")).toThrow(
      /JSON object/,
    );
  });

  it("creates a new Secrets Manager secret and returns the ARN", async () => {
    sm.on(CreateSecretCommand).resolves({
      ARN: "arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/routines/t/c",
    });

    await expect(
      putTenantCredentialSecret({
        secretName: "thinkwork/dev/routines/t/credentials/c",
        payload: { token: "secret" },
      }),
    ).resolves.toMatch(/^arn:aws:secretsmanager/);

    const calls = sm.commandCalls(CreateSecretCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.SecretString).toBe('{"token":"secret"}');
  });

  it("adds a new secret version when the secret already exists", async () => {
    sm.on(CreateSecretCommand).rejects({ name: "ResourceExistsException" });
    sm.on(UpdateSecretCommand).resolves({});

    await expect(
      putTenantCredentialSecret({
        secretName: "thinkwork/dev/routines/t/credentials/c",
        payload: { token: "rotated" },
      }),
    ).resolves.toBe("thinkwork/dev/routines/t/credentials/c");

    expect(sm.commandCalls(UpdateSecretCommand)).toHaveLength(1);
  });

  it("rotates, reads, and schedules deletion without exposing values in metadata", async () => {
    sm.on(UpdateSecretCommand).resolves({});
    sm.on(GetSecretValueCommand).resolves({
      SecretString: '{"username":"u","password":"p"}',
    });
    sm.on(DeleteSecretCommand).resolves({});

    await rotateTenantCredentialSecret({
      secretRef: "secret-ref",
      payload: { username: "u", password: "p" },
    });
    await expect(readTenantCredentialSecret("secret-ref")).resolves.toEqual({
      username: "u",
      password: "p",
    });
    await scheduleTenantCredentialSecretDeletion("secret-ref");

    expect(sm.commandCalls(UpdateSecretCommand)).toHaveLength(1);
    expect(sm.commandCalls(GetSecretValueCommand)).toHaveLength(1);
    expect(sm.commandCalls(DeleteSecretCommand)[0].args[0].input).toMatchObject({
      SecretId: "secret-ref",
      RecoveryWindowInDays: 7,
    });
  });
});
