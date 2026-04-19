/**
 * Shared context + scope resolution for `thinkwork wiki ...` subcommands.
 *
 * Mirrors `apps/cli/src/commands/eval/helpers.ts` — same stage + tenant +
 * urql-client flow, plus an agent-scope resolver specific to wiki ops
 * (single agent, fan-out to all agents, flag-or-picker).
 */

import { select } from "@inquirer/prompts";
import type { Client } from "@urql/core";
import { loadStageSession } from "../../cli-config.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { getGqlClient, gqlQuery } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isUuid } from "../../lib/resolve-identifier.js";
import { printError } from "../../ui.js";
import { AllTenantAgentsForWikiDoc, TenantBySlugDoc } from "./gql.js";

// ─── Option shapes ───────────────────────────────────────────────────────────

export interface WikiCliOptions {
	stage?: string;
	region?: string;
	tenant?: string;
	agent?: string;
	all?: boolean;
	model?: string;
	json?: boolean;
}

export interface WikiCliContext {
	stage: string;
	region: string;
	client: Client;
	tenantId: string;
	tenantSlug: string;
}

export type WikiScope =
	| { mode: "single"; agentId: string; agentLabel: string }
	| { mode: "all"; agentIds: string[]; agentLabels: Record<string, string> };

// ─── Stage + tenant resolution ───────────────────────────────────────────────

export async function resolveWikiContext(
	opts: WikiCliOptions,
): Promise<WikiCliContext> {
	const region = opts.region ?? "us-east-1";
	const stage = await resolveStage({ flag: opts.stage, region });
	const session = loadStageSession(stage);
	const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({
		stage,
		region,
	});

	const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
	if (flagOrEnv) {
		if (session?.tenantSlug === flagOrEnv && session.tenantId) {
			return {
				stage,
				region,
				client,
				tenantId: session.tenantId,
				tenantSlug: flagOrEnv,
			};
		}
		const data = await gqlQuery(client, TenantBySlugDoc, { slug: flagOrEnv });
		if (!data.tenantBySlug) {
			printError(`Tenant "${flagOrEnv}" not found.`);
			process.exit(1);
		}
		return {
			stage,
			region,
			client,
			tenantId: data.tenantBySlug.id,
			tenantSlug: data.tenantBySlug.slug,
		};
	}

	if (session?.tenantId && session.tenantSlug) {
		return {
			stage,
			region,
			client,
			tenantId: session.tenantId,
			tenantSlug: session.tenantSlug,
		};
	}

	if (ctxTenantSlug) {
		const data = await gqlQuery(client, TenantBySlugDoc, {
			slug: ctxTenantSlug,
		});
		if (data.tenantBySlug) {
			return {
				stage,
				region,
				client,
				tenantId: data.tenantBySlug.id,
				tenantSlug: data.tenantBySlug.slug,
			};
		}
	}

	printError(
		`No tenant resolved for stage "${stage}". Pass --tenant <slug>, set THINKWORK_TENANT, or run \`thinkwork login --stage ${stage}\`.`,
	);
	process.exit(1);
}

// ─── Agent scope resolution ──────────────────────────────────────────────────

interface AgentListItem {
	id: string;
	name: string;
	slug?: string | null;
	type?: string | null;
	status?: string | null;
}

/**
 * Resolve the agent scope for a wiki op. Precedence:
 *   1. `--agent <id|slug|name>` → single.
 *   2. `--all` → fan out to every tenant agent.
 *   3. TTY → prompt for "All agents" or a specific agent.
 *   4. Non-TTY with neither flag → exit 1 with a clear missing-flag message.
 *
 * Pass `allowAll=false` to disable the "All agents" option (e.g. `rebuild`
 * is single-agent only — fan-out rebuild across a tenant is a footgun).
 */
