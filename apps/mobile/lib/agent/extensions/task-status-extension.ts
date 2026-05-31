import {
  PlatformToolClientError,
  callPlatformTaskStatus,
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

function formatTaskStatusError(err: unknown): ToolResult {
  if (err instanceof PlatformToolClientError) {
    if (err.kind === "auth") {
      return {
        content:
          "set_task_status failed: your session is unavailable or expired. Sign in again, then retry.",
        isError: true,
      };
    }
    if (err.kind === "transport") {
      return {
        content: `set_task_status failed: platform transport error. ${err.message}`,
        isError: true,
      };
    }
  }
  return {
    content: `set_task_status failed: ${
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

  return defineExtension({
    name: "task-status",
    description: "Exposes ThinkWork task status updates to the mobile Pi host.",
    toolNames: ["set_task_status"],
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
            return formatTaskStatusError(err);
          }
        },
      });
    },
  });
}
