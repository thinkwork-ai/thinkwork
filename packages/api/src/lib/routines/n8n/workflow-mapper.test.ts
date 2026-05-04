import { describe, expect, it } from "vitest";
import { validateRoutineAsl } from "../../../handlers/routine-asl-validator.js";
import { buildRoutineArtifactsFromPlan } from "../routine-authoring-planner.js";
import fixture from "./pdi-fuel-order-fixture.json";
import { mapN8nWorkflowToRoutinePlan } from "./workflow-mapper.js";
import type { N8nWorkflow } from "./workflow-types.js";

const okSfn = {
  send: async () => ({ result: "OK", diagnostics: [] }),
} as any;

describe("n8n workflow mapper", () => {
  it("maps the PDI Fuel Order fixture to TypeScript routine steps with webhook metadata", async () => {
    const mapped = mapN8nWorkflowToRoutinePlan(
      fixture as unknown as N8nWorkflow,
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.plan.steps).toMatchObject([
      {
        nodeId: "TransformOrderToPDI",
        recipeId: "typescript",
        label: "Transform order to PDI",
      },
      {
        nodeId: "AddFuelOrder",
        recipeId: "typescript",
        label: "Add fuel order in PDI",
      },
    ]);

    const artifacts = buildRoutineArtifactsFromPlan(mapped.plan);
    expect(artifacts.ok).toBe(true);
    if (!artifacts.ok) throw new Error(artifacts.reason);

    expect(artifacts.artifacts.asl).toMatchObject({
      StartAt: "TransformOrderToPDI",
      States: {
        TransformOrderToPDI: {
          Parameters: {
            Payload: {
              language: "typescript",
              "input.$": "$",
            },
          },
          Next: "AddFuelOrder",
        },
        AddFuelOrder: {
          Parameters: {
            Payload: {
              language: "typescript",
              "input.$": "$",
            },
          },
          End: true,
        },
      },
    });
    expect(artifacts.artifacts.stepManifest).toMatchObject({
      definition: {
        metadata: {
          migration: {
            source: "n8n",
            trigger: {
              method: "POST",
              path: "pdi-fuel-order",
              deferredToUnit: "U7",
            },
            response: {
              deferredToUnit: "U7",
            },
          },
        },
      },
    });

    const validation = await validateRoutineAsl(
      { asl: artifacts.artifacts.asl },
      { sfnClient: okSfn },
    );
    expect(validation.valid).toBe(true);
  });

  it("includes the PDI SOAP credential binding required fields", () => {
    const mapped = mapN8nWorkflowToRoutinePlan(
      fixture as unknown as N8nWorkflow,
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error(mapped.reason);

    const pdiStep = mapped.plan.steps.find(
      (step) => step.nodeId === "AddFuelOrder",
    );
    expect(pdiStep?.args).toMatchObject({
      code: expect.stringContaining("output was truncated"),
      credentialBindings: [
        {
          alias: "pdi",
          credentialId: "pdi-soap",
          requiredFields: ["apiUrl", "username", "password", "partnerId"],
        },
      ],
    });
  });

  it("maps unknown custom nodes to TypeScript TODO placeholders", () => {
    const workflow: N8nWorkflow = {
      ...(fixture as unknown as N8nWorkflow),
      nodes: [
        ...(fixture as unknown as N8nWorkflow).nodes.slice(0, 1),
        {
          id: "custom-node",
          name: "Mystery Transform",
          type: "n8n-nodes-lastmile.mystery",
          parameters: { operation: "doSomethingCustom" },
        },
        ...(fixture as unknown as N8nWorkflow).nodes.slice(3),
      ],
      connections: {
        "PDI Fuel Order Webhook": {
          main: [[{ node: "Mystery Transform", type: "main", index: 0 }]],
        },
        "Mystery Transform": {
          main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
        },
        "Respond to Webhook": { main: [[]] },
      },
    };

    const mapped = mapN8nWorkflowToRoutinePlan(workflow);

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error(mapped.reason);
    expect(mapped.plan.steps[0]).toMatchObject({
      nodeId: "MysteryTransform",
      recipeId: "typescript",
      args: {
        code: expect.stringContaining("TODO: Review unsupported n8n node"),
      },
    });
    expect(mapped.plan.metadata).toMatchObject({
      migration: {
        credentialRequirements: [],
        todos: [
          {
            sourceNodeName: "Mystery Transform",
            migrationKind: "typescript_placeholder",
          },
        ],
      },
    });
  });

  it("rejects missing connection edges instead of emitting malformed ASL", () => {
    const workflow: N8nWorkflow = {
      ...(fixture as unknown as N8nWorkflow),
      connections: {
        ...(fixture as unknown as N8nWorkflow).connections,
        "Transform Order to PDI": { main: [[]] },
      },
    };

    const mapped = mapN8nWorkflowToRoutinePlan(workflow);

    expect(mapped).toEqual({
      ok: false,
      reason:
        "n8n workflow node 'Transform Order to PDI' must have exactly one main connection for this migration draft.",
    });
  });
});
