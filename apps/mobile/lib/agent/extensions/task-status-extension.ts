import {
  PlatformToolClientError,
  callPlatformTaskStatus,
  callPlatformWorkItemStatus,
  platformToolContentToText,
  type PlatformToolDeps,
} from "../../platform-tools-client";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { JsonSchema, ToolResult } from "../types";

export interface TaskStatusExtensionOptions {
  agentId: string;
  threadId: string;
  deps?: PlatformToolDeps & {
    callTool?: typeof callPlatformTaskStatus;
    callWorkItemTool?: typeof callPlatformWorkItemStatus;
  };
}

const TASK_STATUS_PARAMETERS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    linked_task_id: {
      type: "string",
      description: "The linked_tasks id for the checklist row to update.",
    },
    status: {
      type: "string",
      description:
        "One of todo, in_progress, completed, blocked, cancelled, or not_applicable.",
    },
    note: {
      type: "string",
      description: "Short reason or evidence for the status update.",
    },
    metadata: {
      type: "object",
      description: "Optional structured evidence for the update.",
    },
  },
  required: ["linked_task_id", "status"],
};

const WORK_ITEM_STATUS_PARAMETERS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    work_item_id: {
      type: "string",
      description: "The native work_items id to update.",
    },
    status_category: {
      type: "string",
      description: "One of todo, active, blocked, done, or skipped.",
    },
    status_id: {
      type: "string",
      description:
        "Optional exact Space-specific work_item_statuses id. If set, it wins over status_category.",
    },
    note: {
      type: "string",
      description: "Short reason or evidence for the status update.",
    },
    metadata: {
      type: "object",
      description: "Optional structured evidence for the update.",
    },
  },
  required: ["work_item_id"],
};

function formatStatusToolError(toolName: string, err: unknown): ToolResult {
  if (err instanceof PlatformToolClientError) {
    if (err.kind === "auth") {
      return {
        content: `${toolName} failed: your session is unavailable or expired. Sign in again, then retry.`,
        isError: true,
      };
    }
    if (err.kind === "transport") {
      return {
        content: `${toolName} failed: platform transport error. ${err.message}`,
        isError: true,
      };
    }
  }
  return {
    content: `${toolName} failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
    isError: true,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function taskStatusExtension(
  options: TaskStatusExtensionOptions,
): ExtensionFactory {
  const deps = options.deps ?? {};
  const callTool = deps.callTool ?? callPlatformTaskStatus;
  const callWorkItemTool = deps.callWorkItemTool ?? callPlatformWorkItemStatus;

  return defineExtension({
    name: "task-status",
    description: "Exposes ThinkWork task status updates to the mobile Pi host.",
    toolNames: ["set_task_status", "set_work_item_status"],
    register(pi) {
      pi.registerTool({
        name: "set_task_status",
        description:
          "Update a ThinkWork checklist task status through the platform database. Use this for task/checklist progress instead of editing GOAL.md or PROGRESS.md.",
        parameters: TASK_STATUS_PARAMETERS,
        execute: async (args) => {
          const linkedTaskId =
            typeof args.linked_task_id === "string"
              ? args.linked_task_id.trim()
              : "";
          const status =
            typeof args.status === "string" ? args.status.trim() : "";
          if (!linkedTaskId) {
            return {
              content: "set_task_status requires linked_task_id.",
              isError: true,
            };
          }
          if (!status) {
            return {
              content: "set_task_status requires status.",
              isError: true,
            };
          }

          try {
            const result = await callTool(
              {
                agentId: options.agentId,
                threadId: options.threadId,
                linkedTaskId,
                status,
                note: typeof args.note === "string" ? args.note.trim() : null,
                metadata: recordValue(args.metadata),
              },
              deps,
            );
            return {
              content: platformToolContentToText(result.content),
              isError: result.isError === true,
            };
          } catch (err) {
            return formatStatusToolError("set_task_status", err);
          }
        },
      });

      pi.registerTool({
        name: "set_work_item_status",
        description:
          "Update a native ThinkWork Work Item status through the platform database. Use this for Work Item progress instead of editing GOAL.md or PROGRESS.md.",
        parameters: WORK_ITEM_STATUS_PARAMETERS,
        execute: async (args) => {
          const workItemId =
            typeof args.work_item_id === "string"
              ? args.work_item_id.trim()
              : "";
          const statusCategory =
            typeof args.status_category === "string"
              ? args.status_category.trim()
              : "";
          const statusId =
            typeof args.status_id === "string" ? args.status_id.trim() : "";
          if (!workItemId) {
            return {
              content: "set_work_item_status requires work_item_id.",
              isError: true,
            };
          }
          if (!statusCategory && !statusId) {
            return {
              content:
                "set_work_item_status requires status_category or status_id.",
              isError: true,
            };
          }

          try {
            const result = await callWorkItemTool(
              {
                agentId: options.agentId,
                threadId: options.threadId,
                workItemId,
                statusCategory: statusCategory || null,
                statusId: statusId || null,
                note: typeof args.note === "string" ? args.note.trim() : null,
                metadata: recordValue(args.metadata),
              },
              deps,
            );
            return {
              content: platformToolContentToText(result.content),
              isError: result.isError === true,
            };
          } catch (err) {
            return formatStatusToolError("set_work_item_status", err);
          }
        },
      });
    },
  });
}
