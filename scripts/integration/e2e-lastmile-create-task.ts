#!/usr/bin/env npx tsx
/**
 * End-to-end verification for LastMile task sync-on-create.
 *
 * Simulates the mobile workflow-picker flow:
 *
 *   1. `createThread` GraphQL mutation with `channel='task'`,
 *      `createdByType='user'`, and `metadata.workflowId` set. That's
 *      what the mobile client sends after the user picks a workflow.
 *   2. Read back the mutation response — the resolver returns the row
 *      AFTER `syncExternalTaskOnCreate` has flipped `sync_status` to
 *      `synced`|`local`|`error` and (on success) stamped
 *      `metadata.external.externalTaskId`.
 *   3. Fetch the freshly-created task from LastMile via
 *      `GET /tasks/{externalTaskId}` to confirm the id is real.
 *
 * Requires the deployed backend to include:
 *   - `restClient.ts` updates (CreateTaskRequest: statusId + workflowId
 *     + taskTypeId + teamId required; response is `{success, id}`)
 *   - `syncExternalTaskOnCreate.ts` rewrite (workflowId gate; derives
 *     taskTypeId/teamId from `getWorkflow()` and statusId from
 *     `listStatuses()`).
 *
 * Usage:
 *   npx tsx scripts/integration/e2e-lastmile-create-task.ts \
 *     --graphql-url https://<apigw>.execute-api.us-east-1.amazonaws.com/graphql \
 *     --graphql-key <api-key> \
 *     --tenant-id <uuid> \
 *     --user-id <uuid> \
 *     --workflow-id <lastmile-workflow-id> \
 *     [--title "E2E test"] \
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
const userId = required("user-id", values["user-id"]);
const workflowId = required("workflow-id", values["workflow-id"]);
const title = values.title || `E2E task ${new Date().toISOString().replace(/[:.]/g, "-")}`;
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
	// depending on the GraphQL client/serializer. Normalized in step 2.
	metadata: string | Record<string, unknown> | null;
	type: string;
	channel: string;
};

async function step1_createThread(): Promise<Thread> {
	console.log("\n[1/3] createThread(channel=task, workflowId=%s)", workflowId);
	const input = {
		tenantId,
		title,
		description: `Automated e2e-lastmile-create-task.ts run at ${new Date().toISOString()}`,
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
		"    → thread %s  syncStatus=%s  syncError=%s",
		t.id,
		t.syncStatus,
		t.syncError ?? "(none)",
	);
	return t;
}

function step2_checkSynced(thread: Thread): string {
	console.log("\n[2/3] verify sync_status + metadata.external");
	if (thread.syncStatus !== "synced") {
		throw new Error(
			`Expected syncStatus='synced', got '${thread.syncStatus}' (error: ${thread.syncError ?? "none"})`,
		);
	}
	// `metadata` is the AWSJSON scalar. Depending on the GraphQL client /
	// serializer it may come back as either a stringified JSON payload
	// (spec-typical) or a pre-parsed object. Handle both defensively.
	const meta =
		typeof thread.metadata === "string"
			? (JSON.parse(thread.metadata) as Record<string, unknown>)
			: ((thread.metadata ?? {}) as Record<string, unknown>);
	const external = (meta.external as Record<string, unknown> | undefined) ?? undefined;
	const externalTaskId = external?.externalTaskId;
	if (typeof externalTaskId !== "string" || !externalTaskId) {
		throw new Error(
			`metadata.external.externalTaskId was not stamped (got: ${JSON.stringify(external)})`,
		);
	}
	console.log("    → synced; externalTaskId=%s", externalTaskId);
	return externalTaskId;
}

async function step3_verifyInLastmile(externalTaskId: string): Promise<void> {
	console.log("\n[3/3] GET %s/tasks/%s", lastmileBase, externalTaskId);
	if (!lastmilePat) {
		console.log(
			"    ⚠  --lastmile-pat not supplied — skipping LastMile-side confirmation.",
		);
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
		workflowId?: string;
		statusId?: string;
		assigneeId?: string | null;
	};
	console.log(
		"    → task found on LastMile: id=%s title=%j workflowId=%s statusId=%s",
		task.id,
		task.title,
		task.workflowId,
		task.statusId,
	);
}

async function main() {
	console.log("LastMile create-task sync E2E");
	console.log("  graphql:     %s", graphqlUrl);
	console.log("  tenant:      %s", tenantId);
	console.log("  user:        %s", userId);
	console.log("  workflowId:  %s", workflowId);

	const thread = await step1_createThread();
	const externalTaskId = step2_checkSynced(thread);
	await step3_verifyInLastmile(externalTaskId);

	console.log("\n✓ PASS — LastMile task %s created from thread %s", externalTaskId, thread.id);
}

main().catch((err) => {
	console.error("\n✗ FAIL —", (err as Error).message);
	process.exit(1);
});
