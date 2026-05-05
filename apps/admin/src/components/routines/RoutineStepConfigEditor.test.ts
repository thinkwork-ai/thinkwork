import { describe, expect, it } from "vitest";
import {
  argsFromStepFields,
  codeLanguageForStep,
  parseCredentialBindings,
  stringifyCredentialBindings,
  validationErrorsFromSteps,
  type RoutineConfigStep,
} from "./RoutineStepConfigEditor";

const credentialField = {
  key: "credentialBindings",
  label: "Credential bindings",
  value: [],
  inputType: "credential_bindings",
  control: "credential_bindings",
  required: false,
  editable: true,
  options: null,
  placeholder: null,
  helpText: null,
  min: null,
  max: null,
  pattern: null,
};
const pdiCredentialId = "11111111-1111-4111-8111-111111111111";
const backupCredentialId = "22222222-2222-4222-8222-222222222222";

describe("RoutineStepConfigEditor helpers", () => {
  it("selects TypeScript CodeMirror language from the recipe id", () => {
    expect(codeLanguageForStep({ recipeId: "typescript" })).toBe("typescript");
    expect(codeLanguageForStep({ recipeId: "python" })).toBe("python");
  });

  it("round-trips structured credential bindings without secret values", () => {
    const value = stringifyCredentialBindings([
      {
        alias: "pdi",
        credentialId: pdiCredentialId,
        requiredFields: ["apiUrl", "password"],
      },
    ]);

    expect(parseCredentialBindings(value)).toEqual([
      {
        alias: "pdi",
        credentialId: pdiCredentialId,
        requiredFields: ["apiUrl", "password"],
      },
    ]);
    expect(value).not.toContain("super-secret-password");
  });

  it("builds mutation args from credential binding JSON", () => {
    const step = stepWithCredentialField();
    const values = {
      "RunPdi.credentialBindings": stringifyCredentialBindings([
        { alias: "pdi", credentialId: pdiCredentialId },
      ]),
    };

    expect(argsFromStepFields(step, values)).toEqual({
      credentialBindings: [{ alias: "pdi", credentialId: pdiCredentialId }],
    });
  });

  it("validates duplicate aliases", () => {
    const step = stepWithCredentialField();
    const values = {
      "RunPdi.credentialBindings": stringifyCredentialBindings([
        { alias: "pdi", credentialId: pdiCredentialId, requiredFields: ["ok"] },
        {
          alias: "pdi",
          credentialId: backupCredentialId,
          requiredFields: ["not-safe-field"],
        },
      ]),
    };

    const errors = validationErrorsFromSteps([step], values);

    expect(errors["RunPdi.credentialBindings"]).toBe(
      "Credential alias pdi is duplicated.",
    );
  });

  it("validates required field identifiers", () => {
    const step = stepWithCredentialField();
    const values = {
      "RunPdi.credentialBindings": stringifyCredentialBindings([
        {
          alias: "pdi",
          credentialId: pdiCredentialId,
          requiredFields: ["not-safe-field"],
        },
      ]),
    };

    const errors = validationErrorsFromSteps([step], values);

    expect(errors["RunPdi.credentialBindings"]).toBe(
      "Required fields must be safe code identifiers.",
    );
  });
});

function stepWithCredentialField(): RoutineConfigStep {
  return {
    nodeId: "RunPdi",
    recipeId: "typescript",
    recipeName: "Run TypeScript code",
    label: "Run PDI",
    args: {},
    configFields: [credentialField],
  };
}
