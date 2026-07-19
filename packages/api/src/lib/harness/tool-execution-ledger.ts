import { getDb } from "@thinkwork/database-pg";
import { harnessToolExecutionEvents } from "@thinkwork/database-pg/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  redactToolRecord,
  type ToolRecordRedactionOptions,
} from "./tool-record-redaction.js";

export type ToolExecutionPrincipalType = "user" | "service";
export type ToolExecutionTerminalStatus = "completed" | "failed" | "uncertain";

export interface ToolExecutionCorrelation {
  tenantId: string;
  threadId: string;
  turnId: string;
  principalType: ToolExecutionPrincipalType;
  principalId: string;
  toolUseId: string;
  operation: string;
  policyRevision: string;
  policyDecisionId?: string | null;
  idempotencyKey: string;
  credentialOwnerAlias?: string | null;
}

export interface ToolExecutionEventInsert {
  tenant_id: string;
  thread_id: string;
  turn_id: string;
  principal_type: ToolExecutionPrincipalType;
  principal_id: string;
  tool_use_id: string;
  operation: string;
  policy_revision: string;
  policy_decision_id: string | null;
  idempotency_key: string;
  credential_owner_alias: string | null;
  event_type: "started" | ToolExecutionTerminalStatus;
  input_preview: Record<string, unknown> | null;
  output_preview: Record<string, unknown> | null;
  error_preview: Record<string, unknown> | null;
  provider_request_id: string | null;
  duration_ms: number | null;
  provider_cost_usd: string | null;
}

export interface ToolExecutionLedgerStore {
  append(row: ToolExecutionEventInsert): Promise<{ id: string | number }>;
}

export interface AppendToolExecutionStartedInput extends ToolExecutionCorrelation {
  input: unknown;
  inputAllowPaths: readonly string[];
  forbiddenValues?: readonly string[];
}

export interface AppendToolExecutionTerminalInput extends ToolExecutionCorrelation {
  status: ToolExecutionTerminalStatus;
  output: unknown;
  outputAllowPaths: readonly string[];
  error?: unknown;
  errorAllowPaths?: readonly string[];
  forbiddenValues?: readonly string[];
  providerRequestId?: string | null;
  durationMs?: number | null;
  providerCostUsd?: string | null;
}

const CORRELATION_LIMITS: Record<
  keyof Omit<
    ToolExecutionCorrelation,
    "principalType" | "policyDecisionId" | "credentialOwnerAlias"
  >,
  number
> = {
  tenantId: 128,
  threadId: 128,
  turnId: 128,
  principalId: 512,
  toolUseId: 512,
  operation: 512,
  policyRevision: 512,
  idempotencyKey: 1024,
};

function requiredBounded(value: string, field: string, max: number): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return value;
}

function validateCorrelation(input: ToolExecutionCorrelation): void {
  for (const [field, max] of Object.entries(CORRELATION_LIMITS)) {
    requiredBounded(
      input[field as keyof typeof CORRELATION_LIMITS],
      field,
      max,
    );
  }
  if (input.policyDecisionId != null)
    requiredBounded(input.policyDecisionId, "policyDecisionId", 1024);
  if (input.credentialOwnerAlias != null)
    requiredBounded(input.credentialOwnerAlias, "credentialOwnerAlias", 512);
}

function commonRow(input: ToolExecutionCorrelation) {
  validateCorrelation(input);
  return {
    tenant_id: input.tenantId,
    thread_id: input.threadId,
    turn_id: input.turnId,
    principal_type: input.principalType,
    principal_id: input.principalId,
    tool_use_id: input.toolUseId,
    operation: input.operation,
    policy_revision: input.policyRevision,
    policy_decision_id: input.policyDecisionId ?? null,
    idempotency_key: input.idempotencyKey,
    credential_owner_alias: input.credentialOwnerAlias ?? null,
  };
}

function redactionOptions(
  allowPaths: readonly string[],
  forbiddenValues?: readonly string[],
): ToolRecordRedactionOptions {
  return { allowPaths, forbiddenValues };
}

