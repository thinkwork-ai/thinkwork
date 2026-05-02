import { describe, expect, it, vi } from "vitest";
import { validateRoutineAsl } from "../../handlers/routine-asl-validator.js";
import {
  applyRoutineDefinitionEdits,
  planRoutineFromIntent,
  routineDefinitionFromArtifacts,
} from "./routine-authoring-planner.js";

const okSfn = {
  send: vi.fn().mockResolvedValue({ result: "OK", diagnostics: [] }),
} as any;

describe("routine authoring planner", () => {
  it("plans an Austin weather email routine from the recipe catalog", async () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent:
        "Check the weather in Austin and email it to ericodom37@gmail.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect(result.artifacts.plan).toMatchObject({
      kind: "weather_email",
      steps: [
        { nodeId: "FetchAustinWeather", recipeId: "python" },
        { nodeId: "EmailAustinWeather", recipeId: "email_send" },
      ],
      editableFields: [
        {
          key: "recipientEmail",
          value: "ericodom37@gmail.com",
          inputType: "email",
        },
      ],
    });
    expect(result.artifacts.stepManifest).toMatchObject({
      definition: {
        kind: "weather_email",
        recipientEmail: "ericodom37@gmail.com",
      },
    });

    const validation = await validateRoutineAsl(
      { asl: result.artifacts.asl },
      { sfnClient: okSfn },
    );
    expect(validation.valid).toBe(true);
  });

  it("applies recipient edits and republishes recipe ASL", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineDefinitionEdits(result.artifacts.plan, [
      { key: "recipientEmail", value: "new@example.com" },
    ]);

    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error(edited.reason);
    expect(JSON.stringify(edited.artifacts.asl)).toContain("new@example.com");
    expect(JSON.stringify(edited.artifacts.asl)).not.toContain(
      "old@example.com",
    );
    expect(edited.artifacts.stepManifest).toMatchObject({
      definition: {
        kind: "weather_email",
        recipientEmail: "new@example.com",
      },
    });
  });

  it("rejects recipient edits that contain extra prose around an email", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineDefinitionEdits(result.artifacts.plan, [
      { key: "recipientEmail", value: "new@example.com please" },
    ]);

    expect(edited).toEqual({
      ok: false,
      reason: "Enter a valid recipient email address.",
    });
  });

  it("recovers an editable definition from the step manifest", () => {
    const result = routineDefinitionFromArtifacts({
      routineName: "Check Austin Weather",
      stepManifestJson: {
        definition: {
          kind: "weather_email",
          recipientEmail: "ericodom37@gmail.com",
        },
      },
      aslJson: {},
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        kind: "weather_email",
        editableFields: [{ key: "recipientEmail", value: "ericodom37@gmail.com" }],
      },
    });
  });

  it("recovers an editable definition from ASL when older manifests lack metadata", () => {
    const authored = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to asl@example.com.",
    });

    expect(authored.ok).toBe(true);
    if (!authored.ok) throw new Error(authored.reason);

    const result = routineDefinitionFromArtifacts({
      routineName: "Check Austin Weather",
      stepManifestJson: { steps: [] },
      aslJson: authored.artifacts.asl,
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        editableFields: [{ key: "recipientEmail", value: "asl@example.com" }],
      },
    });
  });

  it("rejects unsupported routine definitions", () => {
    const result = routineDefinitionFromArtifacts({
      routineName: "Custom",
      stepManifestJson: { steps: [] },
      aslJson: { StartAt: "Noop", States: {} },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("cannot be edited yet");
    }
  });
});
