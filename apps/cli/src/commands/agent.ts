/**
 * `thinkwork agent ...` — agent lifecycle, capabilities, skills, budgets,
 * API keys, email addresses, and version history. Implementations land
 * in apps/cli/src/commands/agent/.
 */

import { Command } from "commander";
import {
  runAgentCreate,
  runAgentDelete,
  runAgentGet,
  runAgentList,
  runAgentStatus,
  runAgentUnpause,
  runAgentUpdate,
} from "./agent/root.js";
import { runAgentCapabilitiesSet } from "./agent/capabilities.js";
import { runAgentSkillsSet } from "./agent/skills.js";
import { runAgentBudgetClear, runAgentBudgetSet } from "./agent/budget.js";
import {
  runAgentApiKeyCreate,
  runAgentApiKeyList,
  runAgentApiKeyRevoke,
} from "./agent/api-key.js";
import {
  runAgentEmailAllowlist,
  runAgentEmailDisable,
  runAgentEmailEnable,
} from "./agent/email.js";
import { runAgentVersionList, runAgentVersionRollback } from "./agent/version.js";

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command("agent")
    .alias("agents")
    .description("Manage agents — create, configure, inspect, budget, and key-rotate.");

  agent
    .command("list")
    .alias("ls")
    .description("List agents in a tenant. Cognito users see paired agents; admins see all.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--status <s>", "IDLE | BUSY | OFFLINE | ERROR")
    .option("--type <t>", "Filter by agent type (HUMAN_PAIR, TEAM_AGENT, SUB_AGENT, …)")
    .option("--include-system", "Include internal system agents")
    .option("--all", "Admin-only: list every agent in the tenant (not just paired ones)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork agent list
  $ thinkwork agent list --all
  $ thinkwork agent list --status OFFLINE --json
`,
    )
    .action(runAgentList);

  agent
    .command("get <id>")
    .description("Fetch one agent with its skills, capabilities, budget, and recent activity.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentGet);

  agent
    .command("create [name]")
    .description("Create a new agent. Prompts walkthrough for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--template <id>", "Clone from an existing template (REQUIRED)")
    .option("--role <role>", "Role description shown to users")
    .option("--type <type>", "TEAM_AGENT | SUB_AGENT | HUMAN_PAIR")
    .option("--parent <agentId>", "Parent agent (for SUB_AGENT)")
    .option("--reports-to <agentId>", "Reporting manager (for org-chart display)")
    .option("--system-prompt <text>", "Raw system-prompt override (use with care)")
    .option("--system-prompt-file <path>", "Load the system prompt from a file")
    .option("--model <id>", "Model ID override (carried in runtimeConfig.model)")
    .addHelpText(
      "after",
      `
Examples:
  # From a template (required)
  $ thinkwork agent create "Ops Analyst" --template tpl-ops-analyst

  # With overrides
  $ thinkwork agent create "Bot" --template tpl-base --role "on-call summarizer" \\
      --type TEAM_AGENT --system-prompt-file prompts/bot.md
`,
    )
    .action(runAgentCreate);

  agent
    .command("update <id>")
    .description("Update any mutable agent field.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--role <r>")
    .option("--type <t>")
    .option("--parent <agentId>")
    .option("--reports-to <agentId>")
    .option("--system-prompt <text>")
    .option("--system-prompt-file <path>")
    .option("--model <id>")
    .action(runAgentUpdate);

  agent
    .command("delete <id>")
    .description("Archive (soft-delete) an agent. Existing threads stay; no new work routed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runAgentDelete);

  agent
    .command("status <id> <status>")
    .description("Manually set agent status (IDLE | BUSY | OFFLINE | ERROR).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork agent status agt-ops IDLE
  $ thinkwork agent status agt-ops OFFLINE
`,
    )
    .action(runAgentStatus);

  agent
    .command("unpause <id>")
    .description("Resume an agent paused by a budget policy trigger (sets status: IDLE).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentUnpause);

  // ----- Capabilities -------------------------------------------------------
  const capabilities = agent
    .command("capabilities")
    .alias("cap")
    .description("Toggle built-in capabilities (email inbox, web search, etc.).");
  capabilities
    .command("set <agentId>")
    .description("Enable/disable capabilities on an agent (read-modify-write the full list).")
    .option("--capability <name>", "Capability name (email, web-search, file-upload, …)")
    .option("--enabled", "Enable")
    .option("--disabled", "Disable")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentCapabilitiesSet);

  // ----- Skills -------------------------------------------------------------
  const skills = agent
    .command("skills")
    .description("Attach or configure MCP-backed skills on an agent.");
  skills
    .command("set <agentId>")
    .description("Enable/disable/configure a skill for an agent.")
    .option("--skill <id>", "Skill ID (see `thinkwork skill list`)")
    .option("--enabled", "Enable")
    .option("--disabled", "Disable")
    .option("--config <json>", "Inline JSON config for the skill")
    .option("--rate-limit <rpm>", "Rate limit in requests/min")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentSkillsSet);

  // ----- Budget -------------------------------------------------------------
  const budget = agent
    .command("budget")
    .description("Per-agent spend caps — pause or alert when exceeded.");
  budget
    .command("set <agentId>")
    .description("Set or update an agent's budget policy.")
    .option("--limit-usd <amount>", "USD ceiling for the window")
    .option("--window <w>", "daily | weekly | monthly", "monthly")
    .option("--action <a>", "PAUSE | ALERT", "PAUSE")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentBudgetSet);
  budget
    .command("clear <agentId>")
    .description("Remove an agent's budget policy (falls back to tenant-wide).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentBudgetClear);

  // ----- API keys -----------------------------------------------------------
  const apiKey = agent
    .command("api-key")
    .description("Agent API keys — service-to-service credentials tied to one agent.");
  apiKey
    .command("list <agentId>")
    .description("List API keys for an agent (metadata only; plaintext shown on create).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentApiKeyList);
  apiKey
    .command("create <agentId>")
    .description("Generate a new API key. The plaintext is printed once — save it.")
    .option("--name <n>", "Human label for the key (e.g. 'GitHub Actions')")
    .option("--expires <iso>", "Expiration (currently a no-op; AgentApiKey has no expiry field)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork agent api-key create agt-ops --name "GitHub Actions"
  $ thinkwork agent api-key create agt-ops --name "nightly" --json
`,
    )
    .action(runAgentApiKeyCreate);
  apiKey
    .command("revoke <keyId>")
    .description("Revoke an API key. Subsequent calls return 401.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runAgentApiKeyRevoke);

  // ----- Email --------------------------------------------------------------
  const email = agent
    .command("email")
    .description("Inbound email addresses — let an agent receive email + optionally reply.");
  email
    .command("enable <agentId>")
    .description("Enable inbound email for an agent. With --local-part, also claims a vanity address.")
    .option("--local-part <x>", "Custom localpart (e.g. ops@)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentEmailEnable);
  email
    .command("disable <agentId>")
    .description("Disable inbound email for an agent (releases vanity address if claimed).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runAgentEmailDisable);
  email
    .command("allowlist <agentId> <senders...>")
    .description("Replace the allowlist of sender email addresses for an agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork agent email allowlist agt-ops oncall@example.com pagerduty@example.com
`,
    )
    .action(runAgentEmailAllowlist);

  // ----- Versions -----------------------------------------------------------
  const version = agent
    .command("version")
    .description("Agent configuration version history.");
  version
    .command("list <agentId>")
    .description("List version snapshots of an agent's config.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max versions", "20")
    .action(runAgentVersionList);
  version
    .command("rollback <agentId> <versionId>")
    .description("Restore an agent to a prior version. Creates a new version pointing at the old config.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runAgentVersionRollback);
}
