/**
 * `thinkwork skill ...` — MCP-style skills published in the catalog plus
 * tenant-installed / custom skills.
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .alias("skills")
    .description("Browse the catalog, install, upgrade, or publish custom skills.");

  skill
    .command("catalog")
    .description("Browse the public skill catalog (not tenant-scoped).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--search <q>", "Filter by keyword")
    .option("--tag <t>", "Filter by tag")
    .action(() => notYetImplemented("skill catalog", 3));

  skill
    .command("list")
    .alias("ls")
    .description("List skills installed / published in the current tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--custom-only", "Only show tenant-owned custom skills")
    .action(() => notYetImplemented("skill list", 3));

  skill
    .command("install <slug>")
    .description("Install a public skill into the tenant. Idempotent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--version <v>", "Pin to a specific version (default: latest)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork skill install web-search
  $ thinkwork skill install pagerduty --version 1.4.2
`,
    )
    .action(() => notYetImplemented("skill install", 3));

  skill
    .command("upgrade <slug>")
    .description("Upgrade an installed skill to the latest catalog version.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("skill upgrade", 3));

  skill
    .command("create [slug]")
    .description("Publish a custom tenant-scoped skill (walkthrough for missing fields in TTY).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--manifest-file <path>", "Path to the MCP server manifest JSON")
    .option("--endpoint <url>", "MCP server HTTP/SSE endpoint")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork skill create my-skill --manifest-file ./skills/my-skill.json
  $ thinkwork skill create                                   # interactive
`,
    )
    .action(() => notYetImplemented("skill create", 3));

  skill
    .command("update <slug>")
    .description("Update a custom skill's manifest, endpoint, or description.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--manifest-file <path>")
    .option("--endpoint <url>")
    .action(() => notYetImplemented("skill update", 3));

  skill
    .command("delete <slug>")
    .description("Delete a custom skill. Public catalog skills are uninstalled via this too.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("skill delete", 3));
}
