/**
 * routine-asl-validator tests (Plan §U5).
 *
 * Test-first: linter logic is the highest-value test target — LLM
 * emissions are the primary failure mode. Each test states a class of
 * error the validator must catch (ARN mismatch, arg-shape mismatch,
 * cycle, malformed Choice) so we don't accept a "passes-all-greens"
 * implementation that quietly skips a check.
 *
 * The AWS `ValidateStateMachineDefinition` round-trip is mocked at the
 * SfnClient boundary so tests stay hermetic. The recipe-aware linter
 * runs against the real catalog.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSfnSend } = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  ValidateStateMachineDefinitionCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { validateRoutineAsl } from "./routine-asl-validator.js";

beforeEach(() => {
  mockSfnSend.mockReset();
  // Default: AWS validator returns OK so unit tests focus on the
  // recipe-aware linter unless explicitly overridden.
  mockSfnSend.mockResolvedValue({ result: "OK", diagnostics: [] });
});

const aslWith = (states: Record<string, unknown>, startAt = Object.keys(states)[0]) =>
  ({
    Comment: "test routine",
    StartAt: startAt,
    States: states,
  }) as unknown;

describe("validateRoutineAsl — happy path", () => {
  it("accepts a single Pass state with End:true (smallest legal routine)", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith({
        OnlyState: { Type: "Pass", End: true },
      }),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a recipe-marked Task state with valid Resource and Parameters", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith({
        SearchSlack: {
          Type: "Task",
          Resource: "arn:aws:states:::lambda:invoke",
          Comment: "recipe:tool_invoke",
          Parameters: {
            "FunctionName.$": "$$.Execution.Input.adminOpsMcpFunctionName",
            Payload: {
              tool: "search_messages",
              source: "mcp",
              args: { query: "deploy failure" },
            },
          },
          End: true,
        },
      }),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateRoutineAsl — error paths", () => {
  it("covers AE3: invalid Resource ARN returns actionable error with the offending state name", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith({
        FetchData: {
          Type: "Task",
          Resource: "arn:aws:states:::aws-sdk:s3:getObject",
          End: true,
        },
      }),
    });
    expect(result.valid).toBe(false);
    const arnError = result.errors.find((e) => e.code === "unknown_resource_arn");
    expect(arnError).toBeDefined();
    expect(arnError?.stateName).toBe("FetchData");
    // Actionable: human-readable message naming the state and the bad ARN.
    expect(arnError?.message).toContain("FetchData");
    expect(arnError?.message).toContain("aws-sdk:s3:getObject");
  });

  it("returns valid:false for empty States map", async () => {
    const result = await validateRoutineAsl({
      asl: { Comment: "empty", StartAt: "MissingState", States: {} } as unknown,
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "empty_states" || e.code === "missing_state",
      ),
    ).toBe(true);
  });

  it("returns Ajv arg-type error when python step has non-string code", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith({
        RunReport: {
          Type: "Task",
          Resource: "arn:aws:states:::lambda:invoke",
          Comment: "recipe:python",
          Parameters: {
            "FunctionName.$": "$$.Execution.Input.routineTaskPythonFunctionName",
            Payload: {
              executionId: "x",
              nodeId: "RunReport",
              code: 12345 as unknown as string,
            },
          },
          End: true,
        },
      }),
    });
    expect(result.valid).toBe(false);
    const argError = result.errors.find(
      (e) => e.code === "recipe_arg_invalid" && e.stateName === "RunReport",
    );
    expect(argError).toBeDefined();
    expect(argError?.message.toLowerCase()).toContain("code");
  });

  it("returns parse error when JSONata expression is malformed", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith({
        Reshape: {
          Type: "Pass",
          Comment: "recipe:transform_json",
          Parameters: {
            "result.$": "{{ this is not jsonata",
          },
          End: true,
        },
      }),
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.code === "jsonata_parse_error" ||
          e.code === "recipe_arg_invalid" ||
          e.code === "invalid_path_expression",
      ),
    ).toBe(true);
  });

  it("returns warning when Choice references an unresolved field", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith(
        {
          Decide: {
            Type: "Choice",
            Choices: [
              {
                Variable: "$.invented_field_never_set",
                StringEquals: "yes",
                Next: "Done",
              },
            ],
            Default: "Done",
          },
          Done: { Type: "Succeed" },
        },
        "Decide",
      ),
    });
    // Field-existence checks are warnings; valid is allowed if no
    // hard errors emerged.
    const fieldWarn = result.warnings.find(
      (w) => w.code === "choice_unresolved_field",
    );
    expect(fieldWarn).toBeDefined();
    expect(fieldWarn?.stateName).toBe("Decide");
  });

  it("covers AE5: routine_invoke cycle A→B→A is detected at publish time", async () => {
    // Routine A invokes routine B. The supplied callGraph indicates B
    // already invokes A — so publishing A would close the cycle.
    const aslA = aslWith({
      InvokeB: {
        Type: "Task",
        Resource: "arn:aws:states:::states:startExecution.sync:2",
        Comment: "recipe:routine_invoke",
        Parameters: {
          "StateMachineArn.$":
            "$$.Execution.Input.routineAliasArns.routine-b",
          Input: {},
        },
        End: true,
      },
    });
    const result = await validateRoutineAsl({
      asl: aslA,
      currentRoutineId: "routine-a",
      callGraph: { "routine-b": ["routine-a"] },
    });
    expect(result.valid).toBe(false);
    const cycle = result.errors.find((e) => e.code === "routine_invoke_cycle");
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain("routine-a");
    expect(cycle?.message).toContain("routine-b");
  });

  it("propagates errors from AWS ValidateStateMachineDefinition", async () => {
    mockSfnSend.mockResolvedValueOnce({
      result: "FAIL",
      diagnostics: [
        { severity: "ERROR", code: "INVALID_NEXT", message: "Next state X not found", location: "States.A.Next" },
      ],
    });
    const result = await validateRoutineAsl({
      asl: aslWith({
        A: { Type: "Pass", Next: "X" },
      }),
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.code === "asl_syntax" && e.message.includes("Next state X not found"),
      ),
    ).toBe(true);
  });
});

describe("validateRoutineAsl — direct self-invocation cycle", () => {
  it("detects routine_invoke targeting the current routine itself", async () => {
    const result = await validateRoutineAsl({
      asl: aslWith({
        InvokeSelf: {
          Type: "Task",
          Resource: "arn:aws:states:::states:startExecution.sync:2",
          Comment: "recipe:routine_invoke",
          Parameters: {
            "StateMachineArn.$":
              "$$.Execution.Input.routineAliasArns.routine-a",
            Input: {},
          },
          End: true,
        },
      }),
      currentRoutineId: "routine-a",
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "routine_invoke_cycle"),
    ).toBe(true);
  });
});
