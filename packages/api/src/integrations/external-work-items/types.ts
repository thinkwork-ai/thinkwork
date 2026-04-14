/**
 * External work-item integration types.
 *
 * Normalized task model + bounded block grammar + adapter interface used by
 * all external task providers (LastMile first; Linear/Jira/Asana post-MVP).
 *
 * The adapter layer produces normalized data; the renderer consumes a bounded
 * envelope contract; the UI emits ThinkWork-native action types.
 *
 * Source: .prds/external-task-integration.md §8.3.1
 */

export type TaskProvider = "lastmile" | "linear" | "jira" | "asana";

export type TaskActionType =
	| "external_task.update_status"
	| "external_task.assign"
	| "external_task.comment"
	| "external_task.edit_fields"
	| "external_task.refresh";

export type TaskFieldType =
	| "text"
	| "textarea"
	| "badge"
	| "select"
	| "user"
	| "date"
	| "chips"
	| "boolean"
	| "hidden";

export type TaskOption = {
	value: string;
	label: string;
	color?: string;
	metadata?: Record<string, unknown>;
};

export type TaskFieldSpec = {
	key: string;
	label: string;
	type: TaskFieldType;
	value?: unknown;
	editable?: boolean;
	required?: boolean;
	placeholder?: string;
	helpText?: string;
	badgeColor?: string;
	multiple?: boolean;
	options?: TaskOption[];
	metadata?: Record<string, unknown>;
};

export type TaskActionSpec = {
	id: string;
	type: TaskActionType;
	label: string;
	variant?: "primary" | "secondary" | "ghost" | "danger";
	formId?: string;
	params?: Record<string, unknown>;
	confirm?: {
		title: string;
		body?: string;
		confirmLabel?: string;
	};
};

export type TaskFormField = {
	key: string;
	label: string;
	type: Exclude<TaskFieldType, "badge">;
	required?: boolean;
	defaultValue?: unknown;
	placeholder?: string;
	helpText?: string;
	hidden?: boolean;
	options?: TaskOption[];
	loadOptions?: {
		source: "static" | "provider";
		resource?: string;
		params?: Record<string, unknown>;
	};
	validation?: {
		minLength?: number;
		maxLength?: number;
		pattern?: string;
	};
};

export type TaskFormSchema = {
	id: string;
	title: string;
	description?: string;
	submitLabel: string;
	cancelLabel?: string;
	actionType: TaskActionType;
	fields: TaskFormField[];
};

export type TaskBlock =
	| {
			type: "task_header";
			title?: string;
			showSource?: boolean;
			showUpdatedAt?: boolean;
	  }
	| {
			type: "field_list";
			title?: string;
			fieldKeys: string[];
			columns?: 1 | 2;
	  }
	| {
			type: "badge_row";
			fieldKeys: string[];
	  }
	| {
			type: "activity_list";
			title?: string;
			path?: string;
			limit?: number;
	  }
	| {
			type: "action_bar";
			actionIds: string[];
	  }
	| {
			type: "form";
			formId: string;
	  }
	| {
			type: "section";
			title?: string;
			blocks: TaskBlock[];
	  }
	| {
			type: "empty_state";
			title: string;
			body?: string;
			actionId?: string;
	  };

export type NormalizedTask = {
	core: {
		id: string;
		provider: TaskProvider;
		title: string;
		description?: string;
		status?: { value: string; label: string; color?: string };
		priority?: { value: string; label: string; color?: string };
		assignee?: { id?: string; name: string; email?: string };
		dueAt?: string;
		url?: string;
		updatedAt?: string;
	};
	capabilities: {
		getTask?: boolean;
		listTasks?: boolean;
		updateStatus?: boolean;
		assignTask?: boolean;
		commentOnTask?: boolean;
		editTaskFields?: boolean;
		createTask?: boolean;
	};
	fields: TaskFieldSpec[];
	actions: TaskActionSpec[];
	forms?: {
		edit?: TaskFormSchema;
		comment?: TaskFormSchema;
	};
	extensions?: {
		providerFields?: TaskFieldSpec[];
		workflow?: Record<string, unknown>;
		activity?: Record<string, unknown>;
	};
	raw?: Record<string, unknown>;
};

export type ExternalTaskEnvelope = {
	_type: "external_task";
	_source?: {
		provider: TaskProvider;
		tool: string;
		params: Record<string, unknown>;
	};
	item: NormalizedTask;
	blocks: TaskBlock[];
	_refreshedAt?: string;
};

/**
 * Adapter-normalized inbound webhook payload. Identifies which external task
 * an event is about without leaking provider-specific shape to the caller.
 */
export type NormalizedEvent = {
	kind:
		| "task.created"
		| "task.assigned"
		| "task.reassigned"
		| "task.updated"
		| "task.status_changed"
		| "task.commented"
		| "task.closed";
	externalTaskId: string;
	providerUserId?: string;
	previousProviderUserId?: string;
	/** Provider-side unique delivery id (for idempotency + cross-reference). */
	providerEventId?: string;
	receivedAt: string;
	raw?: Record<string, unknown>;
};

/**
 * Context passed to adapter methods that need to reach the provider (read or
 * write). Built by the resolver / webhook pipeline from a thread + connection.
 */
export type AdapterCallContext = {
	tenantId: string;
	userId?: string;
	connectionId?: string;
	/** Per-user OAuth access token — required for mutating calls. */
	authToken?: string;
};

export interface ExternalWorkItemAdapter {
	readonly provider: TaskProvider;

	verifySignature(req: {
		rawBody: string;
		headers: Record<string, string>;
		/** Per-tenant signing secret from `webhooks.config.secret`, if configured. */
		secret?: string;
	}): Promise<boolean>;

	normalizeEvent(rawBody: string): Promise<NormalizedEvent>;

	normalizeItem(raw: Record<string, unknown>): NormalizedTask;

	buildFormSchema(item: NormalizedTask): TaskFormSchema;

	buildBlocks(item: NormalizedTask): TaskBlock[];

	executeAction(args: {
		actionType: TaskActionType;
		externalTaskId: string;
		params: Record<string, unknown>;
		ctx: AdapterCallContext;
	}): Promise<ExternalTaskEnvelope>;

	refresh(args: {
		externalTaskId: string;
		ctx: AdapterCallContext;
	}): Promise<ExternalTaskEnvelope>;
}
