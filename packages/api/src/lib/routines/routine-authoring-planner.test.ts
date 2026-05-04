import { describe, expect, it, vi } from "vitest";
import { validateRoutineAsl } from "../../handlers/routine-asl-validator.js";
import {
  applyRoutineDefinitionEdits,
  applyRoutineGraphDefinitionEdits,
  buildRoutineArtifactsFromPlan,
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

    expect(result.artifacts.plan.kind).toBe("recipe_graph");
    expect(result.artifacts.plan.steps).toHaveLength(2);
    expect(result.artifacts.plan.steps[0]).toMatchObject({
      nodeId: "FetchAustinWeather",
      recipeId: "python",
      configFields: expect.arrayContaining([
        expect.objectContaining({
          key: "timeoutSeconds",
          editable: false,
        }),
      ]),
    });
    expect(result.artifacts.plan.steps[1]).toMatchObject({
      nodeId: "EmailAustinWeather",
      recipeId: "email_send",
      args: {
        to: ["ericodom37@gmail.com"],
      },
      configFields: expect.arrayContaining([
        expect.objectContaining({
          key: "to",
          value: ["ericodom37@gmail.com"],
          inputType: "email_array",
          editable: true,
        }),
      ]),
    });
    expect(result.artifacts.stepManifest).toMatchObject({
      definition: {
        kind: "recipe_graph",
        steps: [
          { nodeId: "FetchAustinWeather", recipeId: "python" },
          {
            nodeId: "EmailAustinWeather",
            recipeId: "email_send",
            args: { to: ["ericodom37@gmail.com"] },
          },
        ],
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
      {
        nodeId: "EmailAustinWeather",
        args: { to: ["new@example.com"] },
      },
    ]);

    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error(edited.reason);
    expect(JSON.stringify(edited.artifacts.asl)).toContain("new@example.com");
    expect(JSON.stringify(edited.artifacts.asl)).not.toContain(
      "old@example.com",
    );
    const manifest = edited.artifacts.stepManifest.definition as {
      steps: Array<{
        nodeId: string;
        recipeId: string;
        args: Record<string, unknown>;
      }>;
    };
    expect(manifest.steps[1]).toMatchObject({
      nodeId: "EmailAustinWeather",
      recipeId: "email_send",
      args: { to: ["new@example.com"] },
    });
  });

  it("keeps credential bindings as handles in ASL and step manifests", () => {
    const result = buildRoutineArtifactsFromPlan({
      kind: "recipe_graph",
      title: "PDI fuel order",
      description: "Transform and submit a fuel order to PDI.",
      steps: [
        {
          nodeId: "AddFuelOrder",
          recipeId: "python",
          recipeName: "Run Python code",
          label: "Add fuel order",
          args: {
            code: "print(credentials['pdi']['partnerId'])",
            credentialBindings: [
              {
                alias: "pdi",
                credentialId: "pdi-soap",
                requiredFields: ["apiUrl", "username", "password", "partnerId"],
              },
            ],
          },
          configFields: [],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const serialized = JSON.stringify(result.artifacts);
    expect(serialized).toContain("pdi-soap");
    expect(serialized).toContain('"alias":"pdi"');
    expect(serialized).not.toContain("super-secret-password");
  });

  it("plans the PDI Fuel Order n8n migration draft from intent", () => {
    const result = planRoutineFromIntent({
      name: "PDI Fuel Order",
      intent: "Migrate the PDI Fuel Order n8n workflow.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.artifacts.plan.steps).toMatchObject([
      { nodeId: "TransformOrderToPDI", recipeId: "typescript" },
      { nodeId: "AddFuelOrder", recipeId: "typescript" },
    ]);
    expect(result.artifacts.stepManifest).toMatchObject({
      definition: {
        metadata: {
          migration: {
            sourceWorkflowName: "PDI Fuel Order",
            credentialRequirements: [
              {
                credentialType: "PDIApi",
                requiredFields: ["apiUrl", "username", "password", "partnerId"],
              },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(result.artifacts)).not.toContain(
      "super-secret-password",
    );
  });

  it("rejects recipient edits that contain extra prose around an email", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineDefinitionEdits(result.artifacts.plan, [
      {
        nodeId: "EmailAustinWeather",
        args: { to: ["new@example.com please"] },
      },
    ]);

    expect(edited).toEqual({
      ok: false,
      reason: "Enter valid email addresses for To.",
    });
  });

  it("recovers an editable definition from the step-scoped manifest", () => {
    const result = routineDefinitionFromArtifacts({
      routineName: "Check Austin Weather",
      stepManifestJson: {
        definition: {
          kind: "weather_email",
          steps: [
            {
              nodeId: "FetchAustinWeather",
              recipeId: "python",
              label: "Fetch Austin weather",
              args: {
                code: "print('ok')",
                timeoutSeconds: 30,
                networkAllowlist: ["wttr.in"],
              },
            },
            {
              nodeId: "EmailAustinWeather",
              recipeId: "email_send",
              label: "Email Austin weather",
              args: {
                to: ["ericodom37@gmail.com"],
                subject: "Austin weather update",
                bodyPath: "$.FetchAustinWeather.stdoutPreview",
                bodyFormat: "markdown",
              },
            },
          ],
        },
      },
      aslJson: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.kind).toBe("recipe_graph");
    expect(result.plan.steps[1]).toMatchObject({
      nodeId: "EmailAustinWeather",
      args: { to: ["ericodom37@gmail.com"] },
      configFields: expect.arrayContaining([
        expect.objectContaining({
          key: "to",
          value: ["ericodom37@gmail.com"],
        }),
        expect.objectContaining({
          key: "bodyPath",
          editable: false,
        }),
      ]),
    });
  });

  it("recovers an editable definition from older recipientEmail manifests", () => {
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
        kind: "recipe_graph",
        steps: [
          expect.anything(),
          {
            nodeId: "EmailAustinWeather",
            args: { to: ["ericodom37@gmail.com"] },
          },
        ],
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
        steps: [
          expect.anything(),
          {
            nodeId: "EmailAustinWeather",
            args: { to: ["asl@example.com"] },
          },
        ],
      },
    });
  });

  it("rejects read-only step config edits before rebuilding ASL", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineDefinitionEdits(result.artifacts.plan, [
      {
        nodeId: "EmailAustinWeather",
        args: { bodyPath: "$.SomeOtherState.output" },
      },
    ]);

    expect(edited).toEqual({
      ok: false,
      reason: "Body source is read-only.",
    });
  });

  it("builds Choice ASL from the graph definition edit contract", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineGraphDefinitionEdits(result.artifacts.plan, {
      startNodeId: "FetchAustinWeather",
      nodes: [
        {
          nodeId: "FetchAustinWeather",
          recipeId: "python",
          args: {},
          label: "Fetch Austin weather",
        },
        {
          nodeId: "ShouldEmail",
          kind: "choice",
          label: "Should email",
        },
        {
          nodeId: "EmailAustinWeather",
          recipeId: "email_send",
          args: { to: ["new@example.com"] },
          label: "Email Austin weather",
        },
        {
          nodeId: "Done",
          kind: "succeed",
          label: "Done",
        },
      ],
      edges: [
        { source: "FetchAustinWeather", target: "ShouldEmail", kind: "next" },
        {
          source: "ShouldEmail",
          target: "EmailAustinWeather",
          kind: "choice",
          condition: { Variable: "$.sendEmail", BooleanEquals: true },
        },
        { source: "ShouldEmail", target: "Done", kind: "default" },
      ],
    });

    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error(edited.reason);
    expect(edited.artifacts.asl).toMatchObject({
      StartAt: "FetchAustinWeather",
      States: {
        FetchAustinWeather: { Next: "ShouldEmail" },
        ShouldEmail: {
          Type: "Choice",
          Choices: [
            {
              Variable: "$.sendEmail",
              BooleanEquals: true,
              Next: "EmailAustinWeather",
            },
          ],
          Default: "Done",
        },
      },
    });
    expect(edited.artifacts.stepManifest.definition).toMatchObject({
      graph: {
        startNodeId: "FetchAustinWeather",
      },
    });
  });

  it("rejects graph choice edges without a default", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineGraphDefinitionEdits(result.artifacts.plan, {
      nodes: [
        { nodeId: "ShouldEmail", kind: "choice" },
        {
          nodeId: "EmailAustinWeather",
          recipeId: "email_send",
          args: { to: ["new@example.com"] },
        },
      ],
      edges: [
        {
          source: "ShouldEmail",
          target: "EmailAustinWeather",
          kind: "choice",
          condition: { Variable: "$.sendEmail", BooleanEquals: true },
        },
      ],
    });

    expect(edited).toEqual({
      ok: false,
      reason: "Choice node ShouldEmail must include a default edge.",
    });
  });

  it("rejects graph edits that contain only control nodes", () => {
    const result = planRoutineFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it to old@example.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const edited = applyRoutineGraphDefinitionEdits(result.artifacts.plan, {
      nodes: [{ nodeId: "Done", kind: "succeed" }],
      edges: [],
    });

    expect(edited).toEqual({
      ok: false,
      reason: "Routine graph definition must include at least one recipe node.",
    });
  });

  it("rejects empty plans before emitting invalid ASL", () => {
    expect(
      buildRoutineArtifactsFromPlan({
        kind: "weather_email",
        title: "Empty",
        description: "No steps",
        steps: [],
      }),
    ).toEqual({
      ok: false,
      reason: "Routine definition must include at least one step.",
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
