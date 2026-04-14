/**
 * External work-item adapter registry.
 *
 * Caller uses only `getAdapter(provider)` — no call site should reference a
 * provider module directly. Adding a new provider = register here.
 */

import type { ExternalWorkItemAdapter, TaskProvider } from "./types.js";
import { lastmileAdapter } from "./providers/lastmile/index.js";

const adapters: Record<TaskProvider, ExternalWorkItemAdapter | undefined> = {
	lastmile: lastmileAdapter,
	linear: undefined,
	jira: undefined,
	asana: undefined,
};

export function getAdapter(provider: TaskProvider): ExternalWorkItemAdapter {
	const adapter = adapters[provider];
	if (!adapter) {
		throw new Error(`[external-work-items] No adapter registered for provider: ${provider}`);
	}
	return adapter;
}

export function hasAdapter(provider: string): provider is TaskProvider {
	return provider in adapters && adapters[provider as TaskProvider] !== undefined;
}

export type {
	AdapterCallContext,
	ExternalTaskEnvelope,
	ExternalWorkItemAdapter,
	NormalizedEvent,
	NormalizedTask,
	TaskActionSpec,
	TaskActionType,
	TaskBlock,
	TaskFieldSpec,
	TaskFieldType,
	TaskFormField,
	TaskFormSchema,
	TaskOption,
	TaskProvider,
} from "./types.js";
