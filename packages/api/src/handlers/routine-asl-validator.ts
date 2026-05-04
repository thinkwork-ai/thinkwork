/**
 * routine-asl-validator (Plan §U5).
 *
 * Server-side ASL validator that combines AWS
 * `ValidateStateMachineDefinition` with a recipe-catalog-aware linter.
 * The chat builder agent and the publish flow call this Lambda before
 * accepting an LLM-emitted ASL document.
 *
 * Pipeline:
 *   1. AWS `ValidateStateMachineDefinition` — catches every native ASL
 *      syntax error (missing Next, malformed Choice rules, unreachable
 *      states, etc.).
 *   2. Recipe-aware linter — for each Task/Pass state:
 *        a. Map state → recipe (Comment marker preferred; ARN fallback).
 *        b. Validate Parameters payload against the recipe's argSchema
 *           via Ajv.
 *        c. Detect malformed JSONata in transform_json/set_variable
 *           result expressions.
 *        d. Verify Resource ARNs are catalog-known for Task states.
 *   3. Choice rule field-existence check — warns when a `Variable: $.foo`
 *      references a field no prior step's output schema is known to
 *      produce. Warnings, not errors, because we don't track full
 *      payload provenance in v0.
 *   4. routine_invoke cycle detection — DAG walk over the optional
 *      callGraph plus the current ASL's own routine_invoke targets.
 *
 * Returns `{ valid, errors, warnings }` where each entry carries a
 * stable `code`, the offending `stateName` when applicable, and a
 * plain-language `message` the chat builder surfaces verbatim.
 *
 * Auth: Bearer `API_AUTH_SECRET` (service endpoint pattern). Snapshots
 * env-var-derived clients at handler entry per the
 * completion-callback-snapshot-pattern feedback.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  SFNClient,
  ValidateStateMachineDefinitionCommand,
} from "@aws-sdk/client-sfn";
import Ajv2019 from "ajv/dist/2019.js";
import addFormats from "ajv-formats";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";
import {
  RECIPE_CATALOG,
  findRecipeByArn,
  getRecipe,
  knownResourceArn,
  readRecipeMarker,
  type AslState,
  type RecipeDefinition,
} from "../lib/routines/recipe-catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: string;
  message: string;
  stateName?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  stateName?: string;
}

export interface ValidateRoutineAslInput {
  asl: unknown;
  /** Current routine id — required for cycle detection. */
  currentRoutineId?: string;
  /** Tenant call graph: routineId → routineId[] of step_functions
   * routines it invokes. Built by the caller (publish flow) by scanning
   * `routine_asl_versions` for the tenant. */
  callGraph?: Record<string, string[]>;
}

export interface ValidateRoutineAslResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface AslDocument {
  Comment?: string;
  StartAt?: string;
  States?: Record<string, AslState>;
}

// ---------------------------------------------------------------------------
// Ajv (compiled once per process — argSchemas don't change at runtime)
// ---------------------------------------------------------------------------

const ajv = new Ajv2019({ strict: false, allErrors: true });
addFormats(ajv);

const _COMPILED: Map<string, ReturnType<typeof ajv.compile>> = new Map();
function compile(recipe: RecipeDefinition) {
  const cached = _COMPILED.get(recipe.id);
  if (cached) return cached;
  const compiled = ajv.compile(recipe.argSchema);
  _COMPILED.set(recipe.id, compiled);
  return compiled;
}

// Module-scoped client so warm Lambda invocations reuse the existing TCP
// pool. The optional sfnClient override in validateRoutineAsl still wins
// for unit tests.
const _DEFAULT_SFN_CLIENT = new SFNClient({});

// ---------------------------------------------------------------------------
// Pure validator entry point — exposed for unit tests and the publish flow.
// ---------------------------------------------------------------------------

