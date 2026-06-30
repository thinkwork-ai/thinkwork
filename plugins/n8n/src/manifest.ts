import type {
  InfrastructureComponent,
  McpServerComponent,
  PluginManifest,
  SkillsComponent,
  UiSurfaceComponent,
} from "@thinkwork/plugin-catalog/contracts";
import {
  N8N_APP_DESCRIPTION,
  N8N_APP_DISPLAY_NAME,
  N8N_APP_ICON,
  N8N_APP_KEY,
  N8N_APP_ROUTE_SEGMENT,
  N8N_APP_SURFACE_KEY,
} from "../n8n-app/src/application-config";

export const N8N_PLUGIN_KEY = "n8n";
export const N8N_PLUGIN_VERSION = "0.2.0";
export const N8N_PLUGIN_LEGACY_VERSION = "0.1.0";
export const N8N_MCP_ENDPOINT_PATH = "/mcp-server/http";
export const N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH =
  "/api/integrations/n8n/agent-steps";
export const N8N_SERVICE_CREDENTIAL_KIND = "n8n-mcp-access-token";
export const N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY =
  "N8N_MCP_SERVICE_CREDENTIAL";
export const N8N_AGENT_STEP_BRIDGE_CREDENTIAL_KIND =
  "n8n-agent-step-bridge-token";
export const N8N_AGENT_STEP_BRIDGE_CREDENTIAL_SECRET_JSON_KEY =
  "THINKWORK_N8N_AGENT_STEP_BRIDGE_TOKEN";
export const N8N_WORKFLOW_OPERATOR_SKILL_SLUG = "n8n-workflow-operator";

export const N8N_WORKFLOW_OPERATOR_SKILL_MD = `---
name: n8n-workflow-operator
description: Create, update, validate, test, and debug n8n workflows through ThinkWork's managed n8n MCP tools. Use when a request names n8n, workflows, executions, Code node packages, workflow migration, automation drafts, or asks to create an automation from a thread.
license: Apache-2.0
compatibility: ThinkWork n8n plugin with managed n8n MCP tools and a tenant n8n instance.
metadata:
  thinkwork-plugin: n8n
  skill-format: agentskills
---

# n8n Workflow Operator

Use n8n as a shared tenant automation runtime. Read live workflow and node
state, make draft-safe changes, validate the result, and leave production
activation to the shared native n8n operator unless the human explicitly says
otherwise.

## First Move

1. Use this skill before any n8n workflow create, update, validation, test, or
   debug action.
2. Use the n8n MCP tools provided by the installed ThinkWork n8n plugin. The
   plugin uses a tenant service credential, not per-user n8n activation.
3. If n8n tools are missing, report that the operator must install the n8n
   plugin, deploy the managed app, enable instance-level MCP in n8n, and enable
   MCP access on the workflow, project, or folder.
4. Trust live MCP tool descriptions and node schemas over memory. n8n changes
   quickly; if a live tool or schema disagrees with this skill, follow the live
   tool and report the drift in the handoff.

## Authoring Loop

For requests such as "create a workflow", "edit this workflow", or "make a
smoke test":

1. Classify the pattern: manual trigger, webhook, schedule, HTTP API
   integration, database sync, AI agent, or batch processing.
2. Read [MCP tooling](references/mcp-tooling.md), then discover live node
   schemas before configuring nodes.
3. Read [workflow authoring](references/workflow-authoring.md), then create or
   update an inactive draft. Use UUID-shaped node ids, current \`typeVersion\`
   values, and no placeholder credentials or secrets.
4. Validate iteratively. Treat validation errors as normal feedback: fix the
   specific field, then validate again.
5. Fetch the workflow after every create or update and inspect \`connections\` so
   silently dropped or wrong wires are caught before handoff.
6. Test only when safe. n8n test runs execute real HTTP calls, writes, sends,
   and other side effects.
7. Finish with [validation and handoff](references/validation-and-handoff.md).

## ThinkWork Agent-Step Bridge

1. For n8n-to-ThinkWork agent work, use the v1 agent-step bridge with stock
   HTTP Request and Wait nodes. Do not suggest a custom ThinkWork n8n node in
   v1.
2. The HTTP Request node calls ThinkWork's
   \`/api/integrations/n8n/agent-steps\` endpoint with the separate inbound
   bridge credential. Do not reuse the native n8n MCP service credential.
3. The workflow must pass target Space, target agent, instructions, structured
   input, workflow id/name, execution id, step id, correlation id, optional
   request id, optional timeout, and the current Wait-node resume URL from
   \`$execution.resumeUrl\`.
4. The Wait node should use On webhook call. Downstream nodes should branch on
   the resumed payload's \`status\` and read \`output\`, \`error\`, \`summary\`,
   and \`links\`; they should not scrape ThinkWork thread pages.
5. Explain idempotency as workflow id + execution id + correlation id + step
   id. Retrying the same bridge step should recover or replay the existing
   ThinkWork thread rather than creating a duplicate.

## Stop Conditions

Stop before writing when multiple workflows match, the workflow/project/folder
does not have MCP access enabled, credentials are unknown, a test would touch
production side effects, the user asks for production activation without using
the native n8n operator account, or the live MCP tool surface conflicts with
the requested action.
`;

