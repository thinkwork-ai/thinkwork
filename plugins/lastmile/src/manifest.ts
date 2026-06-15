/**
 * LastMile plugin manifest — v0.1.0.
 *
 * Endpoint/auth values were captured from LastMile's live RFC 9728
 * protected-resource metadata on 2026-06-12 (plan 2026-06-12-001 U9; the
 * recorded capture lives in `discovery.fixture.ts` next to this file and
 * is asserted against the manifest by `lastmile-discovery.test.ts`):
 *
 *   - One authorization server (WorkOS AuthKit staging) covers all three
 *     MCP servers, so a single app-level activation mints tokens for the
 *     whole plugin.
 *   - Per-server RFC 8707 resource indicators are the server base URLs.
 *   - The Routing server publishes protected-resource metadata and
 *     therefore REQUIRES OAuth, despite a stale `auth_type: 'none'`
 *     direct-add row that existed on dev — the manifest declares oauth.
 *   - Endpoint URLs intentionally match the existing manually-added dev
 *     `tenant_mcp_servers` rows EXACTLY, so the URL-dedupe coexistence
 *     path (plugin row wins over a same-URL manual row at dispatch) is
 *     exercised for real.
 *
 * KNOWN v1 GAP — per-stage endpoints: these are LastMile's DEVELOP-stage
 * endpoints (`dev-mcp.lastmile-tei.com`); production is
 * `mcp.lastmile-tei.com`. The manifest format has no per-stage endpoint
 * parameterization yet, so a prod rollout currently requires publishing a
 * new manifest version with the prod URLs. Tracked as a follow-up to plan
 * 2026-06-12-001.
 */

const LASTMILE_AUTH_DOMAIN =
  "https://straightforward-dragon-14-staging.authkit.app";

const LASTMILE_MCP_BASE = "https://dev-mcp.lastmile-tei.com";

const CRM_BASICS_SKILL_MD = `---
name: lastmile--crm-basics
description: Look up, summarize, and update LastMile CRM records through the LastMile CRM MCP tools. Use when a request involves LastMile customers, accounts, opportunities, or account history.
---

# LastMile CRM basics

Work LastMile CRM requests through the \`lastmile--crm\` MCP server's
tools — never guess at record contents from memory. The server covers
opportunities and accounts; list its tools first if you are unsure what
is available, since the exact tool set can change between LastMile
releases.

## Listing and filtering opportunities

1. Use \`opportunities_list\` to enumerate opportunities. Apply the
   narrowest filter the tool's input schema supports (owner, stage,
   account) rather than listing everything and filtering in prose.
2. If a request names a specific account or customer, resolve the account
   first, then scope the opportunity listing to it.
3. When more rows match than you can usefully summarize, say so and ask
   how to narrow, instead of truncating silently.

## Updating records

1. Read the current record first and show the user the fields you are
   about to change.
2. Apply the smallest update that satisfies the request; never bulk-edit
   fields the user did not mention.
3. After writing, re-read the record and confirm the change took effect.

## Summarizing

When asked for an account or pipeline summary, pull the relevant records
and lead with what changed most recently. State clearly when a field is
empty or a record was not found — do not fill gaps from memory.
`;

export const lastmileManifest = {
  pluginKey: "lastmile",
  displayName: "LastMile",
  description:
    "LastMile CRM, task, and routing tools for field-service teams, with bundled skills for working customer records.",
  versions: [
    {
      version: "0.1.0",
      // scopes_supported is identical across all three servers (captured
      // 2026-06-12); offline_access keeps refresh tokens flowing so an
      // activation outlives the first access token.
      requiredOauthScopes: ["openid", "email", "profile", "offline_access"],
      components: [
        {
          type: "mcp-server",
          key: "crm",
          displayName: "LastMile CRM",
          description: "Customer accounts and sales opportunities.",
          endpointUrl: `${LASTMILE_MCP_BASE}/crm`,
          auth: {
            mode: "oauth",
            authDomain: LASTMILE_AUTH_DOMAIN,
            resourceIndicator: `${LASTMILE_MCP_BASE}/crm`,
          },
          toolNotes: [
            "Opportunity and account tools, including opportunities_list for listing/filtering opportunities.",
          ],
        },
        {
          type: "mcp-server",
          key: "tasks",
          displayName: "LastMile Tasks",
          description: "Work orders and task assignments.",
          endpointUrl: `${LASTMILE_MCP_BASE}/tasks`,
          auth: {
            mode: "oauth",
            authDomain: LASTMILE_AUTH_DOMAIN,
            resourceIndicator: `${LASTMILE_MCP_BASE}/tasks`,
          },
          toolNotes: ["Task management tools."],
        },
        {
          type: "mcp-server",
          key: "routing",
          displayName: "LastMile Routing",
          description: "Route planning and technician dispatch.",
          endpointUrl: `${LASTMILE_MCP_BASE}/routing`,
          auth: {
            mode: "oauth",
            authDomain: LASTMILE_AUTH_DOMAIN,
            resourceIndicator: `${LASTMILE_MCP_BASE}/routing`,
          },
          toolNotes: ["Route optimization tools."],
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
