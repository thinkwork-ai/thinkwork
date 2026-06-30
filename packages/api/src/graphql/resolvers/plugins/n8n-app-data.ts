import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import { discoverN8nWorkflows as discoverWorkflows } from "../../../lib/workflows/n8n-discovery.js";
import {
  discoverN8nExecutions as discoverExecutions,
  n8nNativeWorkflowUrl,
} from "../../../lib/workflows/n8n-executions.js";
import { loadN8nAgentStepRunTelemetry } from "../n8n-agent-step-runs/telemetry.js";
import { requirePluginTenantMember } from "./shared.js";

export interface N8nAppDataDeps {
  db?: typeof defaultDb;
  discoverWorkflows?: typeof discoverWorkflows;
  discoverExecutions?: typeof discoverExecutions;
  loadTelemetry?: typeof loadN8nAgentStepRunTelemetry;
}

export async function n8nAppData(
  _parent: unknown,
  args: { installId: string; executionLimit?: number | null },
  ctx: GraphQLContext,
  deps: N8nAppDataDeps = {},
) {
  const { tenantId, callerUserId } = await requirePluginTenantMember(ctx);
  if (!callerUserId) {
    throw new GraphQLError("User context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  if (
    args.executionLimit != null &&
    (!Number.isInteger(args.executionLimit) || args.executionLimit < 1)
  ) {
    throw new GraphQLError("executionLimit must be a positive integer", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const db = deps.db ?? defaultDb;
  try {
    const [workflowResult, executionResult, bridgeRuns] = await Promise.all([
      (deps.discoverWorkflows ?? discoverWorkflows)(db, {
        tenantId,
        installId: args.installId,
      }),
      (deps.discoverExecutions ?? discoverExecutions)(db, {
        tenantId,
        installId: args.installId,
        limit: args.executionLimit,
      }),
      (deps.loadTelemetry ?? loadN8nAgentStepRunTelemetry)({
        tenantId,
        pluginInstallId: args.installId,
        limit: 50,
        db,
      }),
    ]);
    const bridgeRunsByExecution = bridgeRunsByExecutionId(bridgeRuns);
    return {
      installId: args.installId,
      workflowReadinessState: workflowResult.readinessState,
      workflowReadinessReasons: workflowResult.readinessReasons,
      executionReadinessState: executionResult.readinessState,
      executionReadinessReasons: executionResult.readinessReasons,
      nativeBaseUrl: executionResult.nativeBaseUrl,
      workflows: workflowResult.workflows.map((workflow) => ({
        ...workflow,
        nativeWorkflowUrl: executionResult.nativeBaseUrl
          ? n8nNativeWorkflowUrl(
              executionResult.nativeBaseUrl,
              workflow.externalWorkflowId,
            )
          : null,
      })),
      executions: executionResult.executions.map((execution) => ({
        ...execution,
        bridgeRuns:
          bridgeRunsByExecution.get(execution.externalExecutionId)?.filter(
            (run) => run.workflowId === execution.externalWorkflowId,
          ) ?? [],
      })),
    };
  } catch (error) {
    throw new GraphQLError((error as Error).message, {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
}

function bridgeRunsByExecutionId(
  bridgeRuns: Awaited<ReturnType<typeof loadN8nAgentStepRunTelemetry>>,
) {
  const byExecution = new Map<string, typeof bridgeRuns>();
  for (const run of bridgeRuns) {
    const existing = byExecution.get(run.executionId) ?? [];
    existing.push(run);
    byExecution.set(run.executionId, existing);
  }
  return byExecution;
}
