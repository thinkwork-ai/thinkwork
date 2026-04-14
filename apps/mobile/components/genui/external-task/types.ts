/**
 * Client-side mirror of the API's external-task types.
 *
 * Mirrored (not imported) because mobile builds run independently of the api
 * package. Keep in sync with packages/api/src/integrations/external-work-items/types.ts
 * — the canonical source lives there.
 */

export type TaskProvider = 'lastmile' | 'linear' | 'jira' | 'asana';

export type TaskActionType =
  | 'external_task.update_status'
  | 'external_task.assign'
  | 'external_task.comment'
  | 'external_task.edit_fields'
  | 'external_task.refresh';

export type TaskFieldType =
  | 'text'
  | 'textarea'
  | 'badge'
  | 'select'
  | 'user'
  | 'date'
  | 'chips'
  | 'boolean'
  | 'hidden';

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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
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
  type: Exclude<TaskFieldType, 'badge'>;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  hidden?: boolean;
  options?: TaskOption[];
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
  | { type: 'task_header'; title?: string; showSource?: boolean; showUpdatedAt?: boolean }
  | { type: 'field_list'; title?: string; fieldKeys: string[]; columns?: 1 | 2 }
  | { type: 'badge_row'; fieldKeys: string[] }
  | { type: 'activity_list'; title?: string; path?: string; limit?: number }
  | { type: 'action_bar'; actionIds: string[] }
  | { type: 'form'; formId: string }
  | { type: 'section'; title?: string; blocks: TaskBlock[] }
  | { type: 'empty_state'; title: string; body?: string; actionId?: string };

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
  _type: 'external_task';
  _source?: {
    provider: TaskProvider;
    tool: string;
    params: Record<string, unknown>;
  };
  item: NormalizedTask;
  blocks: TaskBlock[];
  _refreshedAt?: string;
};
