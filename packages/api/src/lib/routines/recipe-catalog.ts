/**
 * Routines v0 Recipe Catalog (Plan 2026-05-01-004 §U4).
 *
 * Locked v0 recipe set per origin R6 / R9: ThinkWork-eng-owned, defined in
 * repo. The chat builder agent + the `tool_invoke` recipe consume this
 * catalog at composition time; the `routine-asl-validator` Lambda (U5)
 * consumes it at publish time to type-check LLM-emitted ASL Parameters.
 *
 * **Why a TS module, not a DB table.** Recipes are first-class code with
 * arg shapes, ASL emitters, and resource ARNs. Customers compose, they do
 * not author. Adding/removing a recipe is an engineering change reviewed
 * via PR — not a tenant-config knob. Storing them in code keeps validation,
 * codegen, and dependency-graph tooling honest.
 *
 * **Each recipe carries:**
 *   - `id` — stable string used as the lookup key in ASL state Comment fields
 *   - `argSchema` — JSON Schema (draft 2019-09) the validator type-checks
 *     LLM-emitted Parameters against
 *   - `aslEmitter` — pure function that returns the ASL state JSON for a
 *     given args + sequencing context. Uses JSONata for input/output queries
 *     per the JSONata-over-JSONPath decision in the master plan.
 *   - `resourceArnPattern` — null for Pass states, a regex for Task states
 *     so the validator can reverse-map ARN → recipe id.
 */

/**
 * Loose JSON Schema type. Recipe argSchemas are JSON Schema (draft 2019-09)
 * fragments — keeping the type as a structural object lets us avoid pulling
 * the full JSON-Schema TypeScript types in for the catalog and validator.
 * The validator uses Ajv at runtime to enforce conformance; this type is
 * only for compile-time shape hints.
 */
export type JsonSchema7Type = {
  type?: string | string[];
  properties?: Record<string, JsonSchema7Type>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema7Type;
  items?: JsonSchema7Type | JsonSchema7Type[];
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  nullable?: boolean;
  [key: string]: unknown;
};

export type RecipeCategory =
  | "control_flow"
  | "invocation"
  | "io"
  | "notification"
  | "hitl"
  | "escape_hatch";

/**
 * Sequencing context the chat builder passes to the emitter so the emitter
 * doesn't have to invent state names or worry about the Next/End fork.
 */
export interface AslEmitContext {
  /** ASL state name to emit (e.g. "SendApprovalEmail"). */
  stateName: string;
  /** Next state name, or null if this is a terminal state. */
  next: string | null;
  /** True iff this is the terminal state of the routine. */
  end: boolean;
  /** Optional ResultPath override. Default: "$.<stateName>". */
  resultPath?: string;
}

/** Subset of the ASL state shape recipes care about. Keep loose on purpose
 * — the validator handles full ASL conformance via ValidateStateMachineDefinition. */
export interface AslState {
  Type: string;
  Resource?: string;
  Parameters?: Record<string, unknown>;
  ResultPath?: string;
  ResultSelector?: unknown;
  Next?: string;
  End?: boolean;
  Catch?: unknown;
  Retry?: unknown;
  Comment?: string;
  // Choice-state fields
  Choices?: unknown;
  Default?: string;
  // Wait-state fields
  Seconds?: number;
  Timestamp?: string;
  // Pass-state fields
  Result?: Record<string, unknown>;
  // Task-state timeout fields (Step Functions accepts these on any Task,
  // including .waitForTaskToken — they bound the SDK-side wait, separate
  // from any application-level timeout the recipe encodes in its payload).
  TimeoutSeconds?: number;
  HeartbeatSeconds?: number;
}

export type AslEmitter = (
  args: Record<string, unknown>,
  ctx: AslEmitContext,
) => AslState;

export type RecipeConfigInputType =
  | "text"
  | "email_array"
  | "select"
  | "string_array"
  | "number";

export type RecipeConfigControl =
  | "text"
  | "textarea"
  | "code"
  | "select"
  | "number"
  | "email_list"
  | "string_list";

