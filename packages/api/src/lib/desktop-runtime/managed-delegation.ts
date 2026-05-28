import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { threadTurns } from "@thinkwork/database-pg/schema";
import type {
  ManagedDelegationResponse,
  ManagedDelegationVisibility,
} from "@thinkwork/pi-runtime-core";
import { db } from "../db.js";
import { hashDesktopFinalizeToken } from "./sidecar-credentials.js";

const DEFAULT_DELEGATION_TIMEOUT_MS = 8_000;
const MAX_DELEGATION_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const STAGE = process.env.STAGE || process.env.STACK_NAME || "dev";
const CHAT_AGENT_INVOKE_FN_ARN =
  process.env.CHAT_AGENT_INVOKE_FN_ARN ||
  process.env.CHAT_AGENT_INVOKE_FUNCTION_NAME ||
  `thinkwork-${STAGE}-api-chat-agent-invoke`;

const lambdaClient = new LambdaClient({});

export interface ManagedDelegationInput {
  parentThreadTurnId: string;
  finalizeCallbackSecret: string;
  task: string;
  requestedVisibility: ManagedDelegationVisibility;
  reason?: string;
  timeoutMs?: number;
}

export interface ParentTurnRow {
  id: string;
  tenantId: string;
  agentId: string | null;
  threadId: string | null;
  status: string;
  contextSnapshot: unknown;
}

export interface DelegatedTurnResult {
  status: string;
  resultJson: unknown;
  usageJson: unknown;
  error: string | null;
}

export interface ManagedDelegationDeps {
  now(): Date;
  loadParentTurn(turnId: string): Promise<ParentTurnRow | null>;
  dispatchManagedTurn(input: {
    tenantId: string;
    agentId: string;
    threadId: string;
    parentThreadTurnId: string;
    task: string;
    requestedVisibility: ManagedDelegationVisibility;
    effectiveVisibility: ManagedDelegationVisibility;
    reason?: string;
  }): Promise<{ threadTurnId: string | null }>;
  loadDelegatedTurnResult(turnId: string): Promise<DelegatedTurnResult | null>;
  sleep(ms: number): Promise<void>;
}

export class ManagedDelegationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ManagedDelegationError";
  }
}