export async function validateRoutineAsl(
  input: ValidateRoutineAslInput,
  options: { sfnClient?: SFNClient } = {},
): Promise<ValidateRoutineAslResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!input.asl || typeof input.asl !== "object") {
    errors.push({
      code: "asl_not_object",
      message:
        "ASL document must be a JSON object with `StartAt` and `States`.",
    });
    return { valid: false, errors, warnings };
  }

  const doc = input.asl as AslDocument;

  // ---- 0. Shape pre-flight ------------------------------------------------
  if (!doc.States || typeof doc.States !== "object") {
    errors.push({
      code: "empty_states",
      message: "ASL document is missing `States`.",
    });
    return { valid: false, errors, warnings };
  }
  const stateNames = Object.keys(doc.States);
  if (stateNames.length === 0) {
    errors.push({
      code: "empty_states",
      message:
        "ASL document has an empty `States` map; every routine needs at least one state.",
    });
    return { valid: false, errors, warnings };
  }
  if (!doc.StartAt || !doc.States[doc.StartAt]) {
    errors.push({
      code: "missing_state",
      message: `\`StartAt\` references state '${doc.StartAt ?? "(unset)"}' which is not in \`States\`.`,
    });
    return { valid: false, errors, warnings };
  }

  // ---- 1. AWS ValidateStateMachineDefinition ------------------------------
  try {
    const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;
    const cmd = new ValidateStateMachineDefinitionCommand({
      definition: JSON.stringify(doc),
      type: "STANDARD",
    });
    const resp = (await sfn.send(cmd)) as {
      result?: string;
      diagnostics?: Array<{
        severity?: string;
        code?: string;
        message?: string;
        location?: string;
      }>;
    };
    for (const diag of resp.diagnostics ?? []) {
      const stateName = diag.location?.match(/States\.([^.]+)/)?.[1];
      if (diag.severity === "ERROR") {
        errors.push({
          code: "asl_syntax",
          message: diag.message ?? "ASL syntax error",
          stateName,
        });
      } else {
        warnings.push({
          code: "asl_syntax",
          message: diag.message ?? "ASL syntax warning",
          stateName,
        });
      }
    }
  } catch (err) {
    // Treat AWS-side failures as warnings (the linter still runs). The
    // publish flow will retry; if AWS validation is genuinely broken
    // the linter is the next-best safety net.
    warnings.push({
      code: "aws_validate_unavailable",
      message: `AWS ValidateStateMachineDefinition failed: ${(err as Error).message}`,
    });
  }

  // ---- 2 + 3 + 4: walk states once, run all linters -----------------------
  for (const [name, state] of Object.entries(doc.States)) {
    const recipe = resolveRecipeForState(state);
    if (state.Type === "Task" && !recipe) {
      const arn = state.Resource ?? "";
      if (!arn) {
        errors.push({
          code: "task_missing_resource",
          message: `Task state '${name}' is missing a \`Resource\` field.`,
          stateName: name,
        });
      } else if (!knownResourceArn(arn)) {
        errors.push({
          code: "unknown_resource_arn",
          message: `Task state '${name}' uses an unrecognized Resource ARN '${arn}'. Use a v0 recipe (${RECIPE_CATALOG.map((r) => r.id).join(", ")}).`,
          stateName: name,
        });
      }
    }

    if (recipe) {
      lintRecipeArgs(name, state, recipe, errors);
      if (recipe.id === "transform_json" || recipe.id === "set_variable") {
        lintJsonataExpression(name, state, errors);
      }
    }

    if (state.Type === "Choice") {
      lintChoiceState(name, state, doc.States, warnings);
    }
  }

  // ---- 5. routine_invoke cycle detection ---------------------------------
  const routineInvokeTargets = collectRoutineInvokeTargets(doc.States);
  if (routineInvokeTargets.length > 0 && input.currentRoutineId) {
    const cycleTarget = detectCycle(
      input.currentRoutineId,
      routineInvokeTargets,
      input.callGraph ?? {},
    );
    if (cycleTarget) {
      errors.push({
        code: "routine_invoke_cycle",
        message: `Cycle detected: routine '${input.currentRoutineId}' invokes '${cycleTarget}', which (transitively) invokes '${input.currentRoutineId}'. routine_invoke must form a DAG.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Linter helpers
// ---------------------------------------------------------------------------

function resolveRecipeForState(state: AslState): RecipeDefinition | null {
  // Comment marker is the authoritative discriminator — multiple recipes
  // share `arn:aws:states:::lambda:invoke`, so the marker is the only
  // way to know which recipe emitted a given Task state.
  const marker = readRecipeMarker(state);
  if (marker) return getRecipe(marker) ?? null;
  if (state.Type === "Task" && typeof state.Resource === "string") {
    return findRecipeByArn(state.Resource);
  }
  return null;
}

function lintRecipeArgs(
  name: string,
  state: AslState,
  recipe: RecipeDefinition,
  errors: ValidationError[],
): void {
  const validate = compile(recipe);
  const params = state.Parameters as Record<string, unknown> | undefined;
  // For Task states emitted by recipes, the recipe's user args are nested
  // under Parameters.Payload. Pass states emit Parameters.result.$ etc.
  // We check whichever shape applies.
  const target = derivePayloadForArgCheck(state, recipe, params);
  if (target === undefined) return; // nothing user-authored to check

  if (!validate(target)) {
    const detail =
      validate.errors
        ?.map((e) => {
          const path = e.instancePath ? `${e.instancePath} ` : "";
          return `${path}${e.message ?? "invalid"}`;
        })
        .filter(Boolean)
        .join("; ") ?? "invalid arg shape";
    errors.push({
      code: "recipe_arg_invalid",
      message: `State '${name}' (recipe '${recipe.id}'): ${detail}`,
      stateName: name,
    });
  }

  if (recipe.id === "python" || recipe.id === "typescript") {
    lintCredentialBindings(name, target, errors);
  }
}

function derivePayloadForArgCheck(
  state: AslState,
  recipe: RecipeDefinition,
  params: Record<string, unknown> | undefined,
): unknown | undefined {
  if (!params) return undefined;
  if (state.Type === "Task") {
    // Most Task recipes embed the user-authored args in Payload (Lambda
    // invoke style); the bedrockagentcore Resource uses Payload too.
    // For HTTP/RDS-data Resources, the validator skips arg-shape checks
    // because the Parameters surface IS the recipe arg shape and the
    // emitter wires it from `args` directly — Ajv-checking the wired
    // form against the user-args schema would require a reverse mapping
    // beyond v0 scope. Allow them.
    // routine_invoke is the one Task recipe whose emitter writes args
    // directly under Parameters (not Parameters.Payload), since it goes
    // through the native states:startExecution.sync:2 integration. Handle
    // it separately so the validator actually checks the routineId/input
    // shape instead of silently passing on a stub.
    if (recipe.id === "routine_invoke") {
      return reconstructRoutineInvokeArgs(params);
    }
    if (
      recipe.id === "tool_invoke" ||
      recipe.id === "agent_invoke" ||
      recipe.id === "slack_send" ||
      recipe.id === "email_send" ||
      recipe.id === "inbox_approval" ||
      recipe.id === "python" ||
      recipe.id === "typescript"
    ) {
      const payload = params.Payload as Record<string, unknown> | undefined;
      if (!payload) return undefined;
      return reconstructArgsForTask(payload, recipe);
    }
    return undefined;
  }
  if (state.Type === "Pass") {
    // transform_json + set_variable. The recipe schema describes the
    // user-authored args (expression, name+value).
    if (recipe.id === "transform_json") {
      const exprWired = (params as Record<string, unknown>)["result.$"];
      if (typeof exprWired === "string") {
        return { expression: exprWired };
      }
      return undefined;
    }
    if (recipe.id === "set_variable") {
      // Pass states emit Result + ResultPath. Reconstruct {name, value}.
      const result = state.Result as Record<string, unknown> | undefined;
      if (result && Object.keys(result).length === 1) {
        const [name] = Object.keys(result);
        return { name, value: result[name] };
      }
      return undefined;
    }
  }
  return undefined;
}

function reconstructArgsForTask(
  payload: Record<string, unknown>,
  recipe: RecipeDefinition,
): unknown {
  // Strip the auto-injected execution-context fields so we Ajv-check only
  // the user-authored args shape. taskToken/executionId/nodeId/etc. are
  // emitter concerns, not recipe args.
  const stripped = { ...payload };
  for (const k of [
    "taskToken.$",
    "tenantId.$",
    "tenantId",
    "routineId.$",
    "routineId",
    "executionId.$",
    "executionId",
    "nodeId",
    "language",
    "input.$",
    "input",
  ]) {
    delete stripped[k];
  }
  if (recipe.id === "tool_invoke") {
    const tool = stripped.tool;
    const source = stripped.source;
    const args = stripped.args ?? {};
    if (typeof tool === "string" && typeof source === "string") {
      return { toolId: tool, toolSource: source, args };
    }
    return stripped;
  }
  if (recipe.id === "email_send") {
    const bodyPath = stripped["body.$"];
    if (typeof bodyPath === "string") {
      delete stripped["body.$"];
      return { ...stripped, bodyPath };
    }
  }
  return stripped;
}

/**
 * Reconstruct the user-authored {routineId, input} shape from the wired
 * Parameters of a routine_invoke Task state. The emitter writes
 * `StateMachineArn.$: $$.Execution.Input.routineAliasArns.<routineId>`
 * and the user-authored Input under Parameters.Input.
 *
 * Pulling the real routineId out makes the schema's UUID `pattern`
 * actually catch malformed emissions. Returns undefined when the dotted
 * path isn't recognized — Ajv then runs against `{ input }` and the
 * `required: ['routineId', 'input']` constraint fires.
 */
function reconstructRoutineInvokeArgs(
  params: Record<string, unknown>,
): unknown {
  const arnTemplate = params["StateMachineArn.$"];
  const input = (params.Input as Record<string, unknown> | undefined) ?? {};
  let routineId: string | undefined;
  if (typeof arnTemplate === "string") {
    // Expected shape: "$$.Execution.Input.routineAliasArns.<routineId>".
    // Strip the canonical prefix; whatever follows is the user's
    // routineId (or a malformed value Ajv will reject).
    const prefix = "$$.Execution.Input.routineAliasArns.";
    if (arnTemplate.startsWith(prefix)) {
      routineId = arnTemplate.slice(prefix.length);
    } else {
      // Static literal ARN — leave routineId undefined so Ajv's `required`
      // constraint fires; the publish flow shouldn't accept literal ARNs
      // anyway because cycle detection can't see them.
      routineId = undefined;
    }
  }
  return routineId === undefined ? { input } : { routineId, input };
}

function lintCredentialBindings(
  name: string,
  target: unknown,
  errors: ValidationError[],
): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) return;
  const bindings = (target as { credentialBindings?: unknown })
    .credentialBindings;
  if (!Array.isArray(bindings)) return;
  const aliases = new Set<string>();
  for (const binding of bindings) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      continue;
    }
    const alias = String((binding as { alias?: unknown }).alias ?? "");
    if (!alias) continue;
    if (aliases.has(alias)) {
      errors.push({
        code: "credential_alias_duplicate",
        message: `State '${name}': credential alias '${alias}' is declared more than once.`,
        stateName: name,
      });
    }
    aliases.add(alias);
  }
}

function lintJsonataExpression(
  name: string,
  state: AslState,
  errors: ValidationError[],
): void {
  const params = state.Parameters as Record<string, unknown> | undefined;
  const expr = params?.["result.$"];
  if (typeof expr !== "string") return;
  if (!isPlausibleJsonataOrJsonpath(expr)) {
    errors.push({
      code: "jsonata_parse_error",
      message: `State '${name}': result expression is malformed or empty.`,
      stateName: name,
    });
  }
}

/**
 * Lightweight check for whether a string looks like a JSONata expression
 * or JSONPath reference. Step Functions accepts both via the `.$` suffix
 * convention. Real JSONata parsing is deferred to the Step Functions
 * runtime; here we just guard against the obvious malformed shapes that
 * surface before the AWS validator catches them.
 */
function isPlausibleJsonataOrJsonpath(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  // JSONPath must start with $ (Step Functions convention).
  if (trimmed.startsWith("$")) return true;
  // Bare JSONata expressions can start with `(`, `[`, identifiers, or
  // string/number literals. Reject obviously broken double-brace shapes.
  if (trimmed.includes("{{") && !trimmed.includes("}}")) return false;
  // Identifier-, paren-, bracket-, or string-literal-prefixed.
  return /^[\w(\[\"'`-]/.test(trimmed);
}

function lintChoiceState(
  name: string,
  state: AslState,
  states: Record<string, AslState>,
  warnings: ValidationWarning[],
): void {
  const choices = Array.isArray(state.Choices) ? state.Choices : [];
  // Collect the set of top-level field names any other state demonstrably
  // writes — ResultPath / ResultSelector / Pass.Result keys — so the
  // Choice variable's field can be checked against actual producers.
  // This replaces a previous JSON.stringify+regex heuristic that was both
  // a ReDoS surface (fieldName interpolated into a RegExp without
  // escaping) and prone to false positives.
  const writtenFields = collectWrittenFields(states, name);

  for (const choice of choices) {
    if (typeof choice !== "object" || !choice) continue;
    const variable = (choice as { Variable?: string }).Variable;
    if (typeof variable !== "string") continue;
    if (!variable.startsWith("$")) {
      warnings.push({
        code: "choice_unresolved_field",
        message: `Choice state '${name}' references variable '${variable}' that is not a JSONPath ($.<field>) reference.`,
        stateName: name,
      });
      continue;
    }
    const fieldName = variable.replace(/^\$\.?/, "").split(".")[0];
    if (!fieldName) continue;
    // `$$.Execution.Input` references and top-level execution-input fields
    // are out-of-band producers we can't see in `states`; trust them.
    if (variable.startsWith("$$.")) continue;
    if (writtenFields.has(fieldName)) continue;
    warnings.push({
      code: "choice_unresolved_field",
      message: `Choice state '${name}': variable '${variable}' may reference an unresolved field. Confirm a prior step writes \`${fieldName}\` before this Choice.`,
      stateName: name,
    });
  }
}

/** Walk every state except `excludeName` and collect top-level field names
 * that get written via ResultPath, ResultSelector keys, or Pass.Result keys.
 * The set is conservative — it intentionally over-collects (any state's
 * writes count, even ones unreachable from the Choice) since the linter
 * here is a warning, not an error gate. */
function collectWrittenFields(
  states: Record<string, AslState>,
  excludeName: string,
): Set<string> {
  const out = new Set<string>();
  for (const [name, state] of Object.entries(states)) {
    if (name === excludeName) continue;
    if (typeof state.ResultPath === "string") {
      const field = state.ResultPath.replace(/^\$\.?/, "").split(".")[0];
      if (field) out.add(field);
    }
    if (state.ResultSelector && typeof state.ResultSelector === "object") {
      for (const key of Object.keys(
        state.ResultSelector as Record<string, unknown>,
      )) {
        // ResultSelector keys may carry a ".$" suffix (`foo.$`); strip it.
        out.add(key.replace(/\.\$$/, ""));
      }
    }
    if (state.Result && typeof state.Result === "object") {
      for (const key of Object.keys(state.Result)) out.add(key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

function collectRoutineInvokeTargets(
  states: Record<string, AslState>,
): string[] {
  const out: string[] = [];
  for (const state of Object.values(states)) {
    const recipe = resolveRecipeForState(state);
    if (recipe?.id !== "routine_invoke") continue;
    const params = state.Parameters as Record<string, unknown> | undefined;
    if (!params) continue;
    // Two emission shapes the LLM might produce — handle both so cycle
    // detection can't be sidestepped by switching from the canonical
    // template to a static ARN.
    const dotted = params["StateMachineArn.$"];
    if (typeof dotted === "string") {
      const prefix = "$$.Execution.Input.routineAliasArns.";
      const id = dotted.startsWith(prefix) ? dotted.slice(prefix.length) : null;
      if (id) out.push(id);
      continue;
    }
    const literal = params.StateMachineArn;
    if (typeof literal === "string") {
      // ThinkWork-conventional state machine name:
      //   thinkwork-<stage>-routine-<routineId>(:<version|aliasName>)?
      // Pull the routineId out of the resource segment.
      const match = literal.match(
        /:stateMachine:thinkwork-[^:-]+-routine-([^:]+)/,
      );
      if (match?.[1]) out.push(match[1]);
    }
  }
  return out;
}

/**
 * DFS from the current routine through `targets` and the supplied
 * callGraph. Returns the first target that closes a cycle back to
 * `currentRoutineId`, or null if none.
 */
function detectCycle(
  currentRoutineId: string,
  directTargets: string[],
  callGraph: Record<string, string[]>,
): string | null {
  for (const target of directTargets) {
    if (target === currentRoutineId) return target;
    const visited = new Set<string>([currentRoutineId, target]);
    const stack = [...(callGraph[target] ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === currentRoutineId) return target;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(...(callGraph[next] ?? []));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };
  }
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/routines/validate") {
    return error("Not found", 404);
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  let body: ValidateRoutineAslInput;
  try {
    body = JSON.parse(event.body || "{}") as ValidateRoutineAslInput;
  } catch {
    return error("Invalid JSON body", 400);
  }
  if (!body.asl) {
    return error("`asl` field is required", 400);
  }

  const result = await validateRoutineAsl(body);
  return json(result, 200);
}
