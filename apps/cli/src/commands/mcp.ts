import { Command } from "commander";
import chalk from "chalk";
import { createClient, adminKeys, AdminOpsError } from "@thinkwork/admin-ops";
import { apiFetch, resolveApiConfig } from "../api-client.js";
import { printHeader, printError, printSuccess, printWarning } from "../ui.js";
import { printJson, printTable } from "../lib/output.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveTenantRest } from "../lib/resolve-tenant-rest.js";
import { isCancellation } from "../lib/interactive.js";
import { resolveIdentifier } from "../lib/resolve-identifier.js";

/**
 * `thinkwork mcp ...` — MCP (Model Context Protocol) server CRUD + agent
 * assignment.
 *
 * Every subcommand follows the CLI's dual-mode convention: pass all required
 * args as flags for scripting / agents, or omit them interactively and get
 * arrow-key pickers for stage + tenant + server. Positional `<id>` args
 * accept UUID, slug, or human name — `resolveIdentifier` handles the lookup
 * so users don't have to dig UUIDs out of the list output.
 */

interface McpServer {
  id: string;
  slug: string;
  name: string;
  url: string;
  transport: string;
  authType?: string;
  oauthProvider?: string;
  enabled: boolean;
  tools?: Array<{ name: string; description?: string }>;
}

/** Bundle of everything a mcp subcommand needs after stage+tenant resolution. */
async function resolveMcpContext(opts: { stage?: string; tenant?: string }) {
  const stage = await resolveStage({ flag: opts.stage });
  const api = resolveApiConfig(stage);
  if (!api) process.exit(1);
  const tenant = await resolveTenantRest({
    flag: opts.tenant,
    stage,
    apiUrl: api!.apiUrl,
    authSecret: api!.authSecret,
  });
  return { stage, api: api!, tenant };
}

/**
 * Resolve a positional `<id>` (UUID / slug / name) into the full server
 * record. Falls back to an arrow-key picker in a TTY when omitted.
 */
async function resolveServer(
  identifier: string | undefined,
  api: { apiUrl: string; authSecret: string },
  tenantSlug: string,
): Promise<McpServer> {
  return resolveIdentifier<McpServer>({
    identifier,
    list: async () => {
      const res = await apiFetch(
        api.apiUrl,
        api.authSecret,
        "/api/skills/mcp-servers",
        {},
        { "x-tenant-slug": tenantSlug },
      );
      return (res.servers ?? []) as McpServer[];
    },
    getId: (s) => s.id,
    getAliases: (s) => [s.slug, s.name],
    resourceLabel: "MCP server",
    pickerLabel: (s) =>
      `${s.name}  ${chalk.dim(`(${s.slug}, ${s.id})`)}`,
  });
}

