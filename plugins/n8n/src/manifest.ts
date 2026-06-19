import type {
  InfrastructureComponent,
  McpServerComponent,
  PluginManifest,
  SkillsComponent,
  UiSurfaceComponent,
} from "@thinkwork/plugin-catalog/contracts";

export const N8N_PLUGIN_KEY = "n8n";
export const N8N_PLUGIN_VERSION = "0.1.0";
export const N8N_MCP_ENDPOINT_PATH = "/mcp-server/http";
export const N8N_SERVICE_CREDENTIAL_KIND = "n8n-mcp-access-token";
export const N8N_SERVICE_CREDENTIAL_SECRET_JSON_KEY =
  "N8N_MCP_SERVICE_CREDENTIAL";
export const N8N_WORKFLOW_OPERATOR_SKILL_SLUG = "n8n--workflow-operator";

export const N8N_WORKFLOW_OPERATOR_SKILL_MD = `---
name: n8n--workflow-operator
description: Work with the tenant n8n instance through ThinkWork's managed n8n MCP tools. Use when a request names n8n, workflows, executions, Code node packages, workflow migration, or automation drafts.
---

# n8n workflow operator

Use n8n as a shared tenant automation runtime. Read the current workflow state,
make draft-safe changes, test with disposable inputs when requested, and leave
production activation to the shared native n8n operator.

## Activation and scope

1. Use the n8n MCP tools provided by the installed ThinkWork n8n plugin. The
   plugin uses a tenant service credential, not per-user n8n activation.
2. If n8n tools are missing, report that the operator must install the n8n
   plugin, deploy the managed app, enable instance-level MCP in n8n, and enable
   MCP access on the workflow, project, or folder.
3. Treat the native n8n UI as the final production activation surface in v1.
   Do not publish, unpublish, activate, or deactivate production workflows
   unless the human is explicitly operating the shared n8n operator account in
   the native UI.

## Read and identify

1. Resolve workflow id, name, active state, project or folder, tags, trigger
   nodes, credential references, and recent executions before proposing changes.
2. Return both workflow id and workflow name in every workflow handoff or
   verification summary.
3. Confirm whether the workflow, project, or folder has MCP access enabled
   before assuming agents can inspect or edit it.
4. If multiple workflows match, stop and ask for the exact workflow id or URL
   before making changes.

## Draft and test safely

1. Prefer draft workflows, disabled copies, or disposable test workflows for
   agent-authored changes.
2. For Code nodes, use only packages declared in the Plugin Detail n8n custom
   package settings. Do not import undeclared packages or rely on private npm
   registries.
3. When asked to create or update a workflow, keep it inactive unless the
   human explicitly completes activation in the native n8n UI.
4. Run only low-risk reads or test executions that the human has allowed. Never
   trigger a production webhook, production schedule, or destructive external
   side effect as a smoke test.

## Handoff

1. Summarize the workflow id, workflow name, draft/test status, package
   requirements, credential assumptions, and MCP access state.
2. Include the native n8n UI handoff: which shared operator should review the
   workflow and what they need to activate or leave disabled.
3. Record evidence links or execution ids for successful test runs, and record
   exact failure messages for blocked tests.
4. If a production activation, unpublish, credential rotation, or package image
   change is required, hand it to the operator instead of trying to complete it
   through MCP.
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

const N8N_SKILLS_COMPONENT: SkillsComponent = {
  type: "skills",
  key: "workflow-operator-instructions",
  skills: [
    {
      slug: N8N_WORKFLOW_OPERATOR_SKILL_SLUG,
      skillMd: N8N_WORKFLOW_OPERATOR_SKILL_MD,
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
      version: N8N_PLUGIN_VERSION,
      requiredOauthScopes: [],
      components: [
        N8N_INFRA_COMPONENT,
        N8N_MCP_COMPONENT,
        N8N_PACKAGE_SETTINGS_COMPONENT,
        N8N_SKILLS_COMPONENT,
      ],
    },
  ],
};
