/**
 * Tests for the v0 routines recipe catalog (Plan §U4).
 *
 * Catalog correctness is the highest-value invariant in Phase A: the chat
 * builder, the validator, and the runtime all consume this contract. Each
 * test states the property the catalog must hold rather than asserting on
 * specific recipe ids — so adding or renaming a recipe surfaces in the
 * Plan/PR review, not silently as a passing test.
 */

import { describe, expect, it } from "vitest";
import Ajv2019 from "ajv/dist/2019.js";
import addFormats from "ajv-formats";
import {
  RECIPE_CATALOG,
  RESOURCE_ARN_PATTERNS,
  findRecipeByArn,
  getRecipe,
  getRecipeConfigFields,
  knownResourceArn,
  listRecipes,
  readRecipeMarker,
  type AslState,
  type RecipeDefinition,
} from "./recipe-catalog.js";

const ajv = new Ajv2019({ strict: false, allErrors: true });
addFormats(ajv);

const ASL_TASK_KINDS = new Set([
  "Task",
  "Pass",
  "Choice",
  "Wait",
  "Succeed",
  "Fail",
  "Parallel",
  "Map",
]);

describe("recipe-catalog", () => {
  it("exports exactly 12 recipes", () => {
    expect(RECIPE_CATALOG.length).toBe(12);
    expect(listRecipes().length).toBe(12);
  });

  it("uses unique recipe ids", () => {
    const ids = RECIPE_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the locked v0 recipe set named in origin R6", () => {
    const required = [
      "agent_invoke",
      "tool_invoke",
      "routine_invoke",
      "http_request",
      "aurora_query",
      "transform_json",
      "set_variable",
      "slack_send",
      "email_send",
      "inbox_approval",
      "python",
    ];
    for (const id of required) {
      expect(getRecipe(id), `missing v0 recipe: ${id}`).toBeDefined();
    }
  });

  it("flags only HITL recipes as hitlCapable", () => {
    const hitl = RECIPE_CATALOG.filter((r) => r.hitlCapable).map((r) => r.id);
    expect(hitl).toEqual(["inbox_approval"]);
  });

  it.each(RECIPE_CATALOG)(
    "recipe '$id' has a valid JSON Schema for argSchema",
    (recipe: RecipeDefinition) => {
      // ajv.compile throws if the schema is malformed.
      expect(() => ajv.compile(recipe.argSchema)).not.toThrow();
    },
  );

  it.each(RECIPE_CATALOG)(
    "recipe '$id' aslEmitter returns a recognizable ASL state shape",
    (recipe: RecipeDefinition) => {
      // Build a minimal valid args payload by stubbing required props.
      const args = stubRequiredArgs(recipe);
      const state = recipe.aslEmitter(args, {
        stateName: "TestState",
        next: "NextState",
        end: false,
      });

      expect(typeof state.Type).toBe("string");
      expect(ASL_TASK_KINDS.has(state.Type)).toBe(true);

      // Sequencing was applied: Next is set when end:false.
      expect(state.Next).toBe("NextState");
      expect(state.End).toBeUndefined();

      // Recipe marker round-trips so the validator can reverse-map.
      expect(readRecipeMarker(state)).toBe(recipe.id);

      // Task states must carry a Resource matching the recipe's ARN
      // pattern. Pass/Wait states are exempt.
      if (state.Type === "Task") {
        expect(typeof state.Resource).toBe("string");
        if (recipe.resourceArnPattern) {
          expect(recipe.resourceArnPattern.test(state.Resource as string)).toBe(
            true,
          );
        }
      }
    },
  );

  it("emits End:true when ctx.end is true and omits Next", () => {
    const recipe = getRecipe("set_variable")!;
    const state = recipe.aslEmitter(
      { name: "tenant", value: "alpha" },
      { stateName: "S1", next: null, end: true },
    );
    expect(state.End).toBe(true);
    expect(state.Next).toBeUndefined();
  });

  it("findRecipeByArn returns the recipe for a known ARN", () => {
    expect(findRecipeByArn("arn:aws:states:::http:invoke")?.id).toBe(
      "http_request",
    );
    expect(
      findRecipeByArn("arn:aws:states:::aws-sdk:rdsdata:executeStatement")?.id,
    ).toBe("aurora_query");
    expect(findRecipeByArn("arn:aws:states:::nope")).toBeNull();
  });

  it("knownResourceArn flags catalog-known ARNs", () => {
    expect(knownResourceArn("arn:aws:states:::http:invoke")).toBe(true);
    expect(
      knownResourceArn("arn:aws:states:::states:startExecution.sync:2"),
    ).toBe(true);
    expect(knownResourceArn("arn:aws:states:::aws-sdk:s3:getObject")).toBe(
      false,
    );
  });

  it("RESOURCE_ARN_PATTERNS exposes a deterministic, frozen-ish surface", () => {
    // Object.freeze(...) makes this read-only at runtime; spot-check the
    // expected keys remain stable for the validator.
    const expectedKeys = [
      "agentInvoke",
      "toolInvoke",
      "routineInvoke",
      "python",
      "inboxApproval",
      "httpRequest",
      "auroraQuery",
      "slackSend",
      "emailSend",
    ];
    for (const k of expectedKeys) {
      expect(RESOURCE_ARN_PATTERNS).toHaveProperty(k);
    }
  });

  it("argSchema rejects an obvious shape violation (regression: tool_invoke)", () => {
    // Sanity check: the argSchema must actually fail when required fields
    // are missing. Ensures we wired Ajv correctly and our schemas aren't
    // permissive accidents.
    const recipe = getRecipe("tool_invoke")!;
    const validate = ajv.compile(recipe.argSchema);
    expect(validate({ toolId: "x" })).toBe(false);
    expect(validate({ toolId: "x", toolSource: "mcp", args: {} })).toBe(true);
  });

  it("argSchema for python rejects empty code (escape-hatch invariant)", () => {
    const recipe = getRecipe("python")!;
    const validate = ajv.compile(recipe.argSchema);
    expect(validate({ code: "" })).toBe(false);
    expect(validate({ code: "print('ok')" })).toBe(true);
  });

  it("email_send accepts either a literal body or a dynamic bodyPath", () => {
    const recipe = getRecipe("email_send")!;
    const validate = ajv.compile(recipe.argSchema);
    expect(
      validate({
        to: ["ericodom37@gmail.com"],
        subject: "Austin weather update",
        body: "Current weather...",
      }),
    ).toBe(true);
    expect(
      validate({
        to: ["ericodom37@gmail.com"],
        subject: "Austin weather update",
        bodyPath: "$.FetchAustinWeather.stdoutPreview",
      }),
    ).toBe(true);
    expect(
      validate({
        to: ["ericodom37@gmail.com"],
        subject: "Austin weather update",
      }),
    ).toBe(false);
  });

  it("exposes editor config from recipe metadata without surfacing internal args", () => {
    const fields = getRecipeConfigFields("email_send", {
      to: ["ericodom37@gmail.com"],
      subject: "Austin weather update",
      bodyPath: "$.FetchAustinWeather.stdoutPreview",
      bodyFormat: "markdown",
    });

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "to",
          label: "To",
          value: ["ericodom37@gmail.com"],
          inputType: "email_array",
          required: true,
          editable: true,
        }),
        expect.objectContaining({
          key: "subject",
          value: "Austin weather update",
          inputType: "text",
          required: true,
          editable: true,
        }),
        expect.objectContaining({
          key: "body",
          value: null,
          inputType: "text",
          editable: true,
        }),
        expect.objectContaining({
          key: "bodyFormat",
          value: "markdown",
          inputType: "select",
          options: ["text", "html", "markdown"],
          editable: true,
        }),
        expect.objectContaining({
          key: "bodyPath",
          value: "$.FetchAustinWeather.stdoutPreview",
          editable: false,
        }),
      ]),
    );
    expect(fields.map((field) => field.key)).not.toContain("cc");
  });

  it("email_send and python payloads include server-owned routine identity", () => {
    const email = getRecipe("email_send")!.aslEmitter(
      {
        to: ["ericodom37@gmail.com"],
        subject: "Austin weather update",
        bodyPath: "$.FetchAustinWeather.stdoutPreview",
      },
      { stateName: "EmailAustinWeather", next: null, end: true },
    );
    expect((email.Parameters as any).Payload).toMatchObject({
      "tenantId.$": "$$.Execution.Input.tenantId",
      "routineId.$": "$$.Execution.Input.routineId",
      "executionId.$": "$$.Execution.Id",
    });

    const python = getRecipe("python")!.aslEmitter(
      { code: "print('ok')" },
      { stateName: "FetchAustinWeather", next: null, end: true },
    );
    expect((python.Parameters as any).Payload).toMatchObject({
      "tenantId.$": "$$.Execution.Input.tenantId",
      "routineId.$": "$$.Execution.Input.routineId",
      "executionId.$": "$$.Execution.Id",
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal args object that satisfies the recipe's argSchema. Used
 * by the parametric ASL-shape test so we don't have to hand-write a fixture
 * for each recipe.
 */
function stubRequiredArgs(recipe: RecipeDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const schema = recipe.argSchema;
  if (typeof schema !== "object" || schema === null) return out;

  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  for (const name of required) {
    out[name] = stubForSchema(properties[name] ?? {});
  }
  return out;
}

function stubForSchema(schema: Record<string, unknown>): unknown {
  const t = schema.type;
  if (t === "string") {
    if (
      typeof schema.pattern === "string" &&
      /\[0-9a-fA-F\]\{8\}-/.test(schema.pattern)
    ) {
      return "00000000-0000-4000-8000-000000000001";
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum[0];
    }
    return "stub-value";
  }
  if (t === "integer" || t === "number") {
    if (typeof schema.minimum === "number") return schema.minimum;
    return 1;
  }
  if (t === "boolean") return true;
  if (t === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return items ? [stubForSchema(items)] : [];
  }
  if (t === "object") return {};
  return "stub";
}