function formatAuth(s: McpServer): string {
  if (s.authType === "per_user_oauth") return `OAuth (${s.oauthProvider})`;
  if (s.authType === "tenant_api_key") return "API Key";
  return "none";
}

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("Manage MCP servers for your tenant");

  mcp
    .command("list")
    .alias("ls")
    .description("List registered MCP servers. Prompts for stage/tenant in a TTY when omitted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  # Interactive — picks stage + tenant from the deployed ones
  $ thinkwork mcp list

  # Scriptable
  $ thinkwork mcp list -s dev -t acme
  $ thinkwork mcp list -s prod -t acme --json | jq '.[].id'
`,
    )
    .action(async (opts: { stage?: string; tenant?: string }) => {
      try {
        const { stage, api, tenant } = await resolveMcpContext(opts);
        printHeader("mcp list", stage);

        const { servers } = await apiFetch(
          api.apiUrl,
          api.authSecret,
          "/api/skills/mcp-servers",
          {},
          { "x-tenant-slug": tenant.slug },
        );

        if (!servers || servers.length === 0) {
          console.log(chalk.dim("  No MCP servers registered."));
          return;
        }
        console.log("");
        for (const s of servers as McpServer[]) {
          const status = s.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          console.log(`  ${chalk.bold(s.name)}  ${chalk.dim(s.slug)}  ${status}`);
          console.log(`    ID:        ${s.id}`);
          console.log(`    URL:       ${s.url}`);
          console.log(`    Transport: ${s.transport}`);
          console.log(`    Auth:      ${formatAuth(s)}`);
          if (s.tools?.length) console.log(`    Tools:     ${s.tools.length} cached`);
          console.log("");
        }
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  mcp
    .command("add [name]")
    .description("Register an MCP server. Prompts for missing fields in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--url <url>", "MCP server URL")
    .option("--transport <type>", "Transport type (streamable-http|sse)", "streamable-http")
    .option("--auth-type <type>", "Auth type (none|tenant_api_key|per_user_oauth)", "none")
    .option("--api-key <token>", "API key (for tenant_api_key auth)")
    .option("--oauth-provider <name>", "OAuth provider name (for per_user_oauth auth)")
    .addHelpText(
      "after",
      `
Examples:
  # Fully interactive — prompts for name, URL, and auth
  $ thinkwork mcp add

  # Scripted — API-key auth
  $ thinkwork mcp add my-tools --url https://mcp.example.com/crm \\
      --auth-type tenant_api_key --api-key sk-abc -s dev -t acme

  # OAuth-backed MCP integration (users connect from the mobile app)
  $ thinkwork mcp add crm-tools --url https://mcp.example.com/crm \\
      --auth-type per_user_oauth --oauth-provider crm_provider -s dev -t acme
`,
    )
    .action(
      async (
        nameArg: string | undefined,
        opts: {
          stage?: string;
          tenant?: string;
          url?: string;
          transport: string;
          authType: string;
          apiKey?: string;
          oauthProvider?: string;
        },
      ) => {
        try {
          const { input } = await import("@inquirer/prompts");
          const { stage, api, tenant } = await resolveMcpContext(opts);

          let name = nameArg;
          if (!name) {
            if (!process.stdin.isTTY) {
              printError("Name is required. Pass it as a positional arg.");
              process.exit(1);
            }
            name = await input({ message: "Server name:" });
          }

          let url = opts.url;
          if (!url) {
            if (!process.stdin.isTTY) {
              printError("--url is required. Pass it as a flag.");
              process.exit(1);
            }
            url = await input({
              message: "MCP server URL:",
              validate: (v) =>
                v.startsWith("http://") || v.startsWith("https://")
                  ? true
                  : "URL must start with http:// or https://",
            });
          }

          const body: Record<string, unknown> = { name, url, transport: opts.transport };
          if (opts.authType !== "none") body.authType = opts.authType;
          if (opts.apiKey) body.apiKey = opts.apiKey;
          if (opts.oauthProvider) body.oauthProvider = opts.oauthProvider;

          printHeader("mcp add", stage);
          const result = await apiFetch(
            api.apiUrl,
            api.authSecret,
            "/api/skills/mcp-servers",
            { method: "POST", body: JSON.stringify(body) },
            { "x-tenant-slug": tenant.slug },
          );
          printSuccess(
            `MCP server "${name}" ${result.created ? "registered" : "updated"} (slug: ${result.slug})`,
          );
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  mcp
    .command("update [id]")
    .description(
      "Update an MCP server's URL / transport / auth / enabled state. Accepts UUID, slug, or name; prompts in a TTY when the positional is omitted. Preserves agent assignments (unlike remove + re-add).",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--url <url>", "New URL")
    .option("--transport <type>", "streamable-http | sse")
    .option("--auth-type <type>", "none | tenant_api_key | per_user_oauth")
    .option("--api-key <token>", "API key (for tenant_api_key auth)")
    .option("--oauth-provider <name>", "OAuth provider name (for per_user_oauth auth)")
    .option("--name <n>", "Rename")
    .option("--enable", "Enable the server")
    .option("--disable", "Disable the server (doesn't delete)")
    .addHelpText(
      "after",
      `
Examples:
  # Change URL in place (preserves agent assignments, unlike remove + re-add)
  $ thinkwork mcp update routing-server --url https://mcp.example.com/routing

  # Disable without deleting
  $ thinkwork mcp update routing-server --disable

  # Rename + change transport
  $ thinkwork mcp update 629dcee1-1e14-4b83-9907-cb529e6035f6 --name "Routing Server" --transport sse

  # Interactive — pick the server from a list
  $ thinkwork mcp update
`,
    )
    .action(
      async (
        idArg: string | undefined,
        opts: {
          stage?: string;
          tenant?: string;
          url?: string;
          transport?: string;
          authType?: string;
          apiKey?: string;
          oauthProvider?: string;
          name?: string;
          enable?: boolean;
          disable?: boolean;
        },
      ) => {
        try {
          const { stage, api, tenant } = await resolveMcpContext(opts);
          const server = await resolveServer(idArg, api, tenant.slug);

          // Build partial-patch body with only the fields the user supplied.
          const body: Record<string, unknown> = {};
          if (opts.url !== undefined) body.url = opts.url;
          if (opts.transport !== undefined) body.transport = opts.transport;
          if (opts.authType !== undefined) body.authType = opts.authType;
          if (opts.apiKey !== undefined) body.apiKey = opts.apiKey;
          if (opts.oauthProvider !== undefined) body.oauthProvider = opts.oauthProvider;
          if (opts.name !== undefined) body.name = opts.name;
          if (opts.enable) body.enabled = true;
          if (opts.disable) body.enabled = false;

          if (Object.keys(body).length === 0) {
            printError(
              "Nothing to update. Pass at least one of: --url, --transport, --auth-type, --api-key, --oauth-provider, --name, --enable, --disable.",
            );
            process.exit(1);
          }

          printHeader("mcp update", stage);
          await apiFetch(
            api.apiUrl,
            api.authSecret,
            `/api/skills/mcp-servers/${server.id}`,
            { method: "PUT", body: JSON.stringify(body) },
            { "x-tenant-slug": tenant.slug },
          );
          printSuccess(
            `Updated ${server.name} (${server.slug}) — changed ${Object.keys(body).join(", ")}.`,
          );
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  mcp
    .command("remove [id]")
    .alias("rm")
    .description(
      "Remove an MCP server. Accepts UUID, slug, or name; prompts from a list when omitted in a TTY.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  # Interactive picker
  $ thinkwork mcp remove

  # By slug (case-insensitive)
  $ thinkwork mcp remove routing-server

  # By UUID (from \`mcp list\` or --json)
  $ thinkwork mcp remove 629dcee1-1e14-4b83-9907-cb529e6035f6
`,
    )
    .action(async (idArg: string | undefined, opts: { stage?: string; tenant?: string }) => {
      try {
        const { api, tenant } = await resolveMcpContext(opts);
        const server = await resolveServer(idArg, api, tenant.slug);
        await apiFetch(
          api.apiUrl,
          api.authSecret,
          `/api/skills/mcp-servers/${server.id}`,
          { method: "DELETE" },
          { "x-tenant-slug": tenant.slug },
        );
        printSuccess(`MCP server removed: ${server.name} (${server.slug}).`);
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  mcp
    .command("test [id]")
    .description(
      "Test connection and discover tools. Accepts UUID, slug, or name; prompts from a list when omitted in a TTY.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(async (idArg: string | undefined, opts: { stage?: string; tenant?: string }) => {
      try {
        const { stage, api, tenant } = await resolveMcpContext(opts);
        const server = await resolveServer(idArg, api, tenant.slug);
        printHeader("mcp test", stage);
        const result = await apiFetch(
          api.apiUrl,
          api.authSecret,
          `/api/skills/mcp-servers/${server.id}/test`,
          { method: "POST" },
          { "x-tenant-slug": tenant.slug },
        );

        if (result.ok) {
          printSuccess(`Connection successful: ${server.name}.`);
          if (result.tools?.length) {
            console.log(chalk.bold(`\n  Discovered tools (${result.tools.length}):\n`));
            for (const t of result.tools) {
              console.log(
                `    ${chalk.cyan(t.name)}${t.description ? chalk.dim(` - ${t.description}`) : ""}`,
              );
            }
            console.log("");
          } else {
            printWarning("Server connected but reported no tools.");
          }
        } else {
          printError(`Connection failed: ${result.error}`);
          process.exit(1);
        }
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  mcp
    .command("assign [mcpServer]")
    .description(
      "Assign an MCP server to an agent. Accepts UUID, slug, or name for the server; prompts from a list when omitted in a TTY.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent ID")
    .action(
      async (
        mcpServerArg: string | undefined,
        opts: { stage?: string; tenant?: string; agent?: string },
      ) => {
        try {
          const { input } = await import("@inquirer/prompts");
          const { api, tenant } = await resolveMcpContext(opts);
          const server = await resolveServer(mcpServerArg, api, tenant.slug);

          let agent = opts.agent;
          if (!agent) {
            if (!process.stdin.isTTY) {
              printError("--agent is required. Pass it as a flag.");
              process.exit(1);
            }
            agent = await input({ message: "Agent ID:" });
          }

          const result = await apiFetch(
            api.apiUrl,
            api.authSecret,
            `/api/skills/agents/${agent}/mcp-servers`,
            { method: "POST", body: JSON.stringify({ mcpServerId: server.id }) },
          );
          printSuccess(
            `MCP server assigned to agent. (${result.created ? "new" : "updated"}) — ${server.name} → ${agent}`,
          );
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  mcp
    .command("unassign [mcpServer]")
    .description(
      "Remove an MCP server from an agent. Accepts UUID, slug, or name for the server; prompts from a list when omitted in a TTY.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent ID")
    .action(
      async (
        mcpServerArg: string | undefined,
        opts: { stage?: string; tenant?: string; agent?: string },
      ) => {
        try {
          const { input } = await import("@inquirer/prompts");
          const { api, tenant } = await resolveMcpContext(opts);
          const server = await resolveServer(mcpServerArg, api, tenant.slug);

          let agent = opts.agent;
          if (!agent) {
            if (!process.stdin.isTTY) {
              printError("--agent is required. Pass it as a flag.");
              process.exit(1);
            }
            agent = await input({ message: "Agent ID:" });
          }

          await apiFetch(
            api.apiUrl,
            api.authSecret,
            `/api/skills/agents/${agent}/mcp-servers/${server.id}`,
            { method: "DELETE" },
          );
          printSuccess(`MCP server unassigned from agent: ${server.name} ↛ ${agent}`);
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  // ---------------------------------------------------------------------------
  // `thinkwork mcp key ...` — per-tenant admin-ops MCP Bearer tokens.
  //
  // Generates/lists/revokes tokens that the admin-ops MCP server (POST
  // /mcp/admin) accepts as Bearer auth. Each token scopes inbound calls
  // to one tenant; the raw value is printed once at creation and never
  // retrievable again.
  // ---------------------------------------------------------------------------

  const key = mcp
    .command("key")
    .alias("keys")
    .description("Manage per-tenant Bearer tokens for the admin-ops MCP server.");

  key
    .command("create")
    .description(
      "Generate a new MCP admin token. Prints the raw token ONCE — save it immediately.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug or UUID")
    .option("--name <label>", 'Human label for the key (default "default")')
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork mcp key create -t acme --name ci
  $ thinkwork mcp key create -t acme --json   # token surfaces under .token

The token is shown ONCE. Hand it to the MCP client immediately; the server
stores only the SHA-256 hash. To rotate, create a new one and revoke the
old one.
`,
    )
    .action(async (opts: { stage?: string; tenant?: string; name?: string }) => {
      try {
        const ctx = await resolveMcpContext(opts);
        const client = createClient({
          apiUrl: ctx.api.apiUrl,
          authSecret: ctx.api.authSecret,
        });
        const created = await adminKeys.createAdminKey(client, ctx.tenant.slug, {
          name: opts.name,
        });
        printJson(created);
        printWarning("This token will NOT be shown again. Copy it now.");
        printSuccess(`MCP admin key created: ${chalk.bold(created.name)} (${created.id})`);
        console.log(`  ${chalk.dim("Token:")} ${chalk.cyan(created.token)}`);
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  key
    .command("list")
    .alias("ls")
    .description("List MCP admin keys for a tenant (metadata only, never the raw token).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug or UUID")
    .option("--all", "Include revoked keys")
    .action(async (opts: { stage?: string; tenant?: string; all?: boolean }) => {
      try {
        const ctx = await resolveMcpContext(opts);
        const client = createClient({
          apiUrl: ctx.api.apiUrl,
          authSecret: ctx.api.authSecret,
        });
        const all = await adminKeys.listAdminKeys(client, ctx.tenant.slug);
        const rows = opts.all ? all : all.filter((k) => !k.revoked_at);

        printJson(rows);
        printTable(rows as unknown as Array<Record<string, unknown>>, [
          { key: "name", header: "NAME" },
          { key: "id", header: "ID" },
          { key: "created_at", header: "CREATED" },
          { key: "last_used_at", header: "LAST USED" },
          { key: "revoked_at", header: "REVOKED" },
        ]);
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  key
    .command("revoke <id>")
    .description("Revoke an MCP admin key. Idempotent — revoking an already-revoked key is a no-op.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug or UUID")
    .action(async (keyId: string, opts: { stage?: string; tenant?: string }) => {
      try {
        const ctx = await resolveMcpContext(opts);
        const client = createClient({
          apiUrl: ctx.api.apiUrl,
          authSecret: ctx.api.authSecret,
        });
        await adminKeys.revokeAdminKey(client, ctx.tenant.slug, keyId);
        printSuccess(`MCP admin key revoked: ${keyId}`);
      } catch (err) {
        if (err instanceof AdminOpsError && err.status === 404) {
          printError(`Key ${keyId} not found for tenant ${opts.tenant ?? ""}`);
          process.exit(2);
        }
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // `thinkwork mcp provision` — one-shot tenant provisioning for admin-ops.
  //
  // Mints a fresh tkm_ token, stores it in Secrets Manager, and upserts the
  // tenant_mcp_servers row so the runtime picks up the admin-ops MCP for any
  // agent that gets it assigned via agent_mcp_servers. Safe to re-run —
  // rotates the key + retires the previous token.
  // ---------------------------------------------------------------------------

  mcp
    .command("provision")
    .description(
      "Provision the admin-ops MCP for a tenant: mint a new key + store in Secrets Manager + register in tenant_mcp_servers.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug or UUID (omit with --all)")
    .option(
      "--url <url>",
      "Override the MCP endpoint URL (defaults to the stage's execute-api or MCP_CUSTOM_DOMAIN)",
    )
    .option("--all", "Provision for every tenant the caller can see (backfill mode)")
    .addHelpText(
      "after",
      `
Examples:
  # One tenant (interactive picker or -t)
  $ thinkwork mcp provision -t acme

  # Explicit custom-domain URL
  $ thinkwork mcp provision -t acme --url https://mcp.thinkwork.ai/mcp/admin

  # Backfill every tenant at once
  $ thinkwork mcp provision --all

The raw token is stored in Secrets Manager and duplicated into
tenant_mcp_servers.auth_config — it is NOT printed on stdout. After
provisioning, each agent still needs the server assigned via the admin
SPA (or a future \`thinkwork mcp assign\` CLI pass).
`,
    )
    .action(async (opts: { stage?: string; tenant?: string; url?: string; all?: boolean }) => {
      try {
        if (opts.all && opts.tenant) {
          printError("--all and --tenant are mutually exclusive.");
          process.exit(1);
        }

        const stage = await resolveStage({ flag: opts.stage });
        const api = resolveApiConfig(stage);
        if (!api) process.exit(1);

        async function provisionOne(tenantIdOrSlug: string, label: string) {
          const res = await apiFetch(
            api!.apiUrl,
            api!.authSecret,
            `/api/tenants/${encodeURIComponent(tenantIdOrSlug)}/mcp-admin-provision`,
            {
              method: "POST",
              body: JSON.stringify(opts.url ? { url: opts.url } : {}),
            },
          );
          printSuccess(
            `${label}: ${res.provisioned} (tenant_mcp_servers.id=${res.tenantMcpServerId}, url=${res.url})`,
          );
          return res;
        }

        if (opts.all) {
          const tenantRows = await apiFetch(
            api!.apiUrl,
            api!.authSecret,
            "/api/tenants",
            {},
          );
          if (!Array.isArray(tenantRows) || tenantRows.length === 0) {
            printWarning("No tenants found.");
            return;
          }
          printHeader("mcp provision --all", stage);
          const results: Array<{ slug: string; ok: boolean; reason?: string }> = [];
          for (const t of tenantRows as Array<{ slug: string; name: string; id: string }>) {
            try {
              await provisionOne(t.slug, `${t.name} (${t.slug})`);
              results.push({ slug: t.slug, ok: true });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              printError(`  ✗ ${t.slug}: ${msg}`);
              results.push({ slug: t.slug, ok: false, reason: msg });
            }
          }
          const ok = results.filter((r) => r.ok).length;
          const bad = results.length - ok;
          if (bad === 0) {
            printSuccess(`All ${ok} tenants provisioned.`);
          } else {
            printWarning(`${ok}/${results.length} succeeded; ${bad} failed.`);
            process.exit(1);
          }
          return;
        }

        const tenant = await resolveTenantRest({
          flag: opts.tenant,
          stage,
          apiUrl: api!.apiUrl,
          authSecret: api!.authSecret,
        });
        await provisionOne(tenant.slug, tenant.slug);
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
