import { and, eq } from "drizzle-orm";
import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { getDb } from "@thinkwork/database-pg";
import { systemWorkflowRuns } from "@thinkwork/database-pg/schema";
import {
  getSystemWorkflowDefinition,
  type SystemWorkflowDefinitionId,
} from "./registry.js";

export type SystemWorkflowDomainRef = {
  type: string;
  id: string;
};

export type StartSystemWorkflowInput = {
  workflowId: SystemWorkflowDefinitionId;
  tenantId: string;
  triggerSource: string;
  actorId?: string | null;
  actorType?: string | null;
  domainRef?: SystemWorkflowDomainRef | null;
  input?: Record<string, unknown> | null;
};

export type StartSystemWorkflowResult = {
  run: typeof systemWorkflowRuns.$inferSelect;
  started: boolean;
  deduped: boolean;
};

type SendableSfnClient = Pick<SFNClient, "send">;

export type StartSystemWorkflowOptions = {
  dbClient?: ReturnType<typeof getDb>;
  sfnClient?: SendableSfnClient;
  now?: () => Date;
  stateMachineArnForWorkflow?: (
    workflowId: SystemWorkflowDefinitionId,
  ) => string | null;
};

const DEFAULT_SFN_CLIENT = new SFNClient({});

const WORKFLOW_NAME_BY_ID: Record<SystemWorkflowDefinitionId, string> = {
  "wiki-build": "wiki-build",
  "evaluation-runs": "evaluation-runs",
  "tenant-agent-activation": "tenant-agent-activation",
};

export function systemWorkflowStateMachineArn(
  workflowId: SystemWorkflowDefinitionId,
): string | null {
  const rawMap = process.env.SYSTEM_WORKFLOW_STATE_MACHINE_ARNS;
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap) as Record<string, unknown>;
      const value = parsed[workflowId];
      if (typeof value === "string" && value.length > 0) return value;
    } catch {
      console.warn(
        "[system-workflows] invalid SYSTEM_WORKFLOW_STATE_MACHINE_ARNS JSON",
      );
    }
  }

  const envKey = `SYSTEM_WORKFLOW_${workflowId
    .toUpperCase()
    .replace(/-/g, "_")}_STATE_MACHINE_ARN`;
  const direct = process.env[envKey];
  return direct && direct.length > 0 ? direct : null;
}

export function systemWorkflowExecutionName(input: {
  workflowId: SystemWorkflowDefinitionId;
  domainRef?: SystemWorkflowDomainRef | null;
  runId: string;
}): string {
  const base = input.domainRef
    ? `${input.workflowId}-${input.domainRef.type}-${input.domainRef.id}`
    : `${input.workflowId}-${input.runId}`;
  const sanitized = base.replace(/[^0-9A-Za-z_-]/g, "-");
  return sanitized.length <= 80 ? sanitized : sanitized.slice(0, 80);
}

export async function startSystemWorkflow(
  input: StartSystemWorkflowInput,
  options: StartSystemWorkflowOptions = {},
): Promise<StartSystemWorkflowResult> {
  const definition = getSystemWorkflowDefinition(input.workflowId);
  if (!definition) {
    throw new Error(`Unknown System Workflow ${input.workflowId}`);
  }

  const db = options.dbClient ?? getDb();
  const now = options.now ?? (() => new Date());
  const stateMachineArn =
    options.stateMachineArnForWorkflow?.(input.workflowId) ??
    systemWorkflowStateMachineArn(input.workflowId);
  if (!stateMachineArn) {
    throw new Error(
      `System Workflow ${input.workflowId} has no configured state machine ARN`,
    );
  }

  const rowValues = {
    tenant_id: input.tenantId,
    workflow_id: input.workflowId,
    definition_version: definition.activeVersion,
    runtime_shape: definition.runtimeShape,
    state_machine_arn: stateMachineArn,
    trigger_source: input.triggerSource,
    actor_id: input.actorId ?? null,
    actor_type: input.actorType ?? null,
    domain_ref_type: input.domainRef?.type ?? null,
    domain_ref_id: input.domainRef?.id ?? null,
    input_json: input.input ?? {},
    status: "running",
    started_at: now(),
  };

  const inserted = await db
    .insert(systemWorkflowRuns)
    .values(rowValues)
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    const existing = await findExistingRun(db, input);
    if (!existing) {
      throw new Error(
        `System Workflow ${input.workflowId} launch conflicted but no existing run was found`,
      );
    }
    return { run: existing, started: false, deduped: true };
  }

  let run = inserted[0];
  const sfn = options.sfnClient ?? DEFAULT_SFN_CLIENT;
  try {
    const execution = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: systemWorkflowExecutionName({
          workflowId: input.workflowId,
          domainRef: input.domainRef,
          runId: run.id,
        }),
        input: JSON.stringify({
          workflowId: input.workflowId,
          workflowRunId: run.id,
          tenantId: input.tenantId,
          domainRef: input.domainRef ?? null,
          input: input.input ?? {},
          evalRunId:
            input.workflowId === "evaluation-runs" &&
            input.domainRef?.type === "eval_run"
              ? input.domainRef.id
              : undefined,
        }),
      }),
    );

    const updated = await db
      .update(systemWorkflowRuns)
      .set({
        sfn_execution_arn: execution.executionArn ?? null,
        started_at: execution.startDate ?? rowValues.started_at,
      })
      .where(eq(systemWorkflowRuns.id, run.id))
      .returning();
    run = updated[0] ?? run;
    return { run, started: true, deduped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db
      .update(systemWorkflowRuns)
      .set({
        status: "failed",
        finished_at: now(),
        error_code: err instanceof Error ? err.name : "StartExecutionError",
        error_message: message,
      })
      .where(eq(systemWorkflowRuns.id, run.id))
      .returning();
    throw new Error(
      `Failed to start System Workflow ${input.workflowId}: ${message}`,
      { cause: failed[0] ?? err },
    );
  }
}

async function findExistingRun(
  db: ReturnType<typeof getDb>,
  input: StartSystemWorkflowInput,
): Promise<typeof systemWorkflowRuns.$inferSelect | null> {
  if (!input.domainRef) return null;
  const rows = await db
    .select()
    .from(systemWorkflowRuns)
    .where(
      and(
        eq(systemWorkflowRuns.tenant_id, input.tenantId),
        eq(systemWorkflowRuns.workflow_id, input.workflowId),
        eq(systemWorkflowRuns.domain_ref_type, input.domainRef.type),
        eq(systemWorkflowRuns.domain_ref_id, input.domainRef.id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export { WORKFLOW_NAME_BY_ID };