export const N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD = `# MCP Tooling

Use live n8n MCP tools as the source of truth for tool names, argument shapes,
node schemas, and current \`typeVersion\` values.

## Tool Selection

1. Search for nodes before configuring them.
2. Read the node schema before setting parameters. Standard detail is enough for
   most nodes; use deeper docs only when the required field is unclear.
3. Validate nodes or workflows as soon as the tool surface supports it.
4. Prefer partial workflow updates for edits to existing workflows. Include a
   short intent when the tool accepts one.
5. Fetch the workflow after create/update and inspect \`connections\`.

## Node Type Formats

Use the form expected by the tool being called:

1. Node discovery and node validation tools use short forms, for example
   \`nodes-base.httpRequest\`.
2. Workflow JSON uses full forms, for example
   \`n8n-nodes-base.httpRequest\`.
3. If a tool returns both forms, carry both forward instead of reconstructing
   from memory.

## Credentials And Secrets

1. Never emit fake credential ids such as \`REPLACE_ME\`.
2. If the real credential id is unknown, omit the \`credentials\` block so the
   native UI can show a usable selector.
3. Never put tokens, API keys, or passwords in Set nodes, Code nodes,
   expressions, or plain text fields. Use the n8n credential system.
4. The ThinkWork agent-step bridge credential is separate from the n8n MCP
   service credential.

## Shortened Tool Names

The ThinkWork runtime may expose long MCP tool names in shortened form. Choose
tools by descriptions and parameter schemas, not memorized exact names.
`;

export const N8N_WORKFLOW_OPERATOR_WORKFLOW_AUTHORING_REFERENCE_MD = `# Workflow Authoring

Build the smallest inactive draft that proves the requested automation shape,
then validate and verify it before handoff.

## Pattern Choice

1. Manual trigger: use for user-triggered smoke tests and safe demos.
2. Webhook: use when an external system pushes an event.
3. Schedule: use for recurring fetch, report, and maintenance workflows.
4. HTTP API integration: use for read/write calls to external REST APIs.
5. Database sync: use for ETL and record reconciliation.
6. AI agent: use when the workflow needs model reasoning or n8n agent tools.
7. Batch processing: use when item count, pagination, or rate limits matter.

## Construction Rules

1. Prefer HTTP Request nodes over Code nodes for ordinary GET/POST calls.
2. Prefer expressions in the consuming field for simple data mapping.
3. Use \`{{ ... }}\` expressions in n8n fields. Use direct JavaScript only inside
   Code nodes.
4. Avoid Set/Edit Fields nodes that feed a single consumer; inline the
   expression at the consuming field.
5. For webhook workflows, user payload fields are under \`$json.body\`, not at
   the root.
6. For branchy workflows, reference upstream nodes by name instead of relying on
   ambiguous \`$json\` at branch convergence.
7. Search for existing workflows or templates before creating a larger reusable
   workflow from scratch.

## Draft Safety

1. Keep created workflows inactive unless the human explicitly completes
   production activation in the native n8n UI.
2. Prefer disabled copies or disposable draft workflows for edits.
3. Run only read-only or low-risk test executions without additional
   confirmation.
4. Do not trigger a production webhook, schedule, message send, database write,
   or destructive external side effect as a smoke test.

## Code Nodes

Use Code nodes only for multi-item aggregation, allowlisted package use, or
logic that cannot be expressed in fields. For Code nodes, use only packages
declared in the Plugin Detail n8n custom package settings.
`;

