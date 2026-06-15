/**
 * Plane plugin manifest — v0.1.0 draft (THNK-27 U2).
 *
 * Plane is intentionally exported for parity tests and later implementation
 * units, but not registered in the published catalog list yet. Publication
 * waits for the Terraform runtime module and per-user MCP activation path to
 * be executable:
 *
 *   - The `infrastructure` component maps onto the `plane` deployment-runner
 *     adapter introduced by U1. `terraformInputs` mirrors the adapter's
 *     required inputs for ENABLE/UPGRADE.
 *   - The `skills` component seeds the first workflow skill so agents can
 *     work Plane issues with context-first read/write discipline once the
 *     plugin is installable.
 *   - The `mcp-server` component resolves the tenant Plane endpoint from the
 *     managed-app public URL and uses user-provided header auth. Each user
 *     activates with their own Plane PAT (`x-api-key`) and workspace slug
 *     (`x-workspace-slug`); no tenant-wide key is declared or accepted.
 */

import type { PluginManifest } from "../../contracts";

const ISSUE_LOOP_SKILL_MD = `---
name: plane--issue-loop
description: Work Plane issues through the tenant Plane MCP tools. Use when a request names Plane, a Plane work item, cycle, module, project, or readable issue id such as ENG-42.
---

# Plane issue loop

Use Plane as the durable task record. Start from Plane, make narrow changes,
and write findings back so the next agent or human has the same context.

## Read first

1. Resolve the workspace and project before changing anything.
2. For readable issue ids such as \`ENG-42\`, resolve the id to the Plane UUID
   before calling UUID-only tools.
3. Read the current issue, comments, labels, relations, cycle, module, state,
   assignee, and recent activity before proposing or applying changes.
4. If an issue is missing or ambiguous, stop and ask for the exact Plane
   workspace/project/issue reference instead of creating a duplicate.

## Make narrow writes

1. Change only the fields required by the user's request.
2. Do not bulk-edit unrelated issues, states, modules, cycles, or labels.
3. Never use a tenant-wide Plane API key for user-scoped work. Use only the
   active user's Plane activation.
4. After writing, re-read the record and confirm the saved state.

## Preserve context

1. Add a concise Plane comment for important findings, decisions, blockers,
   links, and verification evidence.
2. Keep implementation details attached to the specific Plane issue that owns
   the work.
3. When creating a follow-up issue, link it to the source issue and explain why
   the work moved.
`;

export const planeManifest: PluginManifest = {
  pluginKey: "plane",
  displayName: "Plane",
  description:
    "Self-hosted Plane project management runtime with durable work items, workflow skills, and user-scoped Plane MCP integration.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "mcp-server",
          key: "issues",
          displayName: "Plane work items",
          description:
            "Plane workspace, project, issue, cycle, module, page, and comment tools for the user's activated Plane workspace.",
          endpointFrom: {
            managedApp: "plane",
            configKey: "publicUrl",
            path: "/mcp",
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
        },
        {
          type: "infrastructure",
          key: "runtime",
          managedAppKey: "plane",
          terraformInputs: {
            imageUri: {
              description:
                "Plane runtime container image URI pinned with @sha256.",
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
              description:
                "Secrets Manager ARN containing Plane AES_SECRET_KEY.",
              type: "string",
            },
            amqpUrlSecretArn: {
              description: "Secrets Manager ARN containing Plane AMQP_URL.",
              type: "string",
            },
            s3AccessKeyIdSecretArn: {
              description:
                "Secrets Manager ARN containing an access key id for Plane S3 uploads.",
              type: "string",
            },
            s3SecretAccessKeySecretArn: {
              description:
                "Secrets Manager ARN containing a secret access key for Plane S3 uploads.",
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
              description:
                "ACM certificate ARN for the Plane public HTTPS listener.",
              type: "string",
            },
          },
        },
        {
          type: "skills",
          key: "skills",
          skills: [
            {
              slug: "plane--issue-loop",
              skillMd: ISSUE_LOOP_SKILL_MD,
            },
          ],
        },
      ],
    },
  ],
};
