/**
 * `thinkwork agent ...` — agent lifecycle, capabilities, skills, budgets,
 * API keys, email addresses, and version history.
 *
 * Scaffolded in Phase 0; ships in Phase 2.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

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
  # Agents you're paired with
  $ thinkwork agent list

  # Tenant-wide (admin only)
  $ thinkwork agent list --all

  # Offline agents only, as JSON
  $ thinkwork agent list --status OFFLINE --json
`,
    )
    .action(() => notYetImplemented("agent list", 2));

  agent
    .command("get <id>")
    .description("Fetch one agent with its skills, capabilities, budget, and recent activity.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent get", 2));

  agent
    .command("create [name]")
    .description("Create a new agent. Prompts walkthrough for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--template <id>", "Clone from an existing template (strongly recommended)")
    .option("--role <role>", "Role description shown to users")
    .option("--type <type>", "TEAM_AGENT | SUB_AGENT | HUMAN_PAIR")
    .option("--parent <agentId>", "Parent agent (for SUB_AGENT)")
    .option("--reports-to <agentId>", "Reporting manager (for org-chart display)")
    .option("--system-prompt <text>", "Raw system-prompt override (use with care)")
    .option("--system-prompt-file <path>", "Load the system prompt from a file")
    .option("--model <id>", "Model ID override (see `thinkwork config models`)")
    .addHelpText(
      "after",
      `
Examples:
  # Fully interactive
  $ thinkwork agent create

  # From a template (recommended)
  $ thinkwork agent create "Ops Analyst" --template tpl-ops-analyst

  # Scripted, raw system prompt
  $ thinkwork agent create "Bot" --role "on-call summarizer" \\
      --type TEAM_AGENT --model claude-sonnet-4-6 \\
      --system-prompt-file prompts/bot.md
`,
    )
    .action(() => notYetImplemented("agent create", 2));

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
    .action(() => notYetImplemented("agent update", 2));

  agent
    .command("delete <id>")
    .description("Archive (soft-delete) an agent. Existing threads stay; no new work routed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("agent delete", 2));

  agent
    .command("status <id> <status>")
    .description("Manually set agent status. Useful to pause/resume.")
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
    .action(() => notYetImplemented("agent status", 2));

  agent
    .command("unpause <id>")
    .description("Resume an agent paused by a budget policy trigger.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent unpause", 2));

  // ----- Capabilities -------------------------------------------------------

  const capabilities = agent
    .command("capabilities")
    .alias("cap")
    .description("Toggle built-in capabilities (email inbox, web search, etc.).");

  capabilities
    .command("set <agentId>")
    .description("Enable/disable capabilities on an agent.")
    .option("--capability <name>", "Capability name (email, web-search, file-upload, …)")
    .option("--enabled", "Enable (default if flag present)")
    .option("--disabled", "Disable")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent capabilities set", 2));

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
    .option("--rate-limit <rps>", "Rate limit in requests/sec")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent skills set", 2));

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
    .action(() => notYetImplemented("agent budget set", 2));

  budget
    .command("clear <agentId>")
    .description("Remove an agent's budget policy (falls back to tenant-wide).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent budget clear", 2));

  // ----- API keys -----------------------------------------------------------

  const apiKey = agent
    .command("api-key")
    .description("Agent API keys — service-to-service credentials tied to one agent.");

  apiKey
    .command("list <agentId>")
    .description("List API keys for an agent (metadata only; plaintext shown on create).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent api-key list", 2));

  apiKey
    .command("create <agentId>")
    .description("Generate a new API key. The plaintext is printed once — save it.")
    .option("--name <n>", "Human label for the key (e.g. 'GitHub Actions')")
    .option("--expires <iso>", "Expiration (ISO-8601). Omit for no expiry.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork agent api-key create agt-ops --name "GitHub Actions"
  $ thinkwork agent api-key create agt-ops --name "nightly" --expires 2026-12-31T00:00:00Z --json
`,
    )
    .action(() => notYetImplemented("agent api-key create", 2));

  apiKey
    .command("revoke <keyId>")
    .description("Revoke an API key. Subsequent calls return 401.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("agent api-key revoke", 2));

  // ----- Email --------------------------------------------------------------

  const email = agent
    .command("email")
    .description("Inbound email addresses — let an agent receive email + optionally reply.");

  email
    .command("enable <agentId>")
    .description("Enable inbound email for an agent.")
    .option("--local-part <x>", "Custom localpart (e.g. ops@)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent email enable", 2));

  email
    .command("disable <agentId>")
    .description("Disable inbound email for an agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("agent email disable", 2));

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
    .action(() => notYetImplemented("agent email allowlist", 2));

  // ----- Versions -----------------------------------------------------------

  const version = agent
    .command("version")
    .description("Agent configuration version history.");

  version
    .command("list <agentId>")
    .description("List version snapshots of an agent's config (prompt, model, skills, …).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max versions", "20")
    .action(() => notYetImplemented("agent version list", 2));

  version
    .command("rollback <agentId> <versionId>")
    .description("Restore an agent to a prior version. Creates a new version pointing at the old config.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("agent version rollback", 2));
}
