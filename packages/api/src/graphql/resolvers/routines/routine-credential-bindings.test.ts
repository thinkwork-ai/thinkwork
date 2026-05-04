import { describe, expect, it } from "vitest";
import {
  collectRoutineCredentialReferences,
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
});
