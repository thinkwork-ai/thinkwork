/**
 * Plane plugin manifest (THNK-27).
 *
 * Plane is registered in the published plugin catalog after the Terraform
 * runtime, user-provided MCP header activation, smoke coverage, and release
 * packaging paths are wired:
 *
 *   - The `infrastructure` component maps onto the `plane` deployment-runner
 *     adapter introduced by U1. `terraformInputs` mirrors the adapter's
 *     required inputs for ENABLE/UPGRADE.
 *   - The runtime topology is intentionally compact: one ECS service/task.
 *     Plane AIO still requires Redis and AMQP URLs, so the Terraform module
 *     satisfies those with private task-local sidecars only. Do not reintroduce
 *     per-service Plane containers, managed Redis/Valkey, or Amazon MQ/RabbitMQ
 *     into this plugin contract.
 *   - The `skills` component seeds the first workflow skill so agents can
 *     work Plane issues with context-first read/write discipline.
 *   - The `mcp-server` component resolves the tenant Plane endpoint from the
 *     managed-app public URL and uses user-provided header auth. Each user
 *     activates with their own Plane PAT (`x-api-key`) and workspace slug
 *     (`x-workspace-slug`); no tenant-wide key is declared or accepted.
 */

import type {
  InfrastructureComponent,
  McpServerComponent,
  PluginManifest,
  SkillsComponent,
} from "@thinkwork/plugin-catalog/contracts";
const ISSUE_LOOP_SKILL_MD = `---
name: plane--issue-loop
description: Work Plane issues through the tenant Plane MCP tools. Use when a request names Plane, a Plane work item, issue key, cycle, module, project, page, comment, or readable issue id such as ENG-42.
---

# Plane issue loop

Use Plane as the durable task record. Start from Plane, resolve the exact
workspace/project/issue, make narrow changes, and write findings back so the
next agent or human has the same context.

## Activation and scope

1. Use only Plane MCP tools made available for the active user's Plane
   activation. Never use a tenant-wide Plane API key or credentials copied from
   another user.
2. If Plane tools are missing or the activation is unavailable, say that the
   user needs to activate Plane and stop before attempting a Plane write.
3. Treat Plane as the source of truth for work-item state. Do not rely on
   memory, chat history, or a copied URL when a Plane read tool can confirm the
   current record.

## Read first

1. Resolve the workspace slug and project before changing anything.
2. For readable issue ids such as \`ENG-42\`, identify the project key
   (\`ENG\`) and issue sequence (\`42\`), then resolve that readable key to the
   Plane UUID before calling UUID-only tools.
3. Read the current issue title, description, state, priority, assignee,
   labels, relations, cycle, module, comments, pages, and recent activity before
   proposing or applying changes.
4. If multiple issues match or the project/workspace is ambiguous, stop and ask
   for the exact Plane reference instead of guessing or creating a duplicate.

## Make narrow writes

1. Change only the fields required by the user's request or the active task
   outcome.
2. Prefer comments for progress, findings, links, blockers, and verification
   evidence. Do not replace issue descriptions, pages, labels, states, modules,
   cycles, estimates, assignees, or relations unless the request explicitly
   requires it.
3. Do not bulk-edit unrelated issues, states, modules, cycles, labels, or
   pages. For multi-issue edits, enumerate the intended issue keys first.
4. After writing, re-read the Plane record and confirm the saved state matches
   the intended change.

## Write-back discipline

1. Add a concise Plane comment when you discover important context, make a
   decision, hit a blocker, open a PR, merge a PR, or finish verification.
2. Include durable links and identifiers: Plane issue key, PR URL, commit hash,
   branch name, failing CI job, test command, or document path when relevant.
3. Keep implementation details attached to the specific Plane issue that owns
   the work; do not scatter updates across unrelated issues.
4. When creating a follow-up issue, link it to the source issue, explain why
   the work moved, and copy only the context needed for the follow-up owner.

## Stop conditions

Stop and ask for clarification before a Plane write when the issue reference is
ambiguous, a destructive or bulk change is requested, a required activation is
missing, the Plane tool response conflicts with the user's request, or the
requested change would move work outside the named project/module/cycle.
`;

const PLANE_MCP_COMPONENT: McpServerComponent = {
  type: "mcp-server",
  key: "issues",
  displayName: "Plane work items",
  description:
    "Plane workspace, project, issue, cycle, module, page, and comment tools for the user's activated Plane workspace.",
  endpointFrom: {
    managedApp: "plane",
    configKey: "publicUrl",
    path: "/http/api-key/mcp",
  },
  auth: {
    mode: "user-provided-headers",
    headers: [
      {
        name: "x-api-key",
        credentialKey: "apiKey",
        displayName: "Plane personal access token",
        secret: true,
      },
      {
        name: "x-workspace-slug",
        credentialKey: "workspaceSlug",
        displayName: "Plane workspace slug",
      },
    ],
  },
  toolNotes: [
    "Plane MCP HTTP PAT mode requires x-api-key and x-workspace-slug headers; readable issue ids such as ENG-42 must be resolved to UUIDs before UUID-only tool calls.",
  ],
};

