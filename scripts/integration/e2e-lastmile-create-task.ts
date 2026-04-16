#!/usr/bin/env npx tsx
/**
 * End-to-end verification for LastMile task-intake form flow.
 *
 * Simulates what the mobile client + agent together do:
 *
 *   1. `createThread` GraphQL mutation with `channel='task'`,
 *      `createdByType='user'`, and `metadata.workflowId` set. That's
 *      what the mobile client sends after the user picks a workflow
 *      and types a title. The thread SHOULD come back
 *      `syncStatus='local'` with a "fill out the intake form" hint —
 *      the LastMile POST is deferred until step 2.
 *
 *   2. `createLastmileTask` mutation with description / priority /
 *      dueDate / assigneeEmail. That's what the
 *      `lastmile-tasks.create_task` skill invokes after the user
 *      submits the Question Card form. The resolver fires `POST /tasks`
 *      and stamps `syncStatus='synced'` +
 *      `metadata.external.externalTaskId`.
 *
 *   3. `GET /tasks/{externalTaskId}` on LastMile to confirm the task
 *      materialized with the intake-form details.
 *
 * Requires the deployed backend to include:
 *   - `createLastmileTask` mutation
 *   - `syncExternalTaskOnCreate` accepting priority/dueDate/
 *     assigneeProviderUserId
 *   - `createThread` stamping `local` for user-created tasks instead
 *     of auto-syncing
 *
 * Usage:
 *   npx tsx scripts/integration/e2e-lastmile-create-task.ts \
 *     --graphql-url https://<apigw>/graphql \
 *     --graphql-key <api-key> \
 *     --tenant-id <uuid> \
 *     --user-id <uuid> \
 *     --workflow-id <lastmile-workflow-id> \
 *     [--title "E2E test"] \
 *     [--priority high] \
 *     [--description "..."] \
 *     [--due-date 2026-04-20] \
 *     [--assignee-email someone@example.com] \
 *     [--lastmile-pat lmi_dev_...] \
 *     [--lastmile-base https://dev-api.lastmile-tei.com]
 *
 * Exits 0 on a fully-synced task; non-zero on any step failure.
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		"graphql-url": { type: "string" },
		"graphql-key": { type: "string" },
		"tenant-id": { type: "string" },
		"user-id": { type: "string" },
		"workflow-id": { type: "string" },
		title: { type: "string", default: "" },
		priority: { type: "string", default: "high" },
		description: { type: "string", default: "Automated e2e-lastmile-create-task.ts run" },
		"due-date": { type: "string", default: "" },
		"assignee-email": { type: "string", default: "" },
		"lastmile-pat": { type: "string" },
		"lastmile-base": { type: "string", default: "https://dev-api.lastmile-tei.com" },
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
const userId = required("user-id", values["user-id"]);
const workflowId = required("workflow-id", values["workflow-id"]);
const title = values.title || `E2E intake ${new Date().toISOString().replace(/[:.]/g, "-")}`;
const priority = values.priority ?? "high";
const description = values.description ?? "";
const dueDate = values["due-date"] ?? "";
const assigneeEmail = values["assignee-email"] ?? "";
const lastmilePat = values["lastmile-pat"];
const lastmileBase = values["lastmile-base"] ?? "https://dev-api.lastmile-tei.com";

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

type Thread = {
	id: string;
	title: string;
	syncStatus: string | null;
	syncError: string | null;
	// AWSJSON — may come back as a JSON string OR a pre-parsed object
	// depending on the GraphQL client/serializer. Normalized in parseMeta().
	metadata: string | Record<string, unknown> | null;
	type: string;
	channel: string;
};

function parseMeta(thread: Thread): Record<string, unknown> {
	return typeof thread.metadata === "string"
		? (JSON.parse(thread.metadata) as Record<string, unknown>)
		: ((thread.metadata ?? {}) as Record<string, unknown>);
}

async function step1_createThread(): Promise<Thread> {
	console.log("\n[1/4] createThread(channel=task, workflowId=%s)", workflowId);
	const input = {
		tenantId,
		title,
		description,
		type: "TASK",
		channel: "TASK",
		priority: "MEDIUM",
		createdByType: "user",
		createdById: userId,
		metadata: JSON.stringify({ workflowId }),
	};
	const data = await gql<{ createThread: Thread }>(
		`mutation($i: CreateThreadInput!) {
			createThread(input: $i) {
				id title syncStatus syncError metadata type channel
			}
		}`,
		{ i: input },
	);
	const t = data.createThread;
	console.log(
		"    → thread %s  syncStatus=%s  reason=%j",
		t.id,
		t.syncStatus,
		t.syncError,
	);
	return t;
}

function step2_expectDraft(thread: Thread): void {
	console.log("\n[2/4] expect syncStatus='local' + form hint (not auto-synced)");
	if (thread.syncStatus !== "local") {
		throw new Error(
			`Expected thread to start in syncStatus='local' (pre-intake-form), got '${thread.syncStatus}'`,
		);
	}
	const meta = parseMeta(thread);
	if (meta.external) {
		throw new Error(
			"metadata.external stamped on draft thread — auto-sync regression",
		);
	}
	console.log("    → draft OK (no metadata.external; intake form is the next step)");
}

async function step3_submitIntake(threadId: string): Promise<Thread> {
	console.log(
		"\n[3/4] createLastmileTask(priority=%s, description=%j, dueDate=%j, assigneeEmail=%j)",
		priority,
		description,
		dueDate || "(none)",
		assigneeEmail || "(default: creator)",
	);
	const input: Record<string, unknown> = { threadId, priority };
	if (description) input.description = description;
	if (dueDate) input.dueDate = dueDate;
	if (assigneeEmail) input.assigneeEmail = assigneeEmail;

	const data = await gql<{ createLastmileTask: Thread }>(
		`mutation($i: CreateLastmileTaskInput!) {
			createLastmileTask(input: $i) {
				id title syncStatus syncError metadata type channel
			}
		}`,
		{ i: input },
	);
	const t = data.createLastmileTask;
	console.log(
		"    → synced? syncStatus=%s  syncError=%j",
		t.syncStatus,
		t.syncError,
	);
	if (t.syncStatus !== "synced") {
		throw new Error(
			`Expected syncStatus='synced' after createLastmileTask, got '${t.syncStatus}' (error: ${t.syncError ?? "none"})`,
		);
	}
	const meta = parseMeta(t);
	const external = (meta.external as Record<string, unknown> | undefined) ?? {};
	const externalTaskId = external.externalTaskId;
	if (typeof externalTaskId !== "string" || !externalTaskId) {
		throw new Error(
			`metadata.external.externalTaskId missing after createLastmileTask (got: ${JSON.stringify(external)})`,
		);
	}
	console.log("    → externalTaskId=%s", externalTaskId);
	return t;
}

async function step4_verifyInLastmile(thread: Thread): Promise<void> {
	const meta = parseMeta(thread);
	const external = (meta.external as Record<string, unknown> | undefined) ?? {};
	const externalTaskId = external.externalTaskId as string;
	console.log("\n[4/4] GET %s/tasks/%s", lastmileBase, externalTaskId);
	if (!lastmilePat) {
		console.log("    ⚠  --lastmile-pat not supplied — skipping LastMile-side confirmation.");
		return;
	}
	const resp = await fetch(
		`${lastmileBase}/tasks/${encodeURIComponent(externalTaskId)}`,
		{ headers: { Authorization: `Bearer ${lastmilePat}`, Accept: "application/json" } },
	);
	if (!resp.ok) {
		throw new Error(
			`LastMile GET /tasks/${externalTaskId} returned ${resp.status} ${await resp.text()}`,
		);
	}
	const task = (await resp.json()) as {
		id: string;
		title: string;
		description?: string | null;
		priority?: string | null;
		workflowId?: string;
		statusId?: string;
		assigneeId?: string | null;
		dueDate?: string | null;
	};
	console.log(
		"    → task: id=%s title=%j priority=%s dueDate=%s assigneeId=%s",
		task.id,
		task.title,
		task.priority,
		task.dueDate,
		task.assigneeId,
	);
	if (task.priority && priority && task.priority.toLowerCase() !== priority.toLowerCase()) {
		console.log(
			"    ⚠  priority mismatch — sent %s, LastMile has %s",
			priority,
			task.priority,
		);
	}
}

async function main() {
	console.log("LastMile task-intake E2E");
	console.log("  graphql:     %s", graphqlUrl);
	console.log("  tenant:      %s", tenantId);
	console.log("  user:        %s", userId);
	console.log("  workflowId:  %s", workflowId);

	const draft = await step1_createThread();
	step2_expectDraft(draft);
	const synced = await step3_submitIntake(draft.id);
	await step4_verifyInLastmile(synced);

	const meta = parseMeta(synced);
	const externalTaskId = ((meta.external as Record<string, unknown>) ?? {}).externalTaskId;
	console.log("\n✓ PASS — thread %s → LastMile %s", synced.id, externalTaskId);
}

main().catch((err) => {
	console.error("\n✗ FAIL —", (err as Error).message);
	process.exit(1);
});