export async function resolveAgentScope(
	ctx: WikiCliContext,
	opts: WikiCliOptions,
	config: { allowAll?: boolean } = {},
): Promise<WikiScope> {
	const allowAll = config.allowAll ?? true;

	// Paths that need the agent list: --agent by name, --all, and the picker.
	const needList =
		(opts.agent != null && !isUuid(opts.agent)) ||
		opts.all === true ||
		(opts.agent == null && !opts.all);

	let agents: AgentListItem[] = [];
	const loadAgents = async (): Promise<AgentListItem[]> => {
		const data = await gqlQuery(ctx.client, AllTenantAgentsForWikiDoc, {
			tenantId: ctx.tenantId,
		});
		return (data.allTenantAgents ?? []) as AgentListItem[];
	};

	if (opts.agent) {
		if (isUuid(opts.agent)) {
			return {
				mode: "single",
				agentId: opts.agent,
				agentLabel: opts.agent,
			};
		}
		agents = await loadAgents();
		const needle = opts.agent.toLowerCase();
		const matches = agents.filter((a) =>
			[a.name, a.slug].some(
				(v) => v != null && String(v).toLowerCase() === needle,
			),
		);
		if (matches.length === 0) {
			printError(
				`Agent "${opts.agent}" not found. Pass the UUID or a matching name/slug.`,
			);
			process.exit(1);
		}
		if (matches.length > 1) {
			printError(
				`"${opts.agent}" matches ${matches.length} agents. Pass the UUID instead — candidates: ${matches
					.map((a) => a.id)
					.join(", ")}`,
			);
			process.exit(1);
		}
		return {
			mode: "single",
			agentId: matches[0].id,
			agentLabel: matches[0].name ?? matches[0].id,
		};
	}

	if (opts.all) {
		if (!allowAll) {
			printError(
				"--all is not supported for this command. Rebuild one agent at a time.",
			);
			process.exit(1);
		}
		if (!needList) agents = await loadAgents();
		else if (agents.length === 0) agents = await loadAgents();
		return {
			mode: "all",
			agentIds: agents.map((a) => a.id),
			agentLabels: Object.fromEntries(
				agents.map((a) => [a.id, a.name ?? a.id]),
			),
		};
	}

	if (!isInteractive()) {
		requireTty(allowAll ? "Agent (or --all)" : "Agent");
		// requireTty exits; unreachable.
		throw new Error("unreachable");
	}

	agents = await loadAgents();
	if (agents.length === 0) {
		printError("No agents found for this tenant.");
		process.exit(1);
	}

	type Choice = { name: string; value: string };
	const choices: Choice[] = [];
	if (allowAll) {
		choices.push({ name: "All agents (fan out)", value: "__all__" });
	}
	for (const a of agents) {
		const label = a.name ?? a.id;
		const slugPart = a.slug ? `  (${a.slug})` : "";
		choices.push({ name: `${label}${slugPart}  [${a.id}]`, value: a.id });
	}

	const pick = await promptOrExit(() =>
		select({
			message: "Which agent?",
			choices,
			loop: false,
		}),
	);

	if (pick === "__all__") {
		return {
			mode: "all",
			agentIds: agents.map((a) => a.id),
			agentLabels: Object.fromEntries(
				agents.map((a) => [a.id, a.name ?? a.id]),
			),
		};
	}

	const picked = agents.find((a) => a.id === pick)!;
	return {
		mode: "single",
		agentId: picked.id,
		agentLabel: picked.name ?? picked.id,
	};
}

// ─── Error classification ────────────────────────────────────────────────────

export interface ClassifiedError {
	forbidden: boolean;
	message: string;
}

/**
 * Map a GraphQL / network error into a shape the CLI can act on consistently.
 * The backend's admin assertions throw `WikiAuthError` with "Admin-only" or
 * "Access denied" in the message — match on those.
 */
export function classifyMutationError(err: unknown): ClassifiedError {
	const message = (err as { message?: string })?.message ?? String(err);
	const forbidden =
		/Admin-only|Access denied|tenant mismatch|outside tenant/i.test(message);
	return { forbidden, message };
}

export function printForbiddenHint(tenantSlug: string): void {
	printError(
		`Admin access to tenant "${tenantSlug}" is required for wiki operations. Ask your tenant owner to promote your membership or use an admin API key.`,
	);
}
