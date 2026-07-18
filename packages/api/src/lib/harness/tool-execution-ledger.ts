import { getDb } from "@thinkwork/database-pg";
import { harnessToolExecutionEvents } from "@thinkwork/database-pg/schema";
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

export interface AppendToolExecutionStartedInput
  extends ToolExecutionCorrelation {
  input: unknown;
  inputAllowPaths: readonly string[];
  forbiddenValues?: readonly string[];
}

export interface AppendToolExecutionTerminalInput
  extends ToolExecutionCorrelation {
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
