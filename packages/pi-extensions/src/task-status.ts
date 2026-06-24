import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TaskStatusToolConfig {
  apiUrl?: unknown;
  apiSecret?: unknown;
  tenantId?: unknown;
  agentId?: unknown;
  threadId?: unknown;
  threadTurnId?: unknown;
}

export interface TaskStatusExtensionOptions {
  taskStatusConfig?: TaskStatusToolConfig | null;
  fetchImpl?: FetchLike;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body
    ? `HTTP ${response.status}: ${body.slice(0, 500)}`
    : `HTTP ${response.status}`;
}

export function createTaskStatusExtension(
  options: TaskStatusExtensionOptions,
): ThinkworkExtension {
  const config = options.taskStatusConfig;
  const apiUrl = asString(config?.apiUrl).replace(/\/+$/, "");
  const apiSecret = asString(config?.apiSecret);
  const tenantId = asString(config?.tenantId);
  const agentId = asString(config?.agentId);
  const threadId = asString(config?.threadId);
  const threadTurnId = asString(config?.threadTurnId);
  const enabled = Boolean(
    apiUrl && apiSecret && tenantId && agentId && threadId,
  );

  return defineExtension({
    name: "thinkwork-task-status",
    toolNames: enabled ? ["set_task_status", "set_work_item_status"] : [],
    register(pi) {
      if (!enabled) return;
      const fetchImpl = options.fetchImpl ?? fetch;

      const taskStatusTool: ToolDefinition = {
        name: "set_task_status",
        label: "Set Task Status",
        description:
          "Update a ThinkWork checklist task status through the platform database. " +
          "Use this for task/checklist progress instead of editing GOAL.md or PROGRESS.md.",
        parameters: Type.Object({
          linked_task_id: Type.String({
            description: "The linked_tasks id for the checklist row to update.",
          }),
          status: Type.String({
            description:
              "One of todo, in_progress, completed, blocked, cancelled, or not_applicable.",
          }),
          note: Type.Optional(
            Type.String({
              description: "Short reason or evidence for the status update.",
            }),
          ),
          metadata: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description: "Optional structured evidence for the update.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(toolCallId, params) {
          const typed = asRecord(params);
          const linkedTaskId = asString(typed.linked_task_id);
          const status = asString(typed.status);
          if (!linkedTaskId) {
            throw new Error("set_task_status requires linked_task_id.");
          }
          if (!status) throw new Error("set_task_status requires status.");

          const response = await fetchImpl(`${apiUrl}/api/tasks/status`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiSecret}`,
              "Content-Type": "application/json",
              "x-tenant-id": tenantId,
              "x-agent-id": agentId,
              ...(threadTurnId ? { "x-thread-turn-id": threadTurnId } : {}),
              "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
            },
            body: JSON.stringify({
              tenantId,
              agentId,
              threadId,
              threadTurnId,
              toolCallId,
              linkedTaskId,
              status,
              note: asString(typed.note) || undefined,
              metadata: asRecord(typed.metadata),
            }),
          });

          if (!response.ok) {
            throw new Error(
              `set_task_status failed: ${await readError(response)}`,
            );
          }

          const result = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          return {
            content: Array.isArray(result.content)
              ? result.content
              : [
                  {
                    type: "text",
                    text: JSON.stringify(result.details ?? result),
                  },
                ],
            details: result.details ?? result,
          };
        },
      };

      const workItemStatusTool: ToolDefinition = {
        name: "set_work_item_status",
        label: "Set Work Item Status",
        description:
          "Update a native ThinkWork Work Item status through the platform database. " +
          "Use this for Work Item progress instead of editing GOAL.md or PROGRESS.md.",
        parameters: Type.Object({
          work_item_id: Type.String({
            description: "The native work_items id to update.",
          }),
          status_category: Type.Optional(
            Type.String({
              description: "One of todo, active, blocked, done, or skipped.",
            }),
          ),
          status_id: Type.Optional(
            Type.String({
              description:
                "Optional exact Space-specific work_item_statuses id. If set, it wins over status_category.",
            }),
          ),
          note: Type.Optional(
            Type.String({
              description: "Short reason or evidence for the status update.",
            }),
          ),
          metadata: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description: "Optional structured evidence for the update.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(toolCallId, params) {
          const typed = asRecord(params);
          const workItemId = asString(typed.work_item_id);
          const statusCategory = asString(typed.status_category);
          const statusId = asString(typed.status_id);
          if (!workItemId) {
            throw new Error("set_work_item_status requires work_item_id.");
          }
          if (!statusCategory && !statusId) {
            throw new Error(
              "set_work_item_status requires status_category or status_id.",
            );
          }

          const response = await fetchImpl(`${apiUrl}/api/work-items/status`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiSecret}`,
              "Content-Type": "application/json",
              "x-tenant-id": tenantId,
              "x-agent-id": agentId,
              ...(threadTurnId ? { "x-thread-turn-id": threadTurnId } : {}),
              "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
            },
            body: JSON.stringify({
              tenantId,
              agentId,
              threadId,
              threadTurnId,
              toolCallId,
              workItemId,
              statusCategory: statusCategory || undefined,
              statusId: statusId || undefined,
              note: asString(typed.note) || undefined,
              metadata: asRecord(typed.metadata),
            }),
          });

          if (!response.ok) {
            throw new Error(
              `set_work_item_status failed: ${await readError(response)}`,
            );
          }

          const result = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          return {
            content: Array.isArray(result.content)
              ? result.content
              : [
                  {
                    type: "text",
                    text: JSON.stringify(result.details ?? result),
                  },
                ],
            details: result.details ?? result,
          };
        },
      };

      pi.registerTool(taskStatusTool);
      pi.registerTool(workItemStatusTool);
    },
  });
}