export interface RecipeConfigFieldDefinition {
  key: string;
  label: string;
  inputType: RecipeConfigInputType;
  control?: RecipeConfigControl;
  required?: boolean;
  editable?: boolean;
  options?: readonly string[];
  placeholder?: string;
  helpText?: string;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface RecipeConfigField {
  key: string;
  label: string;
  value: unknown | null;
  inputType: RecipeConfigInputType;
  control: RecipeConfigControl | null;
  required: boolean;
  editable: boolean;
  options: readonly string[] | null;
  placeholder: string | null;
  helpText: string | null;
  min: number | null;
  max: number | null;
  pattern: string | null;
}

export interface RecipeDefinition {
  /** Stable lookup key. Embedded in the emitted state's `Comment` so the
   * validator can reverse-map state → recipe. */
  id: string;
  /** Human-readable label surfaced in the chat builder. */
  displayName: string;
  description: string;
  category: RecipeCategory;
  /** True iff this recipe pauses execution waiting on an Inbox decision. */
  hitlCapable: boolean;
  /**
   * JSON Schema (draft 2019-09) describing the args object. The validator
   * Ajv-checks LLM emissions against this.
   */
  argSchema: JsonSchema7Type;
  /**
   * Product-owned fields safe to surface in routine editors. This metadata
   * is the source of truth for config UI; args omitted here are internal
   * implementation details even when present in argSchema.
   */
  configFields?: readonly RecipeConfigFieldDefinition[];
  /**
   * Pure function returning the ASL state for the given args + context.
   * The emitter is responsible for embedding `recipe:<id>` in the state's
   * `Comment` field — see `markRecipe` helper below.
   */
  aslEmitter: AslEmitter;
  /**
   * Regex matching `Resource` ARNs this recipe emits. Null for Pass states
   * (transform_json, set_variable, choice, wait). The validator uses this
   * to reverse-map ARN → recipe for Resource-bearing states; for Pass
   * states it falls back to the `Comment` marker.
   */
  resourceArnPattern: RegExp | null;
}

const COMMENT_PREFIX = "recipe:";

/**
 * Stamp a recipe id into the state's Comment field so the validator can
 * reverse-map. We also preserve any human-authored prefix (e.g.
 * `"recipe:python · run nightly batch"`).
 */
function markRecipe(state: AslState, recipeId: string): AslState {
  const existing = state.Comment ?? "";
  const stripped = existing.startsWith(COMMENT_PREFIX)
    ? existing.slice(COMMENT_PREFIX.length).split(" · ").slice(1).join(" · ")
    : existing;
  state.Comment = stripped
    ? `${COMMENT_PREFIX}${recipeId} · ${stripped}`
    : `${COMMENT_PREFIX}${recipeId}`;
  return state;
}

/** Extract the recipe id from a state Comment, or null if unmarked. */
export function readRecipeMarker(state: AslState): string | null {
  const c = state.Comment ?? "";
  if (!c.startsWith(COMMENT_PREFIX)) return null;
  const after = c.slice(COMMENT_PREFIX.length);
  const id = after.split(" · ")[0]?.trim();
  return id || null;
}

function applySequencing(state: AslState, ctx: AslEmitContext): AslState {
  if (ctx.end) {
    state.End = true;
    delete state.Next;
  } else if (ctx.next) {
    state.Next = ctx.next;
    delete state.End;
  }
  if (ctx.resultPath) state.ResultPath = ctx.resultPath;
  return state;
}

// ---------------------------------------------------------------------------
// Catalog entries
// ---------------------------------------------------------------------------

/** ARN regex constants — exported for the validator's ARN catalog match. */
export const RESOURCE_ARN_PATTERNS = Object.freeze({
  // bedrockagentcore InvokeAgentRuntime — sync invocation; arg-shape is the
  // Strands input payload.
  agentInvoke: /^arn:aws:states:::aws-sdk:bedrockagentcore:invokeAgentRuntime$/,
  // admin-ops-mcp Lambda invoke — wraps `tool_invoke`. Region/account vary,
  // function name is fixed by Terraform.
  toolInvoke: /^arn:aws:states:::lambda:invoke$/,
  // routine_invoke uses native sfn:startExecution.sync:2.
  routineInvoke: /^arn:aws:states:::states:startExecution\.sync:2$/,
  // python() — thin Lambda wrapping InvokeCodeInterpreter.
  python: /^arn:aws:states:::lambda:invoke$/,
  // inbox_approval — .waitForTaskToken on a Lambda that creates the
  // inbox row and stores the task token.
  inboxApproval: /^arn:aws:states:::lambda:invoke\.waitForTaskToken$/,
  // http_request — native HTTPS task.
  httpRequest: /^arn:aws:states:::http:invoke$/,
  // aurora_query — native rds-data executeStatement.
  auroraQuery: /^arn:aws:states:::aws-sdk:rdsdata:executeStatement$/,
  // notification recipes — both wrap a per-stage notification Lambda. The
  // validator only checks the prefix; the suffix is stage-injected.
  slackSend: /^arn:aws:states:::lambda:invoke$/,
  emailSend: /^arn:aws:states:::lambda:invoke$/,
});

const STR = { type: "string" } as const;
const STR_NONEMPTY = { type: "string", minLength: 1 } as const;
const UUID = {
  type: "string",
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
} as const;

/**
 * Catalog (12 recipes). Listed in category order so chat-builder UI render
 * stays predictable. Order is **not** load-bearing — lookups go through
 * `getRecipe(id)`.
 */
const _CATALOG: RecipeDefinition[] = [
  // --- Control flow -------------------------------------------------------
  {
    id: "wait",
    displayName: "Wait",
    description:
      "Pause execution for a fixed duration before continuing. Wraps the native ASL Wait state for argument-shape consistency.",
    category: "control_flow",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        seconds: { type: "integer", minimum: 1, maximum: 31_536_000 },
      },
      required: ["seconds"],
    },
    configFields: [
      {
        key: "seconds",
        label: "Seconds",
        inputType: "number",
        control: "number",
        required: true,
        editable: true,
        min: 1,
        max: 31_536_000,
      },
    ],
    resourceArnPattern: null,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Wait",
            Seconds: Number(args.seconds),
          },
          ctx,
        ),
        "wait",
      ),
  },

  // --- Invocation ---------------------------------------------------------
  {
    id: "agent_invoke",
    displayName: "Invoke agent",
    description:
      "Call a tenant agent synchronously via Bedrock AgentCore InvokeAgentRuntime. Returns the agent's structured output.",
    category: "invocation",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: UUID,
        input: { type: "object" },
        sessionId: { ...STR, nullable: true },
      },
      required: ["agentId", "input"],
    },
    configFields: [
      {
        key: "agentId",
        label: "Agent ID",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
        placeholder: "agent runtime id",
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.agentInvoke,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource:
              "arn:aws:states:::aws-sdk:bedrockagentcore:invokeAgentRuntime",
            Parameters: {
              "AgentRuntimeArn.$": "$$.Execution.Input.tenantAgentRuntimeArn",
              Qualifier: "DEFAULT",
              Payload: args.input ?? { _: "$" },
            },
          },
          ctx,
        ),
        "agent_invoke",
      ),
  },
  {
    id: "tool_invoke",
    displayName: "Invoke tool",
    description:
      "Call a tenant tool (MCP, builtin, or skill) via the admin-ops-mcp Lambda. Inventory comes from the tenantToolInventory query.",
    category: "invocation",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        toolId: STR_NONEMPTY,
        toolSource: { type: "string", enum: ["mcp", "builtin", "skill"] },
        args: { type: "object" },
      },
      required: ["toolId", "toolSource", "args"],
    },
    configFields: [
      {
        key: "toolId",
        label: "Tool ID",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
      {
        key: "toolSource",
        label: "Tool source",
        inputType: "select",
        control: "select",
        required: true,
        editable: true,
        options: ["mcp", "builtin", "skill"],
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.toolInvoke,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::lambda:invoke",
            Parameters: {
              "FunctionName.$": "$$.Execution.Input.adminOpsMcpFunctionName",
              Payload: {
                tool: args.toolId,
                source: args.toolSource,
                args: args.args ?? {},
              },
            },
            ResultSelector: { "result.$": "$.Payload.result" },
          },
          ctx,
        ),
        "tool_invoke",
      ),
  },
  {
    id: "routine_invoke",
    displayName: "Invoke routine",
    description:
      "Run another routine in the same tenant synchronously and capture its output. Cycles are rejected at publish time.",
    category: "invocation",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        routineId: UUID,
        input: { type: "object" },
      },
      required: ["routineId", "input"],
    },
    configFields: [
      {
        key: "routineId",
        label: "Routine ID",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.routineInvoke,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::states:startExecution.sync:2",
            Parameters: {
              "StateMachineArn.$": `$$.Execution.Input.routineAliasArns.${String(args.routineId)}`,
              Input: args.input ?? {},
            },
            ResultSelector: { "output.$": "$.Output" },
          },
          ctx,
        ),
        "routine_invoke",
      ),
  },

  // --- IO -----------------------------------------------------------------
  {
    id: "http_request",
    displayName: "HTTP request",
    description:
      "Make an outbound HTTPS request via the native Step Functions HTTP task. Use for tenant-public endpoints; tenant-private connectors should go through tool_invoke.",
    category: "io",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        apiEndpoint: STR_NONEMPTY,
        headers: { type: "object" },
        queryParameters: { type: "object" },
        requestBody: {},
        connectionArn: STR_NONEMPTY,
      },
      required: ["method", "apiEndpoint", "connectionArn"],
    },
    configFields: [
      {
        key: "method",
        label: "Method",
        inputType: "select",
        control: "select",
        required: true,
        editable: true,
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      },
      {
        key: "apiEndpoint",
        label: "API endpoint",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
        placeholder: "https://api.example.com/path",
      },
      {
        key: "connectionArn",
        label: "Connection ARN",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.httpRequest,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::http:invoke",
            Parameters: {
              ApiEndpoint: args.apiEndpoint,
              Method: args.method,
              Authentication: { ConnectionArn: args.connectionArn },
              ...(args.headers ? { Headers: args.headers } : {}),
              ...(args.queryParameters
                ? { QueryParameters: args.queryParameters }
                : {}),
              ...(args.requestBody !== undefined
                ? { RequestBody: args.requestBody }
                : {}),
            },
          },
          ctx,
        ),
        "http_request",
      ),
  },
  {
    id: "aurora_query",
    displayName: "Aurora SQL query",
    description:
      "Execute a parameterized SQL statement against the tenant's Aurora cluster via rds-data. Use for read-mostly reporting; write paths should go through tool_invoke or python().",
    category: "io",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sql: STR_NONEMPTY,
        parameters: { type: "array" },
        databaseName: STR_NONEMPTY,
      },
      required: ["sql", "databaseName"],
    },
    configFields: [
      {
        key: "sql",
        label: "SQL",
        inputType: "text",
        control: "code",
        required: true,
        editable: true,
      },
      {
        key: "databaseName",
        label: "Database",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.auroraQuery,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::aws-sdk:rdsdata:executeStatement",
            Parameters: {
              "ResourceArn.$": "$$.Execution.Input.auroraClusterArn",
              "SecretArn.$": "$$.Execution.Input.auroraSecretArn",
              Database: args.databaseName,
              Sql: args.sql,
              ...(Array.isArray(args.parameters)
                ? { Parameters: args.parameters }
                : {}),
            },
          },
          ctx,
        ),
        "aurora_query",
      ),
  },
  {
    id: "transform_json",
    displayName: "Transform JSON",
    description:
      "Reshape the current state payload using a JSONata expression. Pure transform; no side effects.",
    category: "io",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        expression: STR_NONEMPTY,
      },
      required: ["expression"],
    },
    configFields: [
      {
        key: "expression",
        label: "Expression",
        inputType: "text",
        control: "code",
        required: true,
        editable: true,
        helpText: "JSONata expression evaluated against the current state.",
      },
    ],
    resourceArnPattern: null,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Pass",
            Parameters: {
              "result.$": String(args.expression),
            },
          },
          ctx,
        ),
        "transform_json",
      ),
  },
  {
    id: "set_variable",
    displayName: "Set variable",
    description:
      "Assign a constant value into the state payload at a named key. Useful for seeding defaults or pinning routing flags.",
    category: "io",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$" },
        value: {},
      },
      required: ["name", "value"],
    },
    configFields: [
      {
        key: "name",
        label: "Name",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
        pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$",
      },
      {
        key: "value",
        label: "Value",
        inputType: "text",
        control: "textarea",
        required: true,
        editable: true,
      },
    ],
    resourceArnPattern: null,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Pass",
            Result: { [String(args.name)]: args.value },
            ResultPath: `$.${String(args.name)}`,
          },
          { ...ctx, resultPath: ctx.resultPath ?? `$.${String(args.name)}` },
        ),
        "set_variable",
      ),
  },

  // --- Notification -------------------------------------------------------
  {
    id: "slack_send",
    displayName: "Send Slack message",
    description:
      "Post a message to a tenant Slack channel via the slack-send Lambda.",
    category: "notification",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        channelId: STR_NONEMPTY,
        text: STR_NONEMPTY,
        blocks: { type: "array" },
      },
      required: ["channelId", "text"],
    },
    configFields: [
      {
        key: "channelId",
        label: "Channel ID",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
      {
        key: "text",
        label: "Message",
        inputType: "text",
        control: "textarea",
        required: true,
        editable: true,
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.slackSend,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::lambda:invoke",
            Parameters: {
              "FunctionName.$": "$$.Execution.Input.slackSendFunctionName",
              Payload: {
                channelId: args.channelId,
                text: args.text,
                ...(Array.isArray(args.blocks) ? { blocks: args.blocks } : {}),
              },
            },
            ResultSelector: { "messageTs.$": "$.Payload.messageTs" },
          },
          ctx,
        ),
        "slack_send",
      ),
  },
  {
    id: "email_send",
    displayName: "Send email",
    description:
      "Send an email via the email-send Lambda. Honors the tenant's verified-domain list.",
    category: "notification",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        to: { type: "array", items: STR_NONEMPTY, minItems: 1 },
        subject: STR_NONEMPTY,
        body: STR_NONEMPTY,
        bodyPath: STR_NONEMPTY,
        bodyFormat: { type: "string", enum: ["text", "html", "markdown"] },
        cc: { type: "array", items: STR_NONEMPTY },
      },
      required: ["to", "subject"],
      anyOf: [{ required: ["body"] }, { required: ["bodyPath"] }],
    },
    configFields: [
      {
        key: "to",
        label: "To",
        inputType: "email_array",
        control: "email_list",
        required: true,
        editable: true,
        placeholder: "name@example.com",
        helpText: "One recipient per line or comma-separated.",
      },
      {
        key: "subject",
        label: "Subject",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
      {
        key: "body",
        label: "Body",
        inputType: "text",
        control: "textarea",
        editable: true,
      },
      {
        key: "bodyFormat",
        label: "Body format",
        inputType: "select",
        control: "select",
        options: ["text", "html", "markdown"],
        editable: true,
      },
      {
        key: "bodyPath",
        label: "Body source",
        inputType: "text",
        control: "text",
        editable: false,
        helpText: "JSONPath source from an earlier step.",
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.emailSend,
    aslEmitter: (args, ctx) => {
      const payload: Record<string, unknown> = {
        "tenantId.$": "$$.Execution.Input.tenantId",
        "routineId.$": "$$.Execution.Input.routineId",
        "executionId.$": "$$.Execution.Id",
        to: args.to,
        subject: args.subject,
        bodyFormat: args.bodyFormat ?? "markdown",
        ...(Array.isArray(args.cc) ? { cc: args.cc } : {}),
      };
      if (typeof args.bodyPath === "string" && args.bodyPath.trim()) {
        payload["body.$"] = args.bodyPath;
      } else {
        payload.body = args.body;
      }
      return markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::lambda:invoke",
            Parameters: {
              "FunctionName.$": "$$.Execution.Input.emailSendFunctionName",
              Payload: payload,
            },
            ResultSelector: { "messageId.$": "$.Payload.messageId" },
          },
          ctx,
        ),
        "email_send",
      );
    },
  },

  // --- HITL ---------------------------------------------------------------
  {
    id: "inbox_approval",
    displayName: "Wait for inbox approval",
    description:
      "Pause execution and create an Inbox item with markdown context. Resumes when an operator submits a decision; the routine receives the decision payload as state input.",
    category: "hitl",
    hitlCapable: true,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: STR_NONEMPTY,
        markdownContext: STR_NONEMPTY,
        decisionSchema: { type: "object" },
        timeoutSeconds: { type: "integer", minimum: 60 },
        assigneeUserId: { ...UUID, nullable: true },
      },
      required: ["title", "markdownContext", "decisionSchema"],
    },
    configFields: [
      {
        key: "title",
        label: "Title",
        inputType: "text",
        control: "text",
        required: true,
        editable: true,
      },
      {
        key: "markdownContext",
        label: "Context",
        inputType: "text",
        control: "textarea",
        required: true,
        editable: true,
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.inboxApproval,
    aslEmitter: (args, ctx) => {
      const state: AslState = {
        Type: "Task",
        Resource: "arn:aws:states:::lambda:invoke.waitForTaskToken",
        Parameters: {
          "FunctionName.$": "$$.Execution.Input.inboxApprovalFunctionName",
          Payload: {
            "taskToken.$": "$$.Task.Token",
            "executionId.$": "$$.Execution.Id",
            nodeId: ctx.stateName,
            title: args.title,
            markdownContext: args.markdownContext,
            decisionSchema: args.decisionSchema,
            ...(args.assigneeUserId
              ? { assigneeUserId: args.assigneeUserId }
              : {}),
          },
        },
      };
      if (typeof args.timeoutSeconds === "number") {
        state.TimeoutSeconds = args.timeoutSeconds;
      }
      return markRecipe(applySequencing(state, ctx), "inbox_approval");
    },
  },

  // --- Escape hatch ------------------------------------------------------
  {
    id: "python",
    displayName: "Run Python code",
    description:
      "Execute Python code in an AgentCore code sandbox. Output is captured to S3; the state returns only {exitCode, stdoutS3Uri, stderrS3Uri, stdoutPreview, truncated}. Use as the escape hatch when no first-class recipe fits.",
    category: "escape_hatch",
    hitlCapable: false,
    argSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: STR_NONEMPTY,
        timeoutSeconds: { type: "integer", minimum: 1, maximum: 900 },
        networkAllowlist: {
          type: "array",
          items: STR_NONEMPTY,
        },
        environment: { type: "object" },
      },
      required: ["code"],
    },
    configFields: [
      {
        key: "code",
        label: "Code",
        inputType: "text",
        control: "code",
        required: true,
        editable: true,
      },
      {
        key: "timeoutSeconds",
        label: "Timeout seconds",
        inputType: "number",
        control: "number",
        editable: false,
        min: 1,
        max: 900,
      },
      {
        key: "networkAllowlist",
        label: "Network allowlist",
        inputType: "string_array",
        control: "string_list",
        editable: false,
      },
    ],
    resourceArnPattern: RESOURCE_ARN_PATTERNS.python,
    aslEmitter: (args, ctx) =>
      markRecipe(
        applySequencing(
          {
            Type: "Task",
            Resource: "arn:aws:states:::lambda:invoke",
            Parameters: {
              "FunctionName.$":
                "$$.Execution.Input.routineTaskPythonFunctionName",
              Payload: {
                "tenantId.$": "$$.Execution.Input.tenantId",
                "routineId.$": "$$.Execution.Input.routineId",
                "executionId.$": "$$.Execution.Id",
                nodeId: ctx.stateName,
                code: args.code,
                timeoutSeconds: args.timeoutSeconds ?? 60,
                networkAllowlist: Array.isArray(args.networkAllowlist)
                  ? args.networkAllowlist
                  : [],
                ...(args.environment ? { environment: args.environment } : {}),
              },
            },
            ResultSelector: {
              "exitCode.$": "$.Payload.exitCode",
              "stdoutS3Uri.$": "$.Payload.stdoutS3Uri",
              "stderrS3Uri.$": "$.Payload.stderrS3Uri",
              "stdoutPreview.$": "$.Payload.stdoutPreview",
              "truncated.$": "$.Payload.truncated",
            },
          },
          ctx,
        ),
        "python",
      ),
  },
];

