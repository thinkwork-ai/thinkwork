import { Command } from "commander";
import { input, select, password } from "@inquirer/prompts";
import chalk from "chalk";
import { apiFetch, resolveApiConfig } from "../api-client.js";
import { printHeader, printError, printSuccess, printWarning } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveTenantRest } from "../lib/resolve-tenant-rest.js";
import { isCancellation } from "../lib/interactive.js";

/**
 * `thinkwork tools ...` — built-in agent tool configuration (web_search, …).
 *
 * Every subcommand shares the CLI's dual-mode convention: pass stage/tenant
 * as flags for scripting / agents, or omit them interactively and get
 * arrow-key pickers. `resolveStage` + `resolveTenantRest` handle the
 * fallback (flag > env > session > picker).
 */

const TOOL_PROVIDERS: Record<string, string[]> = {
  "web-search": ["exa", "serpapi"],
};

async function resolveCtx(opts: { stage?: string; tenant?: string }) {
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

export function registerToolsCommand(program: Command): void {
  const tools = program
    .command("tools")
    .description("Configure built-in agent tools (web_search, …) for your tenant");

  tools
    .command("list")
    .alias("ls")
    .description("List configured built-in tools. Prompts for stage/tenant in a TTY when omitted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  # Interactive — picks stage + tenant
  $ thinkwork tools list

  # Scripted
  $ thinkwork tools list -s dev -t acme
  $ thinkwork tools list --json | jq '.[] | .toolSlug'
`,
    )
    .action(async (opts: { stage?: string; tenant?: string }) => {
      try {
        const { stage, api, tenant } = await resolveCtx(opts);
        printHeader("tools list", stage);

        const { tools: rows } = await apiFetch(
          api.apiUrl,
          api.authSecret,
          "/api/skills/builtin-tools",
          {},
          { "x-tenant-slug": tenant.slug },
        );

        if (!rows || rows.length === 0) {
          console.log(chalk.dim("  No built-in tools configured."));
          console.log(chalk.dim("  Try: thinkwork tools web-search set"));
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
          if (r.lastTestedAt) console.log(`    Tested:    ${new Date(r.lastTestedAt).toLocaleString()}`);
          console.log("");
        }
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ----- web-search subcommands -----

  const webSearch = tools
    .command("web-search")
    .description("Configure the web_search built-in tool");

  webSearch
    .command("set")
    .description("Set or update web_search provider + API key (enables the tool). Prompts when flags are missing in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--provider <name>", `Provider (${TOOL_PROVIDERS["web-search"].join("|")})`)
    .option("--key <key>", "API key (will prompt hidden if omitted)")
    .addHelpText(
      "after",
      `
Examples:
  # Fully interactive — stage/tenant picker, provider picker, hidden key prompt
  $ thinkwork tools web-search set

  # Scripted (secret from env)
  $ thinkwork tools web-search set -s dev -t acme --provider exa --key "$EXA_KEY"
`,
    )
    .action(
      async (opts: {
        stage?: string;
        tenant?: string;
        provider?: string;
        key?: string;
      }) => {
        try {
          const { api, tenant } = await resolveCtx(opts);

          let provider = opts.provider;
          if (!provider) {
            if (!process.stdin.isTTY) {
              printError(`--provider is required. One of: ${TOOL_PROVIDERS["web-search"].join(", ")}`);
              process.exit(1);
            }
            provider = await select({
              message: "Provider:",
              choices: TOOL_PROVIDERS["web-search"].map((p) => ({ name: p, value: p })),
              loop: false,
            });
          }
          if (!TOOL_PROVIDERS["web-search"].includes(provider)) {
            printError(`provider must be one of: ${TOOL_PROVIDERS["web-search"].join(", ")}`);
            process.exit(1);
          }

          let apiKey = opts.key;
          if (!apiKey) {
            if (!process.stdin.isTTY) {
              printError("--key is required. Pass it as a flag or pipe via env.");
              process.exit(1);
            }
            apiKey = await password({ message: `${provider} API key:`, mask: "*" });
          }
          if (!apiKey) {
            printError("API key is required");
            process.exit(1);
          }

          await apiFetch(
            api.apiUrl,
            api.authSecret,
            "/api/skills/builtin-tools/web-search",
            { method: "PUT", body: JSON.stringify({ provider, apiKey, enabled: true }) },
            { "x-tenant-slug": tenant.slug },
          );
          printSuccess(`web_search configured with provider=${provider}, enabled=true`);
          printWarning("Run `thinkwork tools web-search test` to verify connectivity.");
        } catch (err) {
          if (isCancellation(err)) return;
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  webSearch
    .command("test")
    .description("Test the stored web_search provider + key against the provider API.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(async (opts: { stage?: string; tenant?: string }) => {
      try {
        const { stage, api, tenant } = await resolveCtx(opts);
        printHeader("tools web-search test", stage);
        const result = await apiFetch(
          api.apiUrl,
          api.authSecret,
          "/api/skills/builtin-tools/web-search/test",
          { method: "POST", body: "{}" },
          { "x-tenant-slug": tenant.slug },
        );
        if (result.ok) {
          printSuccess(`${result.provider}: ${result.resultCount} result(s) returned.`);
        } else {
          printError(`Test failed: ${result.error}`);
          process.exit(1);
        }
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  webSearch
    .command("disable")
    .description("Disable web_search without deleting the stored key.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(async (opts: { stage?: string; tenant?: string }) => {
      try {
        const { api, tenant } = await resolveCtx(opts);
        await apiFetch(
          api.apiUrl,
          api.authSecret,
          "/api/skills/builtin-tools/web-search",
          { method: "PUT", body: JSON.stringify({ enabled: false }) },
          { "x-tenant-slug": tenant.slug },
        );
        printSuccess("web_search disabled.");
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  webSearch
    .command("clear")
    .description("Remove web_search config entirely (deletes stored key).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(async (opts: { stage?: string; tenant?: string }) => {
      try {
        const { api, tenant } = await resolveCtx(opts);
        await apiFetch(
          api.apiUrl,
          api.authSecret,
          "/api/skills/builtin-tools/web-search",
          { method: "DELETE" },
          { "x-tenant-slug": tenant.slug },
        );
        printSuccess("web_search configuration cleared.");
      } catch (err) {
        if (isCancellation(err)) return;
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
