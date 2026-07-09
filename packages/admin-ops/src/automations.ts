/**
 * Automation write operations (THINK-227 U10, KTD9).
 *
 * Typed functions the admin-ops MCP write tools wrap. The write seam is the
 * `saveAgentLoop` / `deleteAgentLoop` GraphQL mutations — the SAME path the
 * Automations editor uses, so agent-created automations are canonical rows
 * with identical validation, versioning, schedule provisioning (synchronous
 * EventBridge errors included), and the U11 role-split authorization.
 *
 * Reads deliberately do NOT live here: the shipped `automations_list` /
 * `automation_get` tools read Aurora directly (packages/lambda/
 * automations-tools.ts) by design; the write path needs the resolver's
 * validation + authz, so it takes the GraphQL transport instead.
 */
import type { AdminOpsClient } from "./client.js";

export interface AutomationDocumentBindingInput {
  mode: "create" | "existing";
  genre?: string;
  title?: string;
  spaceId?: string;
  artifactId?: string;
}

export interface SaveAutomationInput {
  tenantId: string;
  /** Update an existing automation; omit to create. */
  automationId?: string;
  name: string;
  description?: string;
  /** The agent-turn objective the automation pursues each run. */
  instructions: string;
  /** EventBridge Scheduler CRON expression, e.g. `cron(0 9 * * ? *)`. */
  scheduleExpression: string;
  /** IANA timezone the cron evaluates in, e.g. `America/Chicago`. */
  timezone: string;
  /** Space the automation (and a create-mode document) lives in. */
  spaceId: string;
  enabled?: boolean;
  documentBinding?: AutomationDocumentBindingInput;
  /** Email delivery of the maintained document after each new edition. */
  deliveryRecipients?: string[];
  deliverySubject?: string;
}

export interface SavedAutomation {
  id: string;
  name: string;
  slug: string;
  lifecycleStatus: string;
  enabled: boolean;
}

const SAVE_AGENT_LOOP_MUTATION = `
  mutation AdminOpsSaveAutomation($input: SaveAgentLoopInput!) {
    saveAgentLoop(input: $input) {
      id
      name
      slug
      lifecycleStatus
      enabled
    }
  }
`;

const DELETE_AGENT_LOOP_MUTATION = `
  mutation AdminOpsDeleteAutomation($id: ID!) {
    deleteAgentLoop(id: $id) {
      id
      ok
    }
  }
`;

/** Time-of-day schedules must be cron — EventBridge timezones only apply to
 * cron expressions; `rate()` fires at creation-time + interval and silently
 * ignores the timezone (the exact coercion R14 forbids). */
export function validateAutomationSchedule(input: {
  scheduleExpression: string;
  timezone: string;
}): string | null {
  const expression = input.scheduleExpression.trim();
  const timezone = input.timezone.trim();
  if (!timezone) {
    return "timezone is required (IANA name, e.g. America/Chicago)";
  }
  if (!expression.startsWith("cron(")) {
    return (
      `schedule '${expression}' must be a cron() expression — EventBridge honors timezones only for cron. ` +
      `Example: daily 9:00am → cron(0 9 * * ? *) with timezone ${timezone}.`
    );
  }
  return null;
}

export async function saveAutomation(
  client: AdminOpsClient,
  input: SaveAutomationInput,
): Promise<SavedAutomation> {
  const scheduleError = validateAutomationSchedule(input);
  if (scheduleError) throw new Error(scheduleError);

  const instructions = input.instructions.trim();
  if (!instructions) throw new Error("instructions are required");

  const targetSpec: Record<string, unknown> = {
    kind: "agent_thread",
    agentThread: {
      instructions,
      threadMode: "new_per_run",
    },
    ...(input.documentBinding
      ? { documentBinding: input.documentBinding }
      : {}),
    ...(input.deliveryRecipients && input.deliveryRecipients.length > 0
      ? {
          delivery: {
            recipients: input.deliveryRecipients,
            ...(input.deliverySubject
              ? { subjectTemplate: input.deliverySubject }
              : {}),
          },
        }
      : {}),
  };

  const result = await client.graphql<{ saveAgentLoop: SavedAutomation }>(
    SAVE_AGENT_LOOP_MUTATION,
    {
      input: {
        ...(input.automationId ? { id: input.automationId } : {}),
        tenantId: input.tenantId,
        name: input.name.trim(),
        description: input.description ?? null,
        lifecycleStatus: "active",
        enabled: input.enabled ?? true,
        spaceId: input.spaceId,
        triggerSpec: {
          family: "schedule",
          enabled: input.enabled ?? true,
          source: "admin_ops_mcp",
          config: {
            scheduleType: "cron",
            scheduleExpression: input.scheduleExpression.trim(),
            timezone: input.timezone.trim(),
          },
        },
        // Legacy inputs SaveAgentLoopInput still requires; targetSpec is the
        // authoritative dispatch source. The empty worker + prompt-first
        // sourceMetadata trigger the server's default-worker inference,
        // which backfills targetSpec.agentThread.workerId (U10).
        goalSpec: {
          objective: instructions,
          completionCriteria: [
            "The scheduled work completed and its output was produced.",
          ],
        },
        workerSpec: { type: "agent", id: "", toolHints: [], config: {} },
        targetSpec,
        sourceMetadata: {
          createdFrom: "admin_ops_mcp",
          creationMode: "easy",
          prompt: instructions,
        },
      },
    },
  );
  return result.saveAgentLoop;
}

export async function deleteAutomation(
  client: AdminOpsClient,
  input: { automationId: string },
): Promise<{ id: string; ok: boolean }> {
  const result = await client.graphql<{
    deleteAgentLoop: { id: string; ok: boolean };
  }>(DELETE_AGENT_LOOP_MUTATION, { id: input.automationId });
  return result.deleteAgentLoop;
}