export const RECIPE_CATALOG: readonly RecipeDefinition[] =
  Object.freeze(_CATALOG);

const _CATALOG_BY_ID: Map<string, RecipeDefinition> = new Map(
  RECIPE_CATALOG.map((r) => [r.id, r]),
);

export function getRecipe(id: string): RecipeDefinition | undefined {
  return _CATALOG_BY_ID.get(id);
}

export function getRecipeConfigFields(
  recipeId: string,
  args: Record<string, unknown> = {},
): RecipeConfigField[] {
  const recipe = getRecipe(recipeId);
  if (!recipe?.configFields) return [];

  const required = new Set(
    Array.isArray(recipe.argSchema.required) ? recipe.argSchema.required : [],
  );

  return recipe.configFields.map((field) => ({
    key: field.key,
    label: field.label,
    value: args[field.key] ?? null,
    inputType: field.inputType,
    control: field.control ?? null,
    required: field.required ?? required.has(field.key),
    editable: field.editable ?? true,
    options: field.options ?? null,
    placeholder: field.placeholder ?? null,
    helpText: field.helpText ?? null,
    min: field.min ?? null,
    max: field.max ?? null,
    pattern: field.pattern ?? null,
  }));
}

export function listRecipes(): readonly RecipeDefinition[] {
  return RECIPE_CATALOG;
}