export async function appendToolExecutionStarted(
  store: ToolExecutionLedgerStore,
  input: AppendToolExecutionStartedInput,
): Promise<{ id: string | number }> {
  const row: ToolExecutionEventInsert = {
    ...commonRow(input),
    event_type: "started",
    input_preview: redactToolRecord(
      input.input,
      redactionOptions(input.inputAllowPaths, input.forbiddenValues),
    ),
    output_preview: null,
    error_preview: null,
    provider_request_id: null,
    duration_ms: null,
    provider_cost_usd: null,
  };
  return store.append(row);
}

export async function appendToolExecutionTerminal(
  store: ToolExecutionLedgerStore,
  input: AppendToolExecutionTerminalInput,
): Promise<{ id: string | number }> {
  if (
    input.durationMs != null &&
    (!Number.isInteger(input.durationMs) || input.durationMs < 0)
  ) {
    throw new Error("durationMs must be a nonnegative integer");
  }
  if (
    input.providerCostUsd != null &&
    !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(input.providerCostUsd)
  ) {
    throw new Error("providerCostUsd must be a nonnegative decimal");
  }
  const row: ToolExecutionEventInsert = {
    ...commonRow(input),
    event_type: input.status,
    input_preview: null,
    output_preview: redactToolRecord(
      input.output,
      redactionOptions(input.outputAllowPaths, input.forbiddenValues),
    ),
    error_preview:
      input.error === undefined
        ? null
        : redactToolRecord(
            input.error,
            redactionOptions(
              input.errorAllowPaths ?? [],
              input.forbiddenValues,
            ),
          ),
    provider_request_id: input.providerRequestId ?? null,
    duration_ms: input.durationMs ?? null,
    provider_cost_usd: input.providerCostUsd ?? null,
  };
  return store.append(row);
}

type ToolExecutionDatabase = Pick<ReturnType<typeof getDb>, "insert">;

export function drizzleToolExecutionLedgerStore(
  database: ToolExecutionDatabase = getDb(),
): ToolExecutionLedgerStore {
  return {
    async append(row) {
      const [inserted] = await database
        .insert(harnessToolExecutionEvents)
        .values(row)
        .returning({ id: harnessToolExecutionEvents.id });
      if (!inserted) throw new Error("tool execution event was not inserted");
      return inserted;
    },
  };
}

export interface ToolExecutionProjectionRow {
  idempotency_key: string;
  tool_use_id: string;
  operation: string;
  policy_revision: string;
  policy_decision_id: string | null;
  credential_owner_alias: string | null;
  event_type: "started" | ToolExecutionTerminalStatus;
  input_preview: Record<string, unknown> | null;
  output_preview: Record<string, unknown> | null;
  error_preview: Record<string, unknown> | null;
  provider_request_id: string | null;
  duration_ms: number | null;
  provider_cost_usd: string | null;
}

