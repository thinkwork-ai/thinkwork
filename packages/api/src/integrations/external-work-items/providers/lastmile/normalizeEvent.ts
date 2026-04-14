/**
 * LastMile webhook payload → NormalizedEvent.
 *
 * LastMile delivers a JSON array of events (usually length 1). Each element
 * carries:
 *   - eventId       — unique delivery id (dedup + cross-reference)
 *   - occurredAt    — ISO timestamp
 *   - resource      — "task"
 *   - action        — "created" | "updated" | "assigned" | "status_changed" | ...
 *   - entityId      — redundant copy of the task id
 *   - task          — { id, title, assignee_id, status_id, ... }
 *
 * For now we only normalize the FIRST element and log a warning if more
 * than one event arrives in a single delivery — batching support is a
 * follow-up. The raw body is still echoed back for debug / replay.
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
	comment_added: "task.commented",
	closed: "task.closed",
	completed: "task.closed",
	archived: "task.closed",
};

function asString(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;
}

export async function normalizeLastmileEvent(rawBody: string): Promise<NormalizedEvent> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		throw new Error("[lastmile] webhook body is not valid JSON");
	}

	// Unwrap the array — LastMile always sends `[{...}]` even for a single event.
	let outer: Record<string, unknown>;
	if (Array.isArray(parsed)) {
		if (parsed.length === 0) {
			throw new Error("[lastmile] webhook body is an empty array");
		}
		if (parsed.length > 1) {
			console.warn(
				`[lastmile] received batched delivery with ${parsed.length} events — only the first is processed in this release`,
			);
		}
		const first = parsed[0];
		if (!first || typeof first !== "object") {
			throw new Error("[lastmile] webhook body array element is not an object");
		}
		outer = first as Record<string, unknown>;
	} else if (parsed && typeof parsed === "object") {
		outer = parsed as Record<string, unknown>;
	} else {
		throw new Error("[lastmile] webhook body is not a JSON object or array");
	}

	// Prefer LastMile's native `action` field; fall back to legacy `event` / `type`
	// for older fixtures and for robustness.
	const rawKind =
		asString(outer.action) ??
		asString(outer.event) ??
		asString(outer.type) ??
		"updated";
	const kind = (KIND_ALIAS[rawKind] ?? `task.${rawKind}`) as LastmileEventKind;

	// Task object may be nested directly on the element (`outer.task`, the
	// real LastMile shape) OR wrapped in a legacy `data` envelope
	// (`outer.data.task`, older fixtures). Fall through both.
	const dataWrap = asRecord(outer.data);
	const task =
		asRecord(outer.task) ?? asRecord(dataWrap?.task) ?? dataWrap ?? outer;

	const externalTaskId =
		asString(task.id) ??
		asString(task.task_id) ??
		asString(outer.entityId) ??
		asString(outer.entity_id) ??
		asString(outer.task_id) ??
		"";
	if (!externalTaskId) {
		throw new Error("[lastmile] webhook payload missing task id");
	}

	// LastMile's current shape uses `assignee_id` directly as a string. Older
	// fixtures used a nested `assignee: { id }` object — support both, plus
	// the legacy `data.new_assignee` wrapper for reassignments.
	const assigneeObj = asRecord(task.assignee);
	const providerUserId =
		asString(task.assignee_id) ??
		asString(task.owner_id) ??
		asString(assigneeObj?.id) ??
		asString(asRecord(outer.new_assignee)?.id) ??
		asString(asRecord(dataWrap?.new_assignee)?.id);

	const previousProviderUserId = asString(
		asRecord(outer.previous_assignee)?.id ??
			asRecord(dataWrap?.previous_assignee)?.id ??
			task.previous_assignee_id ??
			outer.previous_assignee_id,
	);

	const providerEventId =
		asString(outer.eventId) ??
		asString(outer.event_id) ??
		asString(outer.outboxId) ??
		asString(outer.delivery_id);

	const receivedAt = asString(outer.occurredAt) ?? new Date().toISOString();

	return {
		kind,
		externalTaskId,
		providerUserId,
		previousProviderUserId,
		providerEventId,
		receivedAt,
		raw: outer,
	};
}