export function getRecipeDefaultArgs(
  recipeId: string,
): Record<string, unknown> {
  switch (recipeId) {
    case "wait":
      return { seconds: 300 };
    case "agent_invoke":
      return { agentId: "", input: {} };
    case "tool_invoke":
      return { toolId: "", toolSource: "builtin", args: {} };
    case "routine_invoke":
      return { routineId: "", input: {} };
    case "http_request":
      return {
        method: "GET",
        apiEndpoint: "https://",
        connectionArn: "",
      };
    case "aurora_query":
      return { sql: "select 1", databaseName: "" };
    case "transform_json":
      return { expression: "$" };
    case "set_variable":
      return { name: "value", value: "" };
    case "slack_send":
      return { channelId: "", text: "" };
    case "email_send":
      return {
        to: [],
        subject: "",
        body: "Add email body text.",
        bodyFormat: "markdown",
      };
    case "inbox_approval":
      return {
        title: "",
        markdownContext: "",
        decisionSchema: { type: "object" },
      };
    case "python":
      return {
        code: "print('hello from ThinkWork routine')",
        timeoutSeconds: 60,
        networkAllowlist: [],
      };
    default:
      return {};
  }
}

/**
 * Reverse-map a Resource ARN to a recipe id for Task states. Returns null
 * for ARNs no recipe owns; the validator treats that as "unknown Resource".
 *
 * Multiple recipes may share the same `arn:aws:states:::lambda:invoke`
 * pattern (tool_invoke, slack_send, email_send, python). For those, the
 * Comment marker is the authoritative discriminator — callers should
 * prefer `readRecipeMarker(state)` first and fall back to this only when
 * the marker is missing.
 */
export function findRecipeByArn(arn: string): RecipeDefinition | null {
  for (const recipe of RECIPE_CATALOG) {
    if (recipe.resourceArnPattern && recipe.resourceArnPattern.test(arn)) {
      return recipe;
    }
  }
  return null;
}

/** Resource ARNs known to the catalog. The validator uses this for "is the
 * Resource recognized at all?" checks before deeper recipe-arg validation. */
export function knownResourceArn(arn: string): boolean {
  for (const recipe of RECIPE_CATALOG) {
    if (recipe.resourceArnPattern && recipe.resourceArnPattern.test(arn)) {
      return true;
    }
  }
  return false;
}
