/**
 * `thinkwork trace ...` — LLM invocation traces for a thread or a single turn.
 *
 * Scaffolded in Phase 0; ships in Phase 5.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerTraceCommand(program: Command): void {
  const trace = program
    .command("trace")
    .description("Inspect LLM invocations (traces) for a thread or turn.");

  trace
    .command("thread <threadId>")
    .description("All LLM invocations across every turn of one thread.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--since <iso>")
    .action(() => notYetImplemented("trace thread", 5));

  trace
    .command("turn <turnId>")
    .description("LLM invocations for a single thread-turn (verbose — prompt + response + metadata).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--raw", "Print raw prompts + responses as a JSON array (useful for piping)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork trace turn ttn-abc --json | jq '.[].model'
  $ thinkwork trace turn ttn-abc --raw | jq '.[].response'
`,
    )
    .action(() => notYetImplemented("trace turn", 5));
}
