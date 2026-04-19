/**
 * `thinkwork wiki ...` — operator-facing controls for the Compounding
 * Memory (wiki) compile pipeline.
 *
 * Admin-only: the underlying GraphQL mutations assert api-key credential
 * on every call. Surfaces a clean "admin access required" message when a
 * non-admin caller runs these.
 *
 *   compile   Enqueue a compile job for one agent or fan out to all.
 *   rebuild   Archive an agent's active pages and recompile from scratch.
 *   status    Show recent compile jobs for a tenant or single agent.
 */

import { Command } from "commander";
import { runWikiCompile } from "./wiki/compile.js";
import { runWikiRebuild } from "./wiki/rebuild.js";
import { runWikiStatus } from "./wiki/status.js";

export function registerWikiCommand(program: Command): void {
	const wiki = program
		.command("wiki")
		.description(
			"Compile and rebuild agent wiki pages (Compounding Memory). Admin-only.",
		);

	wiki
		.command("compile")
		.description(
			"Enqueue a wiki compile for a single agent (--agent) or all tenant agents (--all).",
		)
		.option("-s, --stage <name>", "Deployment stage")
		.option("-t, --tenant <slug>", "Tenant slug")
		.option("--agent <id>", "Agent ID, slug, or name. Bypasses the picker.")
		.option("--all", "Fan out to every non-system agent in the tenant.")
		.option(
			"--model <id>",
			"Bedrock model ID override for this run. Defaults to server BEDROCK_MODEL_ID.",
		)
		.option(
			"--watch",
			"After enqueue, poll wiki_compile_jobs until the job reaches a terminal state (single-agent only).",
		)
		.addHelpText(
			"after",
			`
Examples:
  # Interactive: pick the agent (or "All agents") from a list
  $ thinkwork wiki compile

  # Single agent, scripted
  $ thinkwork wiki compile --tenant acme --agent agt-xyz --json

  # Fan-out across every agent in the tenant
  $ thinkwork wiki compile --tenant acme --all

  # Spike a different Bedrock model for one run
  $ thinkwork wiki compile --tenant acme --agent agt-xyz \\
      --model anthropic.claude-sonnet-4-6-v1:0
`,
		)
		.action(async (opts, cmd) => {
			const parent = cmd.parent?.parent as Command | undefined;
			await runWikiCompile({
				...opts,
				stage: opts.stage ?? parent?.opts().stage,
				json: parent?.opts().json === true,
			});
		});

	wiki
		.command("rebuild")
		.description(
			"Destructive: archive an agent's active wiki pages and enqueue a fresh compile. Single-agent only.",
		)
		.option("-s, --stage <name>", "Deployment stage")
		.option("-t, --tenant <slug>", "Tenant slug")
		.option("--agent <id>", "Agent ID, slug, or name. Bypasses the picker.")
		.option(
			"--model <id>",
			"Bedrock model ID override for the post-reset compile.",
		)
		.option("-y, --yes", "Skip the confirmation prompt.")
		.option(
			"--watch",
			"After enqueue, poll wiki_compile_jobs until the job reaches a terminal state.",
		)
		.addHelpText(
			"after",
			`
Examples:
  # Interactive confirm
  $ thinkwork wiki rebuild --tenant acme --agent agt-xyz

  # Scripted (no prompt)
  $ thinkwork wiki rebuild --tenant acme --agent agt-xyz --yes --json
`,
		)
		.action(async (opts, cmd) => {
			const parent = cmd.parent?.parent as Command | undefined;
			await runWikiRebuild({
				...opts,
				stage: opts.stage ?? parent?.opts().stage,
				json: parent?.opts().json === true,
			});
		});

	wiki
		.command("status")
		.description(
			"Show recent compile jobs for a tenant (optionally filtered to one agent).",
		)
		.option("-s, --stage <name>", "Deployment stage")
		.option("-t, --tenant <slug>", "Tenant slug")
		.option(
			"--agent <id>",
			"Restrict to a single agent. Omit for tenant-wide recent activity.",
		)
		.option("-n, --limit <n>", "Max jobs to return.", "10")
		.option("--watch", "Poll until the most-recent job reaches a terminal state.")
		.option(
			"--timeout <seconds>",
			"Max seconds to watch (default 900 = 15m).",
			"900",
		)
		.addHelpText(
			"after",
			`
Examples:
  # Tenant-wide (admin)
  $ thinkwork wiki status --tenant acme

  # Single agent, watching until a job settles
  $ thinkwork wiki status --tenant acme --agent agt-xyz --watch
`,
		)
		.action(async (opts, cmd) => {
			const parent = cmd.parent?.parent as Command | undefined;
			await runWikiStatus({
				...opts,
				stage: opts.stage ?? parent?.opts().stage,
				json: parent?.opts().json === true,
			});
		});
}