export const N8N_WORKFLOW_OPERATOR_VALIDATION_AND_HANDOFF_REFERENCE_MD = `# Validation And Handoff

Validation passing is necessary, not sufficient. A workflow can validate and
still have wrong wires, missing branches, or unsafe runtime behavior.

## Validation Loop

1. Validate configured nodes when available.
2. Create or update the inactive workflow.
3. Validate the complete workflow.
4. Fix one concrete error at a time, then validate again.
5. Treat warnings as context-sensitive. Production workflows should address
   missing error handling, retry, rate-limit, and credential warnings unless
   there is a clear reason to accept them.

## Verify After Write

After every create or update:

1. Fetch the workflow by id.
2. Confirm workflow id, name, active state, tags, project or folder, trigger
   nodes, credential references, and MCP access state.
3. Inspect \`connections\` directly. Confirm each expected branch, error output,
   and merge input is wired to the intended node.
4. If multiple workflows match, stop and ask for the exact workflow id or URL.

## Test Evidence

1. Ask before any test that can create records, call external APIs, send
   messages, or mutate production systems.
2. Prefer disposable inputs and read-only endpoints.
3. Record execution ids, failure messages, validation errors, and evidence
   links in the handoff.

## Handoff Checklist

Include workflow id, workflow name, draft/test status, package requirements,
credential assumptions, MCP access state, validation result, connection
verification result, test evidence, and the native n8n UI action required from
the shared operator.
`;

const N8N_INFRA_COMPONENT: InfrastructureComponent = {
  type: "infrastructure",
  key: "runtime",
  managedAppKey: N8N_PLUGIN_KEY,
  terraformInputs: {
    imageUri: {
      description: "Thin ThinkWork n8n wrapper image URI pinned with @sha256.",
      type: "string",
    },
    databaseAdminSecretArn: {
      description:
        "Secrets Manager ARN for an admin database credential allowed to create the n8n database and role.",
      type: "string",
    },
    databaseUrlSecretArn: {
      description:
        "Secrets Manager ARN containing the least-privilege n8n PostgreSQL connection URL.",
      type: "string",
    },
    encryptionKeySecretArn: {
      description: "Secrets Manager ARN containing N8N_ENCRYPTION_KEY.",
      type: "string",
    },
    operatorSecretArn: {
      description:
        "Secrets Manager ARN containing the shared native n8n operator account credential.",
      type: "string",
    },
    serviceCredentialSecretArn: {
      description:
        "Secrets Manager ARN containing the tenant service credential used by the native n8n MCP integration.",
      type: "string",
    },
    agentStepBridgeCredentialSecretArn: {
      description:
        "Secrets Manager ARN containing the inbound credential used by n8n workflows to call the ThinkWork agent-step bridge.",
      type: "string",
    },
    storageBucketName: {
      description: "S3 bucket name used for n8n binary data and runtime files.",
      type: "string",
    },
    publicUrl: {
      description: "Public HTTPS origin for n8n.",
      type: "string",
    },
    certificateArn: {
      description: "ACM certificate ARN for the n8n public HTTPS listener.",
      type: "string",
    },
  },
};

