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

describe("RoutineStepConfigEditor helpers", () => {
  it("selects TypeScript CodeMirror language from the recipe id", () => {
    expect(codeLanguageForStep({ recipeId: "typescript" })).toBe("typescript");
    expect(codeLanguageForStep({ recipeId: "python" })).toBe("python");
  });

  it("round-trips structured credential bindings without secret values", () => {
    const value = stringifyCredentialBindings([
      {
        alias: "pdi",
        credentialId: "pdi-soap",
        requiredFields: ["apiUrl", "password"],
      },
    ]);

    expect(parseCredentialBindings(value)).toEqual([
      {
        alias: "pdi",
        credentialId: "pdi-soap",
        requiredFields: ["apiUrl", "password"],
      },
    ]);
    expect(value).not.toContain("super-secret-password");
  });

  it("builds mutation args from credential binding JSON", () => {
    const step = stepWithCredentialField();
    const values = {
      "RunPdi.credentialBindings": stringifyCredentialBindings([
        { alias: "pdi", credentialId: "pdi-soap" },
      ]),
    };

    expect(argsFromStepFields(step, values)).toEqual({
      credentialBindings: [{ alias: "pdi", credentialId: "pdi-soap" }],
    });
  });

  it("validates duplicate aliases", () => {
    const step = stepWithCredentialField();
    const values = {
      "RunPdi.credentialBindings": stringifyCredentialBindings([
        { alias: "pdi", credentialId: "pdi-soap", requiredFields: ["ok"] },
        {
          alias: "pdi",
          credentialId: "pdi-backup",
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
          credentialId: "pdi-soap",
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
