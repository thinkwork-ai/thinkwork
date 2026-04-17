/**
 * `thinkwork performance ...` — agent invocation counts, error rates, p95
 * latency, and cost over a time window.
 *
 * Scaffolded in Phase 0; ships in Phase 5.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerPerformanceCommand(program: Command): void {
  const perf = program
    .command("performance")
    .alias("perf")
    .description("Observability: per-agent invocations, errors, p95 latency, and cost.");

  perf
    .command("agents")
    .description("Performance summary for every agent in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>")
    .option("--to <iso>")
    .option("--sort <f>", "cost | errors | latency | requests", "errors")
    .action(() => notYetImplemented("performance agents", 5));

  perf
    .command("agent <id>")
    .description("Performance detail for one agent (including daily time-series).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--days <n>", "Time-series history", "14")
    .action(() => notYetImplemented("performance agent", 5));
}