const N8N_MCP_COMPONENT: McpServerComponent = {
  type: "mcp-server",
  key: "workflow-management",
  displayName: "n8n workflow management",
  description:
    "Native instance-level n8n MCP for workflow inspection, draft-safe edits, and low-risk test evidence through the tenant n8n runtime.",
  endpointFrom: {
    managedApp: N8N_PLUGIN_KEY,
    configKey: "publicUrl",
    path: N8N_MCP_ENDPOINT_PATH,
  },
  auth: {
    mode: "tenant-service-credential",
    credentialKind: N8N_SERVICE_CREDENTIAL_KIND,
    secretRefConfigKey: "serviceCredentialSecretArn",
    headers: [
      {
        name: "Authorization",
        secretJsonKey: N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY,
        valuePrefix: "Bearer ",
      },
    ],
  },
  toolNotes: [
    "n8n v1 uses one tenant service credential and a shared native n8n operator account; it does not support per-user n8n activation.",
    "The n8n agent-step bridge uses a separate inbound tenant credential for workflow HTTP Request nodes; do not reuse the MCP service credential for bridge calls.",
    "Operators must enable instance-level MCP in n8n and enable MCP access on the workflow, project, or folder before agents can inspect it.",
    "Agents may inspect, draft, and test low-risk workflows, but production activation, publish, and unpublish stay in the native n8n UI.",
  ],
};

const N8N_PACKAGE_SETTINGS_COMPONENT: UiSurfaceComponent = {
  type: "ui-surface",
  key: "package-settings",
  displayName: "n8n custom package settings",
  intendedMount: "settings.plugins.detail",
};

const N8N_WORKFLOW_OPERATIONS_APP_COMPONENT: UiSurfaceComponent = {
  type: "ui-surface",
  key: N8N_APP_SURFACE_KEY,
  displayName: N8N_APP_DISPLAY_NAME,
  intendedMount: "apps.main",
  launch: {
    schemaVersion: 1,
    type: "app",
    appKey: N8N_APP_KEY,
    routeSegment: N8N_APP_ROUTE_SEGMENT,
    mount: "main-shell",
    runtime: "trusted-bundled-react",
    description: N8N_APP_DESCRIPTION,
    icon: N8N_APP_ICON,
    entitlementProductKey: N8N_APP_KEY,
  },
};

const N8N_SKILLS_COMPONENT: SkillsComponent = {
  type: "skills",
  key: "workflow-operator-instructions",
  skills: [
    {
      slug: N8N_WORKFLOW_OPERATOR_SKILL_SLUG,
      skillMd: N8N_WORKFLOW_OPERATOR_SKILL_MD,
      supportingFiles: [
        {
          path: "references/mcp-tooling.md",
          content: N8N_WORKFLOW_OPERATOR_MCP_TOOLING_REFERENCE_MD,
        },
        {
          path: "references/workflow-authoring.md",
          content: N8N_WORKFLOW_OPERATOR_WORKFLOW_AUTHORING_REFERENCE_MD,
        },
        {
          path: "references/validation-and-handoff.md",
          content: N8N_WORKFLOW_OPERATOR_VALIDATION_AND_HANDOFF_REFERENCE_MD,
        },
      ],
    },
  ],
};

export const n8nManifest: PluginManifest = {
  pluginKey: N8N_PLUGIN_KEY,
  displayName: "n8n",
  description:
    "Self-hosted n8n workflow automation runtime with queue-mode workers, custom Code node packages, and native n8n MCP access for agents.",
  versions: [
    {
      version: N8N_PLUGIN_LEGACY_VERSION,
      requiredOauthScopes: [],
      components: [
        N8N_INFRA_COMPONENT,
        N8N_MCP_COMPONENT,
        N8N_PACKAGE_SETTINGS_COMPONENT,
        N8N_SKILLS_COMPONENT,
      ],
    },
    {
      version: N8N_PLUGIN_VERSION,
      requiredOauthScopes: [],
      components: [
        N8N_INFRA_COMPONENT,
        N8N_MCP_COMPONENT,
        N8N_PACKAGE_SETTINGS_COMPONENT,
        N8N_WORKFLOW_OPERATIONS_APP_COMPONENT,
        N8N_SKILLS_COMPONENT,
      ],
    },
  ],
};
