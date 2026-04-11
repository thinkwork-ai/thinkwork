import { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { validateStage } from "../config.js";
import { resolveTerraformDir } from "../environments.js";
import { resolveTierDir } from "../terraform.js";
import { printHeader, printError, printSuccess, printWarning } from "../ui.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readTfVar(tfvarsPath: string, key: string): string | null {
  if (!existsSync(tfvarsPath)) return null;
  const content = readFileSync(tfvarsPath, "utf-8");
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

function resolveTfvarsPath(stage: string): string {
  const tfDir = resolveTerraformDir(stage);
  if (tfDir) {
    const direct = `${tfDir}/terraform.tfvars`;
    if (existsSync(direct)) return direct;
  }
  const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
  const cwd = resolveTierDir(terraformDir, stage, "app");
  return `${cwd}/terraform.tfvars`;
}

function getApiEndpoint(stage: string, region: string): string | null {
  try {
    const raw = execSync(
      `aws apigatewayv2 get-apis --region ${region} --query "Items[?Name=='thinkwork-${stage}-api'].ApiEndpoint|[0]" --output text`,
      { encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return raw && raw !== "None" ? raw : null;
  } catch {
    return null;
  }
}

async function apiFetch(
  apiUrl: string,
  authSecret: string,
  path: string,
  options: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSecret}`,
      ...extraHeaders,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function resolveApiConfig(stage: string): { apiUrl: string; authSecret: string } | null {
  const tfvarsPath = resolveTfvarsPath(stage);
  const authSecret = readTfVar(tfvarsPath, "api_auth_secret");
  if (!authSecret) {
    printError(`Cannot read api_auth_secret from ${tfvarsPath}`);
    return null;
  }

  const region = readTfVar(tfvarsPath, "region") || "us-east-1";
  const apiUrl = getApiEndpoint(stage, region);
  if (!apiUrl) {
    printError(`Cannot discover API endpoint for stage "${stage}". Is the stack deployed?`);
    return null;
  }

  return { apiUrl, authSecret };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("Manage MCP servers for your tenant");

  // thinkwork mcp list -s <stage> --tenant <slug>
  mcp
    .command("list")
    .description("List registered MCP servers")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("mcp list", opts.stage);

      try {
        const { servers } = await apiFetch(api.apiUrl, api.authSecret, "/api/skills/mcp-servers", {}, { "x-tenant-slug": opts.tenant });

        if (!servers || servers.length === 0) {
          console.log(chalk.dim("  No MCP servers registered."));
          return;
        }

        console.log("");
        for (const s of servers) {
          const status = s.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          const authLabel = s.authType === "per_user_oauth" ? `OAuth (${s.oauthProvider})` : s.authType === "tenant_api_key" ? "API Key" : "none";
          console.log(`  ${chalk.bold(s.name)}  ${chalk.dim(s.slug)}  ${status}`);
          console.log(`    URL:       ${s.url}`);
          console.log(`    Transport: ${s.transport}`);
          console.log(`    Auth:      ${authLabel}`);
          if (s.tools?.length) {
            console.log(`    Tools:     ${s.tools.length} cached`);
          }
          console.log("");
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp add <name> --url <url> --tenant <slug> -s <stage>
  mcp
    .command("add <name>")
    .description("Register an MCP server")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .requiredOption("--url <url>", "MCP server URL")
    .option("--transport <type>", "Transport type (streamable-http|sse)", "streamable-http")
    .option("--auth-type <type>", "Auth type (none|tenant_api_key|per_user_oauth)", "none")
    .option("--api-key <token>", "API key (for tenant_api_key auth)")
    .option("--oauth-provider <name>", "OAuth provider name (for per_user_oauth auth)")
    .action(async (name: string, opts: {
      stage: string; tenant: string; url: string; transport: string;
      authType: string; apiKey?: string; oauthProvider?: string;
    }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      const body: Record<string, unknown> = {
        name,
        url: opts.url,
        transport: opts.transport,
      };
      if (opts.authType !== "none") body.authType = opts.authType;
      if (opts.apiKey) body.apiKey = opts.apiKey;
      if (opts.oauthProvider) body.oauthProvider = opts.oauthProvider;

      try {
        const result = await apiFetch(api.apiUrl, api.authSecret, "/api/skills/mcp-servers", {
          method: "POST",
          body: JSON.stringify(body),
        }, { "x-tenant-slug": opts.tenant });
        printSuccess(`MCP server "${name}" ${result.created ? "registered" : "updated"} (slug: ${result.slug})`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp remove <slug> --tenant <slug> -s <stage>
  mcp
    .command("remove <id>")
    .description("Remove an MCP server")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (id: string, opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      try {
        await apiFetch(api.apiUrl, api.authSecret, `/api/skills/mcp-servers/${id}`, {
          method: "DELETE",
        }, { "x-tenant-slug": opts.tenant });
        printSuccess(`MCP server removed.`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp test <id> --tenant <slug> -s <stage>
  mcp
    .command("test <id>")
    .description("Test connection and discover tools")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (id: string, opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("mcp test", opts.stage);

      try {
        const result = await apiFetch(api.apiUrl, api.authSecret, `/api/skills/mcp-servers/${id}/test`, {
          method: "POST",
        }, { "x-tenant-slug": opts.tenant });

        if (result.ok) {
          printSuccess("Connection successful.");
          if (result.tools?.length) {
            console.log(chalk.bold(`\n  Discovered tools (${result.tools.length}):\n`));
            for (const t of result.tools) {
              console.log(`    ${chalk.cyan(t.name)}${t.description ? chalk.dim(` - ${t.description}`) : ""}`);
            }
            console.log("");
          } else {
            printWarning("Server connected but reported no tools.");
          }
        } else {
          printError(`Connection failed: ${result.error}`);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp assign <mcpServerId> --agent <agentId> -s <stage>
  mcp
    .command("assign <mcpServerId>")
    .description("Assign an MCP server to an agent")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (mcpServerId: string, opts: { stage: string; agent: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      try {
        const result = await apiFetch(api.apiUrl, api.authSecret, `/api/skills/agents/${opts.agent}/mcp-servers`, {
          method: "POST",
          body: JSON.stringify({ mcpServerId }),
        });
        printSuccess(`MCP server assigned to agent. (${result.created ? "new" : "updated"})`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp unassign <mcpServerId> --agent <agentId> -s <stage>
  mcp
    .command("unassign <mcpServerId>")
    .description("Remove an MCP server from an agent")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (mcpServerId: string, opts: { stage: string; agent: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      try {
        await apiFetch(api.apiUrl, api.authSecret, `/api/skills/agents/${opts.agent}/mcp-servers/${mcpServerId}`, {
          method: "DELETE",
        });
        printSuccess("MCP server unassigned from agent.");
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
