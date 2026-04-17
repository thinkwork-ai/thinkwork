import { Command } from "commander";
import chalk from "chalk";
import { apiFetch, resolveApiConfig } from "../api-client.js";
import { printHeader, printError, printSuccess, printWarning } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveTenantRest } from "../lib/resolve-tenant-rest.js";
import { isCancellation } from "../lib/interactive.js";

/**
 * `thinkwork mcp ...` — MCP (Model Context Protocol) server CRUD + agent
 * assignment.
 *
 * Every subcommand follows the CLI's dual-mode convention: pass all required
 * args as flags for scripting / agents, or omit them interactively and get
 * arrow-key pickers for stage + tenant. `resolveStage` and `resolveTenantRest`
 * handle the fallback precedence (flag > env > session > picker).
 */

/** Bundle of everything a mcp subcommand needs after resolution. */
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
  $ thinkwork mcp list -s prod -t acme --json | jq '.[].slug'
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
        for (const s of servers) {
          const status = s.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          const authLabel =
            s.authType === "per_user_oauth"
              ? `OAuth (${s.oauthProvider})`
              : s.authType === "tenant_api_key"
                ? "API Key"
                : "none";
          console.log(`  ${chalk.bold(s.name)}  ${chalk.dim(s.slug)}  ${status}`);
          console.log(`    URL:       ${s.url}`);
          console.log(`    Transport: ${s.transport}`);
          console.log(`    Auth:      ${authLabel}`);
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

  # OAuth connector (users connect from the mobile app)
  $ thinkwork mcp add lastmile --url https://mcp-dev.lastmile-tei.com/crm \\
      --auth-type per_user_oauth --oauth-provider lastmile -s dev -t acme
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
    .command("remove <id>")
    .alias("rm")
    .description("Remove an MCP server. Prompts for stage/tenant in a TTY when omitted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(async (id: string, opts: { stage?: string; tenant?: string }) => {
      try {
        const { api, tenant } = await resolveMcpContext(opts);
        await apiFetch(
          api.apiUrl,
          api.authSecret,
          `/api/skills/mcp-servers/${id}`,
          { method: "DELETE" },
          { "x-tenant-slug": tenant.slug },
        );
        printSuccess("MCP server removed.");
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  mcp
    .command("test <id>")
    .description("Test connection and discover tools. Prompts for stage/tenant in a TTY when omitted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(async (id: string, opts: { stage?: string; tenant?: string }) => {
      try {
        const { stage, api, tenant } = await resolveMcpContext(opts);
        printHeader("mcp test", stage);
        const result = await apiFetch(
          api.apiUrl,
          api.authSecret,
          `/api/skills/mcp-servers/${id}/test`,
          { method: "POST" },
          { "x-tenant-slug": tenant.slug },
        );

        if (result.ok) {
          printSuccess("Connection successful.");
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
    .command("assign <mcpServerId>")
    .description("Assign an MCP server to an agent. Prompts for stage/agent when omitted in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent ID")
    .action(
      async (mcpServerId: string, opts: { stage?: string; tenant?: string; agent?: string }) => {
        try {
          const { input } = await import("@inquirer/prompts");
          const { api } = await resolveMcpContext(opts);

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
            { method: "POST", body: JSON.stringify({ mcpServerId }) },
          );
          printSuccess(`MCP server assigned to agent. (${result.created ? "new" : "updated"})`);
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  mcp
    .command("unassign <mcpServerId>")
    .description("Remove an MCP server from an agent. Prompts for stage/agent when omitted in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent ID")
    .action(
      async (mcpServerId: string, opts: { stage?: string; tenant?: string; agent?: string }) => {
        try {
          const { input } = await import("@inquirer/prompts");
          const { api } = await resolveMcpContext(opts);

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
            `/api/skills/agents/${agent}/mcp-servers/${mcpServerId}`,
            { method: "DELETE" },
          );
          printSuccess("MCP server unassigned from agent.");
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
