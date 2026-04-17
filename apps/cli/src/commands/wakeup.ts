/**
 * `thinkwork wakeup ...` — queued agent wakeup requests (explicit / deferred).
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerWakeupCommand(program: Command): void {
  const wake = program
    .command("wakeup")
    .alias("wakeups")
    .description("View and create agent wakeup requests (deferred/enqueued invocations).");

  wake
    .command("list")
    .alias("ls")
    .description("List queued wakeups in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("wakeup list", 3));

  wake
    .command("create")
    .description("Queue a wakeup for an agent (ad-hoc or deferred).")
    .option("--agent <id>", "Target agent")
    .option("--thread <id>", "Thread to operate on (optional)")
    .option("--delay-seconds <n>", "Wait N seconds before firing", "0")
    .option("--payload <json>", "Optional input payload")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork wakeup create --agent agt-ops --thread thr-abc
  $ thinkwork wakeup create --agent agt-ops --delay-seconds 900   # fire in 15 min
`,
    )
    .action(() => notYetImplemented("wakeup create", 3));
}
