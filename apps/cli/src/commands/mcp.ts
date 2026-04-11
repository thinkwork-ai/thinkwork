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
): Promise<any> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSecret}`,
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
    .description("Manage MCP servers for agents");

  // thinkwork mcp list -s <stage> --agent <agentId>
  mcp
    .command("list")
    .description("List MCP servers registered for an agent")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (opts: { stage: string; agent: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("mcp list", opts.stage);

      try {
        const { servers } = await apiFetch(api.apiUrl, api.authSecret, `/api/skills/agent/${opts.agent}/mcp-servers`);

        if (!servers || servers.length === 0) {
          console.log(chalk.dim("  No MCP servers registered for this agent."));
          return;
        }

        console.log("");
        for (const s of servers) {
          const status = s.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          console.log(`  ${chalk.bold(s.name)}  ${status}`);
          console.log(`    URL:       ${s.url}`);
          console.log(`    Transport: ${s.transport}`);
          console.log(`    Auth:      ${s.authType || "none"}`);
          if (s.tools?.length) {
            console.log(`    Tools:     ${s.tools.join(", ")}`);
          }
          console.log("");
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp add <name> --url <url> --agent <agentId> -s <stage>
  mcp
    .command("add <name>")
    .description("Register an MCP server for an agent")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--agent <id>", "Agent ID")
    .requiredOption("--url <url>", "MCP server URL")
    .option("--transport <type>", "Transport type (streamable-http|sse)", "streamable-http")
    .option("--auth-type <type>", "Auth type (none|bearer|api-key)", "none")
    .option("--auth-value <token>", "Auth token or API key")
    .option("--connection-id <uuid>", "OAuth connection ID")
    .option("--provider-id <uuid>", "OAuth provider ID (for connection-based auth)")
    .option("--tools <list>", "Comma-separated tool allowlist")
    .action(async (name: string, opts: {
      stage: string; agent: string; url: string; transport: string;
      authType: string; authValue?: string; connectionId?: string;
      providerId?: string; tools?: string;
    }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("mcp add", opts.stage);

      const body: Record<string, unknown> = {
        name,
        url: opts.url,
        transport: opts.transport,
        authType: opts.authType !== "none" ? opts.authType : undefined,
      };
      if (opts.authValue) body.apiKey = opts.authValue;
      if (opts.connectionId) body.connectionId = opts.connectionId;
      if (opts.providerId) body.providerId = opts.providerId;
      if (opts.tools) body.tools = opts.tools.split(",").map((t) => t.trim());

      try {
        const result = await apiFetch(api.apiUrl, api.authSecret, `/api/skills/agent/${opts.agent}/mcp-servers`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        printSuccess(`MCP server "${name}" ${result.created ? "added" : "updated"} (skill: ${result.skillId})`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp remove <name> --agent <agentId> -s <stage>
  mcp
    .command("remove <name>")
    .description("Remove an MCP server from an agent")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (name: string, opts: { stage: string; agent: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      try {
        await apiFetch(api.apiUrl, api.authSecret, `/api/skills/agent/${opts.agent}/mcp-servers/${name}`, {
          method: "DELETE",
        });
        printSuccess(`MCP server "${name}" removed.`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // thinkwork mcp test <name> --agent <agentId> -s <stage>
  mcp
    .command("test <name>")
    .description("Test connection to an MCP server and list its tools")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (name: string, opts: { stage: string; agent: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("mcp test", opts.stage);

      try {
        const result = await apiFetch(api.apiUrl, api.authSecret, `/api/skills/agent/${opts.agent}/mcp-servers/${name}/test`, {
          method: "POST",
        });

        if (result.ok) {
          printSuccess(`Connection to "${name}" successful.`);
          if (result.tools?.length) {
            console.log(chalk.bold(`\n  Available tools (${result.tools.length}):\n`));
            for (const t of result.tools) {
              console.log(`    ${chalk.cyan(t.name)}${t.description ? chalk.dim(` — ${t.description}`) : ""}`);
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
}
