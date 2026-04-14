/**
 * LastMile Tasks adapter.
 *
 * Phase 1 wires reads (normalizeItem, buildBlocks, buildFormSchema, refresh)
 * through the adapter registry. Phase 2 fills in `executeAction`. Phase 4
 * replaces the webhook stubs. Every MCP tool name lives in ./constants.ts.
 */

import type {
	AdapterCallContext,
	ExternalTaskEnvelope,
	ExternalWorkItemAdapter,
	NormalizedEvent,
	NormalizedTask,
	TaskActionType,
	TaskBlock,
	TaskFormSchema,
} from "../../types.js";
import { buildLastmileBlocks } from "./buildBlocks.js";
import { buildLastmileEditForm } from "./buildFormSchema.js";
import { executeLastmileAction } from "./executeAction.js";
import { normalizeLastmileEvent } from "./normalizeEvent.js";
import { normalizeLastmileTask } from "./normalizeItem.js";
import { refreshLastmileTask } from "./refresh.js";
import { verifyLastmileSignature } from "./verifySignature.js";

export const lastmileAdapter: ExternalWorkItemAdapter = {
	provider: "lastmile",

	verifySignature(req: {
		rawBody: string;
		headers: Record<string, string>;
		secret?: string;
	}): Promise<boolean> {
		return verifyLastmileSignature(req);
	},

	normalizeEvent(rawBody: string): Promise<NormalizedEvent> {
		return normalizeLastmileEvent(rawBody);
	},

	normalizeItem(raw: Record<string, unknown>): NormalizedTask {
		return normalizeLastmileTask(raw);
	},

	buildFormSchema(item: NormalizedTask): TaskFormSchema {
		return buildLastmileEditForm(item);
	},

	buildBlocks(item: NormalizedTask): TaskBlock[] {
		return buildLastmileBlocks(item);
	},

	executeAction(args: {
		actionType: TaskActionType;
		externalTaskId: string;
		params: Record<string, unknown>;
		ctx: AdapterCallContext;
	}): Promise<ExternalTaskEnvelope> {
		return executeLastmileAction(args);
	},

	refresh(args: { externalTaskId: string; ctx: AdapterCallContext }): Promise<ExternalTaskEnvelope> {
		return refreshLastmileTask(args);
	},
};
