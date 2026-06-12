/**
 * LastMile plugin manifest — v0.1.0 skeleton.
 *
 * PLACEHOLDERS: every endpoint, the auth domain, the resource indicators,
 * and the scope list below are pending the live OAuth discovery capture
 * (plan U9 finalizes against real LastMile metadata; the U6 pre-step
 * records authorization server(s), per-server resource indicators, and the
 * scope vocabulary). The `.invalid` TLD is reserved (RFC 2606) so nothing
 * here can accidentally resolve, while the values still validate
 * structurally.
 */

import type { PluginManifest } from "../../contracts";

// PLACEHOLDER — pending LastMile discovery capture (U9).
const PLACEHOLDER_AUTH_DOMAIN = "https://auth.lastmile.example.invalid";

const CRM_BASICS_SKILL_MD = `---
name: lastmile--crm-basics
description: Look up, summarize, and update LastMile CRM records through the LastMile CRM MCP tools. Use when a request involves LastMile customers, contacts, deals, or account history.
---

# LastMile CRM basics

Work LastMile CRM requests through the \`lastmile-crm\` MCP server's tools —
never guess at record contents from memory.

## Looking up records

1. Search by the most specific identifier the user gave (record id, email,
   company name — in that order of preference).
2. If multiple records match, list the candidates and ask which one before
   reading or changing anything.

## Updating records

1. Read the current record first and show the user the fields you are about
   to change.
2. Apply the smallest update that satisfies the request; never bulk-edit
   fields the user did not mention.
3. After writing, re-read the record and confirm the change took effect.

## Summarizing

When asked for an account summary, pull the record plus its recent activity
and lead with what changed since the last touchpoint.
`;

export const lastmileManifest: PluginManifest = {
  pluginKey: "lastmile",
  displayName: "LastMile",
  description:
    "LastMile CRM, task, and routing tools for field-service teams, with bundled skills for working customer records.",
  versions: [
    {
      version: "0.1.0",
      // PLACEHOLDER scopes — pending discovery capture (U9).
      requiredOauthScopes: ["openid", "offline_access"],
      components: [
        {
          type: "mcp-server",
          key: "crm",
          displayName: "LastMile CRM",
          description: "Customer, contact, and deal records.",
          // PLACEHOLDER endpoint — pending discovery capture (U9).
          endpointUrl: "https://crm.mcp.lastmile.example.invalid/mcp",
          auth: {
            mode: "oauth",
            authDomain: PLACEHOLDER_AUTH_DOMAIN,
            // PLACEHOLDER resource indicator — pending discovery capture (U9).
            resourceIndicator: "https://crm.mcp.lastmile.example.invalid",
          },
          toolNotes: ["Record search, read, create, and update tools."],
        },
        {
          type: "mcp-server",
          key: "tasks",
          displayName: "LastMile Tasks",
          description: "Work orders and task assignments.",
          // PLACEHOLDER endpoint — pending discovery capture (U9).
          endpointUrl: "https://tasks.mcp.lastmile.example.invalid/mcp",
          auth: {
            mode: "oauth",
            authDomain: PLACEHOLDER_AUTH_DOMAIN,
            // PLACEHOLDER resource indicator — pending discovery capture (U9).
            resourceIndicator: "https://tasks.mcp.lastmile.example.invalid",
          },
        },
        {
          type: "mcp-server",
          key: "routing",
          displayName: "LastMile Routing",
          description: "Route planning and technician dispatch.",
          // PLACEHOLDER endpoint — pending discovery capture (U9).
          endpointUrl: "https://routing.mcp.lastmile.example.invalid/mcp",
          auth: {
            mode: "oauth",
            authDomain: PLACEHOLDER_AUTH_DOMAIN,
            // PLACEHOLDER resource indicator — pending discovery capture (U9).
            resourceIndicator: "https://routing.mcp.lastmile.example.invalid",
          },
        },
        {
          type: "skills",
          key: "skills",
          skills: [
            {
              slug: "lastmile--crm-basics",
              skillMd: CRM_BASICS_SKILL_MD,
            },
          ],
        },
      ],
    },
  ],
};
