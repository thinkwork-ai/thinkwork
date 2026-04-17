/**
 * `thinkwork message ...` — messages within a thread.
 *
 * Scaffolded in Phase 0; ships in Phase 1.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerMessageCommand(program: Command): void {
  const msg = program
    .command("message")
    .alias("messages")
    .alias("msg")
    .description("Send and list messages inside a thread.");

  msg
    .command("send <threadId> [content]")
    .description("Send a message to a thread. Prompts for content if omitted and TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--file <path>", "Read message content from a file")
    .option("--as-agent <id>", "Send as a specific agent (api-key auth only)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork message send thr-abc "Investigating now"
  $ thinkwork message send thr-abc --file notes.md
  $ thinkwork message send thr-abc                    # interactive
`,
    )
    .action(() => notYetImplemented("message send", 1));

  msg
    .command("list <threadId>")
    .alias("ls")
    .description("List messages in a thread (paginated).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max messages to return", "50")
    .option("--cursor <c>", "Pagination cursor from a previous page")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork message list thr-abc
  $ thinkwork message list thr-abc --limit 10 --json | jq '.[].author'
`,
    )
    .action(() => notYetImplemented("message list", 1));
}
