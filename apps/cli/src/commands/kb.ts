/**
 * `thinkwork kb ...` — knowledge bases (Bedrock-backed RAG stores) and
 * agent attachments.
 *
 * Scaffolded in Phase 0; ships in Phase 2.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerKbCommand(program: Command): void {
  const kb = program
    .command("kb")
    .alias("knowledge-base")
    .description("Manage knowledge bases (RAG stores) and attach them to agents.");

  kb
    .command("list")
    .alias("ls")
    .description("List knowledge bases in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("kb list", 2));

  kb
    .command("get <id>")
    .description("Fetch one knowledge base with its S3 source + sync status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("kb get", 2));

  kb
    .command("create [name]")
    .description("Create a new knowledge base. Interactive prompts for missing fields.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--s3-uri <uri>", "S3 source location (s3://bucket/prefix)")
    .option("--description <text>")
    .option("--embedding-model <id>", "Bedrock embedding model ID")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork kb create "Runbooks" --s3-uri s3://ops-docs/runbooks
  $ thinkwork kb create                                  # interactive
`,
    )
    .action(() => notYetImplemented("kb create", 2));

  kb
    .command("update <id>")
    .description("Update knowledge base metadata (name, description). Source changes need re-create.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .action(() => notYetImplemented("kb update", 2));

  kb
    .command("delete <id>")
    .description("Delete a knowledge base. Embeddings + index are destroyed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("kb delete", 2));

  kb
    .command("sync <id>")
    .description("Re-embed from S3. Idempotent; safe to re-run.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--wait", "Block until the sync finishes")
    .action(() => notYetImplemented("kb sync", 2));

  kb
    .command("attach <kbId>")
    .description("Attach a knowledge base to an agent.")
    .requiredOption("--agent <id>", "Agent ID")
    .option("--config <json>", "Retrieval config (topK, score threshold, …)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork kb attach kb-runbooks --agent agt-oncall
  $ thinkwork kb attach kb-runbooks --agent agt-oncall --config '{"topK":5}'
`,
    )
    .action(() => notYetImplemented("kb attach", 2));

  kb
    .command("detach <kbId>")
    .description("Detach a knowledge base from an agent.")
    .requiredOption("--agent <id>", "Agent ID")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("kb detach", 2));
}