const LEGACY_INFRA_COMPONENT: InfrastructureComponent = {
  type: "infrastructure",
  key: "runtime",
  managedAppKey: "plane",
  terraformInputs: {
    frontendImageUri: {
      description: "Plane frontend image URI pinned with @sha256.",
      type: "string",
    },
    backendImageUri: {
      description: "Plane backend image URI pinned with @sha256.",
      type: "string",
    },
    spaceImageUri: {
      description: "Plane Space image URI pinned with @sha256.",
      type: "string",
    },
    adminImageUri: {
      description: "Plane admin image URI pinned with @sha256.",
      type: "string",
    },
    liveImageUri: {
      description: "Plane live image URI pinned with @sha256.",
      type: "string",
    },
    mcpImageUri: {
      description: "Plane MCP server image URI pinned with @sha256.",
      type: "string",
    },
    dbUrlSecretArn: {
      description: "Secrets Manager ARN containing Plane DATABASE_URL.",
      type: "string",
    },
    secretKeySecretArn: {
      description: "Secrets Manager ARN containing Plane SECRET_KEY.",
      type: "string",
    },
    liveServerSecretKeySecretArn: {
      description:
        "Secrets Manager ARN containing Plane LIVE_SERVER_SECRET_KEY.",
      type: "string",
    },
    aesSecretKeySecretArn: {
      description: "Secrets Manager ARN containing Plane AES_SECRET_KEY.",
      type: "string",
    },
    s3AccessKeyIdSecretArn: {
      description:
        "Optional Secrets Manager ARN containing an access key id for Plane S3 uploads.",
      type: "string",
    },
    s3SecretAccessKeySecretArn: {
      description:
        "Optional Secrets Manager ARN containing a secret access key for Plane S3 uploads.",
      type: "string",
    },
    s3BucketName: {
      description: "S3 bucket name used for Plane file uploads.",
      type: "string",
    },
    publicUrl: {
      description: "Public HTTPS origin for Plane.",
      type: "string",
    },
    certificateArn: {
      description: "ACM certificate ARN for the Plane public HTTPS listener.",
      type: "string",
    },
  },
};

const COMPACT_INFRA_COMPONENT: InfrastructureComponent = {
  type: "infrastructure",
  key: "runtime",
  managedAppKey: "plane",
  terraformInputs: {
    imageUri: {
      description:
        "Plane all-in-one image URI pinned with @sha256. Defaults to the reviewed Plane AIO image when omitted by the install handler.",
      type: "string",
    },
    mcpImageUri: {
      description: "Plane MCP sidecar image URI pinned with @sha256.",
      type: "string",
    },
    dbUrlSecretArn: LEGACY_INFRA_COMPONENT.terraformInputs.dbUrlSecretArn,
    secretKeySecretArn:
      LEGACY_INFRA_COMPONENT.terraformInputs.secretKeySecretArn,
    liveServerSecretKeySecretArn:
      LEGACY_INFRA_COMPONENT.terraformInputs.liveServerSecretKeySecretArn,
    aesSecretKeySecretArn:
      LEGACY_INFRA_COMPONENT.terraformInputs.aesSecretKeySecretArn,
    s3AccessKeyIdSecretArn:
      LEGACY_INFRA_COMPONENT.terraformInputs.s3AccessKeyIdSecretArn,
    s3SecretAccessKeySecretArn:
      LEGACY_INFRA_COMPONENT.terraformInputs.s3SecretAccessKeySecretArn,
    s3BucketName: LEGACY_INFRA_COMPONENT.terraformInputs.s3BucketName,
    publicUrl: LEGACY_INFRA_COMPONENT.terraformInputs.publicUrl,
    certificateArn: LEGACY_INFRA_COMPONENT.terraformInputs.certificateArn,
  },
};

const PLANE_SKILLS_COMPONENT: SkillsComponent = {
  type: "skills",
  key: "skills",
  skills: [
    {
      slug: "plane--issue-loop",
      skillMd: ISSUE_LOOP_SKILL_MD,
    },
  ],
};

export const planeManifest: PluginManifest = {
  pluginKey: "plane",
  displayName: "Plane",
  description:
    "Self-hosted Plane project management runtime with durable work items, workflow skills, and user-scoped Plane MCP integration.",
  versions: [
    {
      version: "0.1.1",
      requiredOauthScopes: [],
      components: [
        PLANE_MCP_COMPONENT,
        COMPACT_INFRA_COMPONENT,
        PLANE_SKILLS_COMPONENT,
      ],
    },
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        PLANE_MCP_COMPONENT,
        LEGACY_INFRA_COMPONENT,
        PLANE_SKILLS_COMPONENT,
      ],
    },
  ],
};