function projectedToolName(row: ToolExecutionProjectionRow): string {
  const input = row.input_preview ?? {};
  const output = row.output_preview ?? {};
  if (typeof input.tool === "string" && input.tool.trim()) return input.tool;
  if (row.operation === "sandbox.execute_code") return "execute_code";
  if (row.operation === "mcp.tools.list") {
    const connector = String(
      input.connector ?? output.connector ?? "connector",
    );
    return `mcp_${connector}_list_tools`;
  }
  if (row.operation === "mcp.tools.call") {
    const connector = String(
      input.connector ?? output.connector ?? "connector",
    );
    const tool = String(input.tool ?? output.tool ?? "call");
    return `mcp_${connector}_${tool}`;
  }
  return row.operation.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

/**
 * Combine Harness stream telemetry with the durable governed ledger without
 * rendering the same tool use twice. The stream preserves any runtime-only
 * fields while the ledger wins for authorization, policy, and terminal
 * evidence because it is the persisted source of truth.
 */
export function mergeToolExecutionInvocations(
  streamed: Array<Record<string, unknown>>,
  governed: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const byToolUseId = new Map<string, number>();

  for (const invocation of [...streamed, ...governed]) {
    const rawId = invocation.tool_use_id;
    const toolUseId =
      typeof rawId === "string" && rawId.trim() ? rawId : null;
    if (!toolUseId) {
      merged.push(invocation);
      continue;
    }
    const existingIndex = byToolUseId.get(toolUseId);
    if (existingIndex == null) {
      byToolUseId.set(toolUseId, merged.length);
      merged.push(invocation);
      continue;
    }
    merged[existingIndex] = {
      ...merged[existingIndex],
      ...invocation,
    };
  }

  return merged;
}

function preview(value: Record<string, unknown> | null): string | undefined {
  return value && Object.keys(value).length > 0
    ? JSON.stringify(value)
    : undefined;
}

/** Collapse append-only start/terminal evidence into the finalized turn UI. */
export function projectToolExecutionInvocations(
  rows: ToolExecutionProjectionRow[],
): Array<Record<string, unknown>> {
  const grouped = new Map<
    string,
    {
      started?: ToolExecutionProjectionRow;
      terminal?: ToolExecutionProjectionRow;
    }
  >();
  for (const row of rows) {
    const entry = grouped.get(row.idempotency_key) ?? {};
    if (row.event_type === "started") entry.started = row;
    else entry.terminal = row;
    grouped.set(row.idempotency_key, entry);
  }
  return [...grouped.values()].map(({ started, terminal }) => {
    const source = started ?? terminal!;
    const status = terminal?.event_type ?? "running";
    return {
      tool_name: projectedToolName(started ?? source),
      status,
      operation: source.operation,
      tool_use_id: source.tool_use_id,
      policy_revision: source.policy_revision,
      ...(source.policy_decision_id
        ? { policy_decision_id: source.policy_decision_id }
        : {}),
      ...(source.credential_owner_alias
        ? { credential_owner_alias: source.credential_owner_alias }
        : {}),
      ...(terminal?.duration_ms != null
        ? { duration_ms: terminal.duration_ms }
        : {}),
      ...(terminal?.provider_cost_usd != null
        ? { cost_usd: Number(terminal.provider_cost_usd) }
        : {}),
      ...(terminal?.provider_request_id
        ? { provider_request_id: terminal.provider_request_id }
        : {}),
      ...(preview(started?.input_preview ?? null)
        ? { input_preview: preview(started?.input_preview ?? null) }
        : {}),
      ...(preview(terminal?.output_preview ?? null)
        ? { output_preview: preview(terminal?.output_preview ?? null) }
        : {}),
      ...(preview(terminal?.error_preview ?? null)
        ? { error_preview: preview(terminal?.error_preview ?? null) }
        : {}),
      evidence_source: "harness_tool_execution_events",
    };
  });
}

export async function loadTurnToolExecutionInvocations(input: {
  tenantId: string;
  threadId: string;
  turnId: string;
}): Promise<Array<Record<string, unknown>>> {
  const rows = await getDb()
    .select({
      idempotency_key: harnessToolExecutionEvents.idempotency_key,
      tool_use_id: harnessToolExecutionEvents.tool_use_id,
      operation: harnessToolExecutionEvents.operation,
      policy_revision: harnessToolExecutionEvents.policy_revision,
      policy_decision_id: harnessToolExecutionEvents.policy_decision_id,
      credential_owner_alias: harnessToolExecutionEvents.credential_owner_alias,
      event_type: harnessToolExecutionEvents.event_type,
      input_preview: harnessToolExecutionEvents.input_preview,
      output_preview: harnessToolExecutionEvents.output_preview,
      error_preview: harnessToolExecutionEvents.error_preview,
      provider_request_id: harnessToolExecutionEvents.provider_request_id,
      duration_ms: harnessToolExecutionEvents.duration_ms,
      provider_cost_usd: harnessToolExecutionEvents.provider_cost_usd,
    })
    .from(harnessToolExecutionEvents)
    .where(
      and(
        eq(harnessToolExecutionEvents.tenant_id, input.tenantId),
        eq(harnessToolExecutionEvents.thread_id, input.threadId),
        eq(harnessToolExecutionEvents.turn_id, input.turnId),
      ),
    )
    .orderBy(asc(harnessToolExecutionEvents.id));
  return projectToolExecutionInvocations(rows as ToolExecutionProjectionRow[]);
}
