/**
 * LastMile webhook payload → NormalizedEvent.
 *
 * Phase 1 delivers enough mapping to unblock Phase 4 plumbing. When a real
 * LastMile webhook sample lands in __fixtures__/ tighten field names and
 * pull the LastMile kind → our `NormalizedEvent.kind` mapping into a table.
 */

import type { NormalizedEvent } from "../../types.js";

type LastmileEventKind =
	| "task.created"
	| "task.assigned"
	| "task.reassigned"
	| "task.updated"
	| "task.status_changed"
	| "task.commented"
	| "task.closed";

const KIND_ALIAS: Record<string, LastmileEventKind> = {
	created: "task.created",
	assigned: "task.assigned",
	reassigned: "task.reassigned",
	updated: "task.updated",
	"status-changed": "task.status_changed",
	status_changed: "task.status_changed",
	commented: "task.commented",
	closed: "task.closed",
};

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

export async function normalizeLastmileEvent(rawBody: string): Promise<NormalizedEvent> {
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		throw new Error("[lastmile] webhook body is not valid JSON");
	}

	const rawKind =
		asString(payload.event) ??
		asString(payload.type) ??
		asString((payload.data as Record<string, unknown> | undefined)?.event) ??
		"updated";

	const kind = (KIND_ALIAS[rawKind] ?? `task.${rawKind}`) as LastmileEventKind;

	const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
	const task = (data.task as Record<string, unknown> | undefined) ?? data;

	const externalTaskId =
		asString(task.id) ??
		asString(task.task_id) ??
		asString((payload as Record<string, unknown>).task_id) ??
		"";
	if (!externalTaskId) {
		throw new Error("[lastmile] webhook payload missing task id");
	}

	const assignee = (task.assignee as Record<string, unknown> | undefined) ?? undefined;
	const providerUserId =
		asString(assignee?.id) ??
		asString((data.new_assignee as Record<string, unknown> | undefined)?.id);
	const previousProviderUserId = asString(
		(data.previous_assignee as Record<string, unknown> | undefined)?.id,
	);

	return {
		kind,
		externalTaskId,
		providerUserId,
		previousProviderUserId,
		receivedAt: new Date().toISOString(),
		raw: payload,
	};
}
