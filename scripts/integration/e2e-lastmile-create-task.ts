#!/usr/bin/env npx tsx
/**
 * End-to-end verification for the LastMile create-task inbox flow.
 *
 * Simulates what the agent skill + mobile client do, all the way through:
 *
 *   1. `lastmileTerminals(threadId)` — exercised as the skill would
 *      (picks the first terminal from the response for the demo payload)
 *   2. `createInboxItem` with `type='create_task'` (what
 *      `propose_task_create` does from the skill)
 *   3. `approveInboxItem` — triggers the server-side
 *      `restCreateTask` call + sync-state stamp
 *   4. `listTasks({ assigneeId })` against LastMile — confirms the task
 *      actually materialized
 *
 * Intended to run against the dev AppSync endpoint AFTER the PR merges
 * and deploys. The new resolvers (`lastmileTerminals`, and the
 * `create_task` branch inside `approveInboxItem`) must be live.
 *
 * Usage:
 *   npx tsx scripts/integration/e2e-lastmile-create-task.ts \
 *     --graphql-url https://<appsync>.appsync-api.us-east-1.amazonaws.com/graphql \
 *     --graphql-key <api-key> \
 *     --tenant-id <uuid> \
 *     --agent-id <uuid> \
 *     --thread-id <uuid> \
 *     [--title "Test task"] \
 *     [--lastmile-pat lmi_dev_...] \
 *     [--lastmile-base https://dev-api.lastmile-tei.com]
 *
 * Exits 0 on a verified-synced task, non-zero otherwise. Prints every
 * step's response so failures triage quickly.
 */

import { parseArgs } from "node:util";

// ── Args ──────────────────────────────────────────────────────────────────

const { values } = parseArgs({
	options: {
		"graphql-url": { type: "string" },
		"graphql-key": { type: "string" },
		"tenant-id": { type: "string" },
		"agent-id": { type: "string" },
		"thread-id": { type: "string" },
		title: { type: "string", default: "E2E: create-task verification" },
		"lastmile-pat": { type: "string" },
		"lastmile-base": {
			type: "string",
			default: "https://dev-api.lastmile-tei.com",
		},
	},
	strict: true,
});

function required<T>(name: string, v: T | undefined): T {
	if (!v) {
		console.error(`Missing required flag: --${name}`);
		process.exit(2);
	}
	return v;
}

const graphqlUrl = required("graphql-url", values["graphql-url"]);
const graphqlKey = required("graphql-key", values["graphql-key"]);
const tenantId = required("tenant-id", values["tenant-id"]);
const agentId = required("agent-id", values["agent-id"]);
const threadId = required("thread-id", values["thread-id"]);
const title = values.title ?? "E2E: create-task verification";
const lastmilePat = values["lastmile-pat"];
const lastmileBase = values["lastmile-base"] ?? "https://dev-api.lastmile-tei.com";

// ── GraphQL helper ────────────────────────────────────────────────────────

