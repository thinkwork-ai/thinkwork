import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { validateStage } from "../config.js";
import { apiFetch, resolveApiConfig } from "../api-client.js";
import { printHeader, printError, printSuccess, printWarning } from "../ui.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Catalog of built-in tools and providers (mirrors BUILTIN_TOOL_CATALOG in the API)
// ---------------------------------------------------------------------------

const TOOL_PROVIDERS: Record<string, string[]> = {
  "web-search": ["exa", "serpapi"],
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerToolsCommand(program: Command): void {
  const tools = program
    .command("tools")
    .description("Configure built-in agent tools (web_search, …) for your tenant");

  // thinkwork tools list --tenant <slug> -s <stage>
  tools
    .command("list")
    .description("List configured built-in tools")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("tools list", opts.stage);

      try {
        const { tools: rows } = await apiFetch(
          api!.apiUrl,
          api!.authSecret,
          "/api/skills/builtin-tools",
          {},
          { "x-tenant-slug": opts.tenant },
        );

        if (!rows || rows.length === 0) {
          console.log(chalk.dim("  No built-in tools configured."));
          console.log(chalk.dim("  Try: thinkwork tools web-search set --tenant <slug> -s <stage>"));
          return;
        }

        console.log("");
        for (const r of rows) {
          const status = r.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          const key = r.hasSecret ? chalk.green("yes") : chalk.red("no");
          const provider = r.provider ?? chalk.dim("—");
          console.log(`  ${chalk.bold(r.toolSlug)}  ${status}`);
          console.log(`    Provider:  ${provider}`);
          console.log(`    Has key:   ${key}`);
          if (r.lastTestedAt) {
            console.log(`    Tested:    ${new Date(r.lastTestedAt).toLocaleString()}`);
          }
          console.log("");
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // ----- web-search subcommands -----

  const webSearch = tools
    .command("web-search")
    .description("Configure the web_search built-in tool");

  webSearch
    .command("set")
    .description("Set or update web_search provider + API key (enables the tool)")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .option("--provider <name>", `Provider (${TOOL_PROVIDERS["web-search"].join("|")})`)
    .option("--key <key>", "API key")
    .action(async (opts: { stage: string; tenant: string; provider?: string; key?: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      let provider = opts.provider;
      if (!provider) {
        provider = (await prompt(`Provider [${TOOL_PROVIDERS["web-search"].join("/")}]: `)).toLowerCase();
      }
      if (!TOOL_PROVIDERS["web-search"].includes(provider)) {
        printError(`provider must be one of: ${TOOL_PROVIDERS["web-search"].join(", ")}`);
        process.exit(1);
      }

      let apiKey = opts.key;
      if (!apiKey) {
        apiKey = await prompt(`${provider} API key: `);
      }
      if (!apiKey) {
        printError("API key is required");
        process.exit(1);
      }

      try {
        await apiFetch(
          api!.apiUrl,
          api!.authSecret,
          "/api/skills/builtin-tools/web-search",
          {
            method: "PUT",
            body: JSON.stringify({ provider, apiKey, enabled: true }),
          },
          { "x-tenant-slug": opts.tenant },
        );
        printSuccess(`web_search configured with provider=${provider}, enabled=true`);
        printWarning("Run `thinkwork tools web-search test` to verify connectivity.");
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  webSearch
    .command("test")
    .description("Test the stored web_search provider + key against the provider API")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      printHeader("tools web-search test", opts.stage);

      try {
        const result = await apiFetch(
          api!.apiUrl,
          api!.authSecret,
          "/api/skills/builtin-tools/web-search/test",
          { method: "POST", body: "{}" },
          { "x-tenant-slug": opts.tenant },
        );
        if (result.ok) {
          printSuccess(`${result.provider}: ${result.resultCount} result(s) returned.`);
        } else {
          printError(`Test failed: ${result.error}`);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  webSearch
    .command("disable")
    .description("Disable web_search without deleting the stored key")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      try {
        await apiFetch(
          api!.apiUrl,
          api!.authSecret,
          "/api/skills/builtin-tools/web-search",
          { method: "PUT", body: JSON.stringify({ enabled: false }) },
          { "x-tenant-slug": opts.tenant },
        );
        printSuccess("web_search disabled.");
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  webSearch
    .command("clear")
    .description("Remove web_search config entirely (deletes stored key)")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .requiredOption("--tenant <slug>", "Tenant slug")
    .action(async (opts: { stage: string; tenant: string }) => {
      const check = validateStage(opts.stage);
      if (!check.valid) { printError(check.error!); process.exit(1); }

      const api = resolveApiConfig(opts.stage);
      if (!api) process.exit(1);

      try {
        await apiFetch(
          api!.apiUrl,
          api!.authSecret,
          "/api/skills/builtin-tools/web-search",
          { method: "DELETE" },
          { "x-tenant-slug": opts.tenant },
        );
        printSuccess("web_search configuration cleared.");
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