export function defaultManagedDelegationDeps(): ManagedDelegationDeps {
  return {
    now: () => new Date(),
    async loadParentTurn(turnId) {
      const [row] = await db
        .select({
          id: threadTurns.id,
          tenantId: threadTurns.tenant_id,
          agentId: threadTurns.agent_id,
          threadId: threadTurns.thread_id,
          status: threadTurns.status,
          contextSnapshot: threadTurns.context_snapshot,
        })
        .from(threadTurns)
        .where(eq(threadTurns.id, turnId))
        .limit(1);
      return row
        ? {
            id: row.id,
            tenantId: row.tenantId,
            agentId: row.agentId,
            threadId: row.threadId,
            status: row.status,
            contextSnapshot: row.contextSnapshot,
          }
        : null;
    },
    async dispatchManagedTurn(input) {
      const response = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: CHAT_AGENT_INVOKE_FN_ARN,
          InvocationType: "RequestResponse",
          Payload: new TextEncoder().encode(
            JSON.stringify({
              tenantId: input.tenantId,
              agentId: input.agentId,
              threadId: input.threadId,
              userMessage: input.task,
              desktopDelegation: {
                parentThreadTurnId: input.parentThreadTurnId,
                requestedVisibility: input.requestedVisibility,
                effectiveVisibility: input.effectiveVisibility,
                reason: input.reason,
              },
            }),
          ),
        }),
      );
      const raw = response.Payload
        ? new TextDecoder().decode(response.Payload)
        : "{}";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        threadTurnId:
          parsed.ok === true && typeof parsed.threadTurnId === "string"
            ? parsed.threadTurnId
            : null,
      };
    },
    async loadDelegatedTurnResult(turnId) {
      const [row] = await db
        .select({
          status: threadTurns.status,
          resultJson: threadTurns.result_json,
          usageJson: threadTurns.usage_json,
          error: threadTurns.error,
        })
        .from(threadTurns)
        .where(and(eq(threadTurns.id, turnId)))
        .limit(1);
      return row
        ? {
            status: row.status,
            resultJson: row.resultJson,
            usageJson: row.usageJson,
            error: row.error,
          }
        : null;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function runManagedDelegation(
  input: ManagedDelegationInput,
  deps: ManagedDelegationDeps = defaultManagedDelegationDeps(),
): Promise<ManagedDelegationResponse> {
  if (!input.task.trim()) {
    throw new ManagedDelegationError("task is required", 400, "BAD_REQUEST");
  }

  const parent = await deps.loadParentTurn(input.parentThreadTurnId);
  if (!parent?.agentId || !parent.threadId) {
    throw new ManagedDelegationError(
      "Parent desktop turn not found",
      404,
      "PARENT_TURN_NOT_FOUND",
    );
  }
  validateParentSidecarSession(parent, input.finalizeCallbackSecret, deps.now);

  const effectiveVisibility = chooseEffectiveVisibility(
    input.requestedVisibility,
    input.task,
  );
  const delegationId = randomUUID();
  const dispatched = await deps.dispatchManagedTurn({
    tenantId: parent.tenantId,
    agentId: parent.agentId,
    threadId: parent.threadId,
    parentThreadTurnId: parent.id,
    task: input.task,
    requestedVisibility: input.requestedVisibility,
    effectiveVisibility,
    reason: input.reason,
  });

  const childThreadTurnId = dispatched.threadTurnId;
  if (!childThreadTurnId) {
    throw new ManagedDelegationError(
      "Managed delegation dispatch did not return a child turn id",
      502,
      "DELEGATION_DISPATCH_FAILED",
    );
  }

  const base = {
    ok: true,
    delegationId,
    parentThreadTurnId: parent.id,
    childThreadTurnId,
    requestedVisibility: input.requestedVisibility,
    effectiveVisibility,
  };

  if (effectiveVisibility === "visible") {
    return { ...base, status: "accepted" };
  }

  const result = await waitForDelegationResult(
    childThreadTurnId,
    clampDelegationTimeoutMs(input.timeoutMs),
    deps,
  );
  if (!result) return { ...base, status: "accepted" };
  if (result.status === "failed") {
    return {
      ...base,
      status: "failed",
      error: result.error ?? "Managed delegation failed",
    };
  }
  if (result.status !== "succeeded") {
    return { ...base, status: "accepted" };
  }

  const resultRecord = readRecord(result.resultJson);
  const usageRecord = readRecord(result.usageJson);
  return {
    ...base,
    status: "completed",
    result: {
      content: stringValue(resultRecord?.response) ?? null,
      runtime: stringValue(resultRecord?.runtime) ?? null,
      usage: result.usageJson,
      toolInvocations: usageRecord?.tool_invocations,
      toolCosts: usageRecord?.tool_costs,
    },
  };
}

function validateParentSidecarSession(
  parent: ParentTurnRow,
  finalizeCallbackSecret: string,
  now: () => Date,
): void {
  const snapshot = readRecord(parent.contextSnapshot);
  if (snapshot?.runtime_host !== "desktop-local") {
    throw new ManagedDelegationError(
      "Parent turn is not a desktop-local turn",
      403,
      "PARENT_NOT_DESKTOP_LOCAL",
    );
  }
  if (parent.status !== "running") {
    throw new ManagedDelegationError(
      "Parent turn is no longer running",
      409,
      "PARENT_TURN_NOT_RUNNING",
    );
  }
  const session = readRecord(snapshot.desktop_runtime_session);
  const expectedHash = stringValue(session?.finalize_token_sha256);
  const expiresAt = stringValue(session?.expires_at);
  if (
    !expectedHash ||
    expectedHash !== hashDesktopFinalizeToken(finalizeCallbackSecret)
  ) {
    throw new ManagedDelegationError(
      "Invalid desktop sidecar delegation token",
      401,
      "INVALID_SIDECAR_TOKEN",
    );
  }
  if (!expiresAt || Date.parse(expiresAt) <= now().getTime()) {
    throw new ManagedDelegationError(
      "Desktop sidecar delegation token has expired",
      401,
      "SIDECAR_TOKEN_EXPIRED",
    );
  }
}

function chooseEffectiveVisibility(
  requested: ManagedDelegationVisibility,
  task: string,
): ManagedDelegationVisibility {
  if (requested === "visible") return "visible";
  return /deploy|delete|destroy|payment|billing|production|long[- ]running|approval/i.test(
    task,
  )
    ? "visible"
    : "hidden";
}

function clampDelegationTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_DELEGATION_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(0, Math.floor(timeoutMs)),
    MAX_DELEGATION_TIMEOUT_MS,
  );
}

async function waitForDelegationResult(
  turnId: string,
  timeoutMs: number,
  deps: ManagedDelegationDeps,
): Promise<DelegatedTurnResult | null> {
  const deadline = deps.now().getTime() + Math.max(0, timeoutMs);
  while (deps.now().getTime() <= deadline) {
    const result = await deps.loadDelegatedTurnResult(turnId);
    if (result?.status === "succeeded" || result?.status === "failed") {
      return result;
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