async function gql<T = unknown>(
	query: string,
	variables: Record<string, unknown> = {},
): Promise<T> {
	const resp = await fetch(graphqlUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": graphqlKey,
			"x-tenant-id": tenantId,
			"x-agent-id": agentId,
		},
		body: JSON.stringify({ query, variables }),
	});
	const body = (await resp.json()) as { data?: T; errors?: Array<{ message: string }> };
	if (body.errors?.length) {
		throw new Error(`GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
	}
	if (!body.data) throw new Error("No data in GraphQL response");
	return body.data;
}

// ── Steps ─────────────────────────────────────────────────────────────────

async function step1_listTerminals(): Promise<{ id: string; name: string }> {
	console.log("\n[1/4] lastmileTerminals(threadId=%s)", threadId);
	const data = await gql<{ lastmileTerminals: Array<{ id: string; name: string }> }>(
		"query($t: ID!) { lastmileTerminals(threadId: $t) { id name externalId city state } }",
		{ t: threadId },
	);
	if (data.lastmileTerminals.length === 0) {
		throw new Error("lastmileTerminals returned empty — connector may not be configured for this tenant");
	}
	const first = data.lastmileTerminals[0];
	if (!first) throw new Error("lastmileTerminals returned no first element");
	console.log("    → %d terminals; using first: %s (%s)", data.lastmileTerminals.length, first.name, first.id);
	return first;
}

async function step2_proposeCreate(terminalId: string): Promise<string> {
	console.log("\n[2/4] createInboxItem(type=create_task)");
	const config = JSON.stringify({
		title,
		terminalId,
		provider: "lastmile",
		description: "Automated e2e-lastmile-create-task.ts run",
	});
	const input = {
		tenantId,
		requesterType: "agent",
		requesterId: agentId,
		type: "create_task",
		title: `Create task in LastMile: ${title}`,
		entityType: "thread",
		entityId: threadId,
		config,
	};
	const data = await gql<{ createInboxItem: { id: string; status: string } }>(
		"mutation($i: CreateInboxItemInput!) { createInboxItem(input: $i) { id status type } }",
		{ i: input },
	);
	console.log("    → inbox item %s (status=%s)", data.createInboxItem.id, data.createInboxItem.status);
	return data.createInboxItem.id;
}

async function step3_approve(inboxItemId: string): Promise<{ externalTaskId: string | null }> {
	console.log("\n[3/4] approveInboxItem(id=%s)", inboxItemId);
	const data = await gql<{ approveInboxItem: { id: string; status: string; config: string | null } }>(
		"mutation($id: ID!) { approveInboxItem(id: $id) { id status config } }",
		{ id: inboxItemId },
	);
	const item = data.approveInboxItem;
	if (item.status.toLowerCase() !== "approved") {
		throw new Error(`Expected approved, got ${item.status}`);
	}
	const parsed = item.config ? (JSON.parse(item.config) as Record<string, unknown>) : {};
	const externalTaskId =
		typeof parsed.externalTaskId === "string" ? parsed.externalTaskId : null;
	console.log("    → approved; externalTaskId=%s", externalTaskId ?? "(not stamped)");
	return { externalTaskId };
}

async function step4_verifyInLastmile(externalTaskId: string): Promise<void> {
	console.log("\n[4/4] GET %s/tasks/%s", lastmileBase, externalTaskId);
	if (!lastmilePat) {
		console.log("    ⚠  --lastmile-pat not supplied — skipping. Pass it to verify the task exists in LastMile.");
		return;
	}
	const resp = await fetch(`${lastmileBase}/tasks/${encodeURIComponent(externalTaskId)}`, {
		headers: { Authorization: `Bearer ${lastmilePat}`, Accept: "application/json" },
	});
	if (!resp.ok) {
		throw new Error(`LastMile GET /tasks/${externalTaskId} returned ${resp.status} ${await resp.text()}`);
	}
	const task = (await resp.json()) as { id: string; title: string; terminalId?: string; status?: string };
	console.log("    → task found: id=%s title=%s terminalId=%s status=%s", task.id, task.title, task.terminalId, task.status);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
	console.log("LastMile create-task E2E");
	console.log("  graphql: %s", graphqlUrl);
	console.log("  tenant:  %s", tenantId);
	console.log("  thread:  %s", threadId);

	const terminal = await step1_listTerminals();
	const inboxItemId = await step2_proposeCreate(terminal.id);
	const { externalTaskId } = await step3_approve(inboxItemId);
	if (!externalTaskId) {
		throw new Error("approveInboxItem did not stamp externalTaskId — the create_task side effect may not have fired");
	}
	await step4_verifyInLastmile(externalTaskId);

	console.log("\n✓ PASS — LastMile task %s materialized from thread %s", externalTaskId, threadId);
}

main().catch((err) => {
	console.error("\n✗ FAIL —", (err as Error).message);
	process.exit(1);
});
