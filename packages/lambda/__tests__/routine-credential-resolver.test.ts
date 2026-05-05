import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRoutineCredentialBindings } from "../routine-credential-resolver.js";

const TENANT = "00000000-0000-4000-8000-000000000001";

function fakeDb(rows: unknown[]) {
  const updates: unknown[] = [];
  return {
    updates,
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
      update: () => ({
        set: (value: unknown) => ({
          where: () => {
            updates.push(value);
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
}

describe("resolveRoutineCredentialBindings", () => {
  let secretsManager: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    secretsManager = { send: vi.fn() };
  });

  it("resolves active tenant credentials by slug and returns redaction values", async () => {
    const { db, updates } = fakeDb([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: TENANT,
        slug: "pdi-soap",
        display_name: "PDI SOAP",
        status: "active",
        secret_ref: "secret-ref",
      },
    ]);
    secretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({
        apiUrl: "https://pdi.example.test",
        username: "fuel-user",
        password: "super-secret-password",
        partnerId: "partner-123",
      }),
    });

    const resolved = await resolveRoutineCredentialBindings({
      tenantId: TENANT,
      bindings: [
        {
          alias: "pdi",
          credentialId: "pdi-soap",
          requiredFields: ["partnerId", "password"],
        },
      ],
      secretsManager: secretsManager as never,
      database: db as never,
      now: () => new Date("2026-05-04T16:00:00Z"),
    });

    expect(resolved.credentials.pdi).toMatchObject({
      partnerId: "partner-123",
      password: "super-secret-password",
    });
    expect(resolved.redactionValues).toEqual(
      expect.arrayContaining(["super-secret-password", "partner-123"]),
    );
    expect(updates).toHaveLength(1);
  });

  it("resolves multiple credential variables by id and slug", async () => {
    const { db, updates } = fakeDb([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: TENANT,
        slug: "pdi-soap",
        display_name: "PDI SOAP",
        status: "active",
        secret_ref: "pdi-secret-ref",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        tenant_id: TENANT,
        slug: "lastmile-api",
        display_name: "LastMile API",
        status: "active",
        secret_ref: "lastmile-secret-ref",
      },
    ]);
    secretsManager.send
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({ partnerId: "partner-123" }),
      })
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({ apiKey: "lastmile-secret" }),
      });

    const resolved = await resolveRoutineCredentialBindings({
      tenantId: TENANT,
      bindings: [
        {
          alias: "pdi",
          credentialId: "11111111-1111-4111-8111-111111111111",
          requiredFields: ["partnerId"],
        },
        {
          alias: "lastmile",
          credentialId: "lastmile-api",
          requiredFields: ["apiKey"],
        },
      ],
      secretsManager: secretsManager as never,
      database: db as never,
    });

    expect(resolved.credentials).toEqual({
      pdi: { partnerId: "partner-123" },
      lastmile: { apiKey: "lastmile-secret" },
    });
    expect(resolved.credentialIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(resolved.redactionValues).toEqual(
      expect.arrayContaining(["partner-123", "lastmile-secret"]),
    );
    expect(updates).toHaveLength(1);
  });

  it("rejects disabled credentials without reading Secrets Manager", async () => {
    const { db } = fakeDb([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: TENANT,
        slug: "pdi-soap",
        display_name: "PDI SOAP",
        status: "disabled",
        secret_ref: "secret-ref",
      },
    ]);

    await expect(
      resolveRoutineCredentialBindings({
        tenantId: TENANT,
        bindings: [{ alias: "pdi", credentialId: "pdi-soap" }],
        secretsManager: secretsManager as never,
        database: db as never,
      }),
    ).rejects.toThrow(/not active/);
    expect(secretsManager.send).not.toHaveBeenCalled();
  });

  it("rejects prototype-special credential variables without reading Secrets Manager", async () => {
    const { db } = fakeDb([]);

    await expect(
      resolveRoutineCredentialBindings({
        tenantId: TENANT,
        bindings: [{ alias: "__proto__", credentialId: "pdi-soap" }],
        secretsManager: secretsManager as never,
        database: db as never,
      }),
    ).rejects.toThrow("safe code identifier");
    expect(secretsManager.send).not.toHaveBeenCalled();
  });

  it("rejects missing required fields without listing available secret fields", async () => {
    const { db } = fakeDb([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: TENANT,
        slug: "pdi-soap",
        display_name: "PDI SOAP",
        status: "active",
        secret_ref: "secret-ref",
      },
    ]);
    secretsManager.send.mockResolvedValue({
      SecretString: JSON.stringify({
        username: "fuel-user",
        password: "super-secret-password",
      }),
    });

    await expect(
      resolveRoutineCredentialBindings({
        tenantId: TENANT,
        bindings: [
          {
            alias: "pdi",
            credentialId: "pdi-soap",
            requiredFields: ["partnerId"],
          },
        ],
        secretsManager: secretsManager as never,
        database: db as never,
      }),
    ).rejects.toThrow("missing required field 'partnerId'");
  });

  it("sanitizes Secrets Manager failures", async () => {
    const { db } = fakeDb([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: TENANT,
        slug: "pdi-soap",
        display_name: "PDI SOAP",
        status: "active",
        secret_ref:
          "arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/routines/secret",
      },
    ]);
    const err = new Error(
      "Secret arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/routines/secret not found",
    ) as Error & { name: string };
    err.name = "ResourceNotFoundException";
    secretsManager.send.mockRejectedValue(err);

    await expect(
      resolveRoutineCredentialBindings({
        tenantId: TENANT,
        bindings: [{ alias: "pdi", credentialId: "pdi-soap" }],
        secretsManager: secretsManager as never,
        database: db as never,
      }),
    ).rejects.toThrow(
      "Failed to read credential 'PDI SOAP': ResourceNotFoundException",
    );
  });
});
