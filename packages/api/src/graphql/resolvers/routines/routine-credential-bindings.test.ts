import { describe, expect, it, vi } from "vitest";

const { mockCredentialRows } = vi.hoisted(() => ({
  mockCredentialRows: vi.fn(),
}));

vi.mock("../../../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockCredentialRows()),
      }),
    }),
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantCredentials: {
    id: "tenant_credentials.id",
    tenant_id: "tenant_credentials.tenant_id",
    slug: "tenant_credentials.slug",
    display_name: "tenant_credentials.display_name",
    kind: "tenant_credentials.kind",
    status: "tenant_credentials.status",
    eventbridge_connection_arn: "tenant_credentials.eventbridge_connection_arn",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  or: (...args: unknown[]) => ({ or: args }),
}));

import {
  collectRoutineCredentialReferences,
  prepareRoutineCredentialArtifacts,
  validateReferenceShape,
} from "../../../lib/routines/credential-bindings.js";
import { HTTP_CREDENTIAL_CONNECTION_PREFIX } from "../../../lib/routines/recipe-catalog.js";

describe("routine credential bindings", () => {
  it("collects code-step credential handles from manifests and ASL", () => {
    const refs = collectRoutineCredentialReferences({
      markdownSummary: "",
      stepManifestJson: {
        definition: {
          steps: [
            {
              nodeId: "AddFuelOrder",
              recipeId: "typescript",
              args: {
                credentialBindings: [
                  {
                    alias: "pdi",
                    credentialId: "pdi-soap",
                    requiredFields: ["partnerId"],
                  },
                ],
              },
            },
          ],
        },
      },
      aslJson: {
        StartAt: "AddFuelOrder",
        States: {
          AddFuelOrder: {
            Type: "Task",
            Comment: "recipe:typescript",
            Parameters: {
              Payload: {
                code: "console.log('ok')",
                credentialBindings: [
                  {
                    alias: "pdi",
                    credentialId: "pdi-soap",
                    requiredFields: ["partnerId"],
                  },
                ],
              },
            },
            End: true,
          },
        },
      },
    });

    expect(refs).toEqual([
      {
        alias: "pdi",
        handle: "pdi-soap",
        nodeId: "AddFuelOrder",
        recipeId: "typescript",
        requiredFields: ["partnerId"],
        usage: "code_binding",
      },
    ]);
  });

  it("collects HTTP credential placeholders from emitted ASL", () => {
    const refs = collectRoutineCredentialReferences({
      markdownSummary: "",
      stepManifestJson: { definition: { steps: [] } },
      aslJson: {
        StartAt: "CallPdi",
        States: {
          CallPdi: {
            Type: "Task",
            Comment: "recipe:http_request",
            Parameters: {
              Authentication: {
                ConnectionArn: `${HTTP_CREDENTIAL_CONNECTION_PREFIX}pdi-api`,
              },
            },
            End: true,
          },
        },
      },
    });

    expect(refs).toEqual([
      expect.objectContaining({
        alias: "http",
        handle: "pdi-api",
        nodeId: "CallPdi",
        recipeId: "http_request",
        usage: "http_connection",
      }),
    ]);
  });

  it("rejects duplicate and unsafe aliases before publish", () => {
    const issues = validateReferenceShape([
      {
        alias: "pdi",
        handle: "pdi-soap",
        nodeId: "Code",
        recipeId: "python",
        requiredFields: [],
        usage: "code_binding",
      },
      {
        alias: "pdi",
        handle: "pdi-backup",
        nodeId: "Code",
        recipeId: "python",
        requiredFields: [],
        usage: "code_binding",
      },
      {
        alias: "bad-alias",
        handle: "other",
        nodeId: "OtherCode",
        recipeId: "python",
        requiredFields: [],
        usage: "code_binding",
      },
    ]);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "credential_alias_duplicate",
        "credential_alias_invalid",
      ]),
    );
  });

  it("rejects reserved prototype aliases before publish", () => {
    const issues = validateReferenceShape([
      {
        alias: "__proto__",
        handle: "pdi-soap",
        nodeId: "Code",
        recipeId: "typescript",
        requiredFields: [],
        usage: "code_binding",
      },
    ]);

    expect(issues.map((issue) => issue.code)).toContain(
      "credential_alias_invalid",
    );
  });

  it("replaces HTTP credential placeholders with the tenant connection ARN", async () => {
    mockCredentialRows.mockReturnValueOnce([
      credentialRow({
        kind: "bearer_token",
        eventbridge_connection_arn:
          "arn:aws:events:us-east-1:1:connection/pdi-api/abc",
      }),
    ]);

    const prepared = await prepareRoutineCredentialArtifacts({
      tenantId: "tenant-1",
      artifacts: httpArtifacts("pdi-api"),
    });

    const states = (prepared.artifacts.aslJson as any).States;
    expect(states.CallPdi.Parameters.Authentication.ConnectionArn).toBe(
      "arn:aws:events:us-east-1:1:connection/pdi-api/abc",
    );
  });

  it("rejects HTTP credentials without EventBridge connection ARNs", async () => {
    mockCredentialRows.mockReturnValueOnce([
      credentialRow({ kind: "bearer_token", eventbridge_connection_arn: null }),
    ]);

    await expect(
      prepareRoutineCredentialArtifacts({
        tenantId: "tenant-1",
        artifacts: httpArtifacts("pdi-api"),
      }),
    ).rejects.toThrow(/no EventBridge connection ARN/);
  });

  it("rejects HTTP-incompatible credentials before publish", async () => {
    mockCredentialRows.mockReturnValueOnce([
      credentialRow({
        kind: "soap_partner",
        eventbridge_connection_arn:
          "arn:aws:events:us-east-1:1:connection/pdi-api/abc",
      }),
    ]);

    await expect(
      prepareRoutineCredentialArtifacts({
        tenantId: "tenant-1",
        artifacts: httpArtifacts("pdi-api"),
      }),
    ).rejects.toThrow(/cannot use soap_partner credential/);
  });
});

function credentialRow(
  overrides: Partial<{
    id: string;
    tenant_id: string;
    slug: string;
    display_name: string;
    kind: string;
    status: string;
    eventbridge_connection_arn: string | null;
  }> = {},
) {
  return {
    id: "credential-1",
    tenant_id: "tenant-1",
    slug: "pdi-api",
    display_name: "PDI API",
    kind: "bearer_token",
    status: "active",
    eventbridge_connection_arn: null,
    ...overrides,
  };
}

function httpArtifacts(handle: string) {
  return {
    markdownSummary: "",
    stepManifestJson: { definition: { steps: [] } },
    aslJson: {
      StartAt: "CallPdi",
      States: {
        CallPdi: {
          Type: "Task",
          Comment: "recipe:http_request",
          Parameters: {
            Authentication: {
              ConnectionArn: `${HTTP_CREDENTIAL_CONNECTION_PREFIX}${handle}`,
            },
          },
          End: true,
        },
      },
    },
  };
}
