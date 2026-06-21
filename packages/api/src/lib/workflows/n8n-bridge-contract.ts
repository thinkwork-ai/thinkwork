import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  workflowEngineBindings,
  workflowRuns,
} from "@thinkwork/database-pg/schema";
import { summarizeWorkflowEvidence } from "./evidence-redaction.js";
import { createWorkflowRunLedger } from "./run-ledger.js";
import { normalizeWorkflowTriggerContract } from "./trigger-contract.js";

type WorkflowDb = any;

export const N8N_WORKFLOW_BRIDGE_SIGNING_HEADER = "x-thinkwork-signature";
export const N8N_WORKFLOW_BRIDGE_TIMESTAMP_HEADER = "x-thinkwork-timestamp";
export const N8N_WORKFLOW_BRIDGE_REPLAY_WINDOW_SECONDS = 300;
export const N8N_WORKFLOW_BRIDGE_SECRET_JSON_KEY = "sharedSecret";

export type N8nWorkflowBridgeCredential = {
  sharedSecret: string;
  secretSha256: string;
  secretPreview: string;
  signingHeader: string;
  timestampHeader: string;
  replayWindowSeconds: number;
};

export type N8nWorkflowBridgeRequest = {
  workflowId: string;
  externalWorkflowId?: string | null;
  executionId: string;
  idempotencyKey: string;
  correlationId?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date | string | null;
};

export function createN8nWorkflowBridgeCredential(): N8nWorkflowBridgeCredential {
  const sharedSecret = `tw_n8n_${randomBytes(32).toString("base64url")}`;
  return n8nWorkflowBridgeCredentialFromSecret(sharedSecret);
}

export function n8nWorkflowBridgeCredentialFromSecret(
  sharedSecret: string,
): N8nWorkflowBridgeCredential {
  return {
    sharedSecret,
    secretSha256: sha256(sharedSecret),
    secretPreview: `${sharedSecret.slice(0, 10)}...${sharedSecret.slice(-6)}`,
    signingHeader: N8N_WORKFLOW_BRIDGE_SIGNING_HEADER,
    timestampHeader: N8N_WORKFLOW_BRIDGE_TIMESTAMP_HEADER,
    replayWindowSeconds: N8N_WORKFLOW_BRIDGE_REPLAY_WINDOW_SECONDS,
  };
}

export function n8nWorkflowBridgeSecretRef(input: {
  stage?: string | null;
  tenantId: string;
  bindingId: string;
}): string {
  const stage = input.stage?.trim() || process.env.STAGE || "dev";
  return `thinkwork/${stage}/workflow-bridges/n8n/${input.tenantId}/${input.bindingId}`;
}

export function serializeN8nWorkflowBridgeSecret(input: {
  sharedSecret: string;
  tenantId: string;
  workflowId: string;
  bindingId: string;
  rotatedAt: Date;
}): string {
  return JSON.stringify({
    [N8N_WORKFLOW_BRIDGE_SECRET_JSON_KEY]: input.sharedSecret,
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    bindingId: input.bindingId,
    rotatedAt: input.rotatedAt.toISOString(),
  });
}

export function extractN8nWorkflowBridgeSecret(
  secretString: string | null,
): string | null {
  const trimmed = secretString?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const secret = (parsed as Record<string, unknown>)[
      N8N_WORKFLOW_BRIDGE_SECRET_JSON_KEY
    ];
    return typeof secret === "string" && secret.trim() ? secret.trim() : null;
  } catch {
    return null;
  }
}

export function signN8nWorkflowBridgePayload(input: {
  sharedSecret: string;
  timestamp: string;
  body: string;
}): string {
  return createHmac("sha256", input.sharedSecret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
}

export function verifyN8nWorkflowBridgeSignature(input: {
  secretSha256: string;
  headers: Record<string, string | undefined>;
  body: string;
  sharedSecretResolver: (secretSha256: string) => string | null;
  now?: Date;
}): void {
  const headers = lowerCaseHeaders(input.headers);
  const timestamp = headers[N8N_WORKFLOW_BRIDGE_TIMESTAMP_HEADER];
  const signature = headers[N8N_WORKFLOW_BRIDGE_SIGNING_HEADER];
  if (!timestamp || !signature) {
    throw new Error("n8n bridge request is missing signature headers");
  }
  const ageMs = Math.abs(
    (input.now ?? new Date()).getTime() - Number(timestamp),
  );
  if (
    !Number.isFinite(ageMs) ||
    ageMs > N8N_WORKFLOW_BRIDGE_REPLAY_WINDOW_SECONDS * 1000
  ) {
    throw new Error(
      "n8n bridge request timestamp is outside the replay window",
    );
  }
  const sharedSecret = input.sharedSecretResolver(input.secretSha256);
  if (!sharedSecret || sha256(sharedSecret) !== input.secretSha256) {
    throw new Error("n8n bridge credential was not found");
  }
  const expected = signN8nWorkflowBridgePayload({
    sharedSecret,
    timestamp,
    body: input.body,
  });
  if (!safeEqualHex(signature, expected)) {
    throw new Error("n8n bridge request signature is invalid");
  }
}

export async function recordN8nWorkflowBridgeRun(
  database: WorkflowDb,
  input: {
    tenantId: string;
    bindingId: string;
    request: N8nWorkflowBridgeRequest;
  },
): Promise<{ runId: string; created: boolean }> {
  const [binding] = await dbSelect(database)
    .select({
      id: workflowEngineBindings.id,
      workflow_id: workflowEngineBindings.workflow_id,
      workflow_version_id: workflowEngineBindings.workflow_version_id,
      external_workflow_id: workflowEngineBindings.external_workflow_id,
      external_workflow_name: workflowEngineBindings.external_workflow_name,
      capability_flags: workflowEngineBindings.capability_flags,
      readiness_state: workflowEngineBindings.readiness_state,
      readiness_reasons: workflowEngineBindings.readiness_reasons,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, input.tenantId),
        eq(workflowEngineBindings.id, input.bindingId),
        eq(workflowEngineBindings.binding_type, "n8n_bridge"),
      ),
    )
    .limit(1);
  if (!binding) throw new Error("n8n workflow binding was not found");
  if (binding.workflow_id !== input.request.workflowId) {
    throw new Error("n8n bridge request workflow does not match the binding");
  }

  const trigger = normalizeWorkflowTriggerContract({
    family: "n8n",
    source: "n8n:bridge",
    actor: { type: "connected_app", externalId: "n8n" },
    idempotencyKey: input.request.idempotencyKey,
    correlationId: input.request.correlationId ?? input.request.executionId,
    occurredAt: input.request.occurredAt,
    payload: {
      externalWorkflowId:
        input.request.externalWorkflowId ?? binding.external_workflow_id,
      executionId: input.request.executionId,
    },
  });
  const evidence = summarizeWorkflowEvidence({
    payload: input.request.payload ?? {},
    summary: {
      sourceSystem: "n8n",
      executionId: input.request.executionId,
      externalWorkflowId: binding.external_workflow_id,
    },
  });
  const ledger = await createWorkflowRunLedger(database, {
    tenantId: input.tenantId,
    workflowId: binding.workflow_id,
    workflowVersionId: binding.workflow_version_id,
    engineBindingId: binding.id,
    trigger,
    backendExecutionId: input.request.executionId,
    backendExecutionRef: {
      sourceSystem: "n8n",
      executionId: input.request.executionId,
      externalWorkflowId: binding.external_workflow_id,
      externalWorkflowName: binding.external_workflow_name,
    },
    capabilitySnapshot: recordValue(binding.capability_flags),
    readinessSnapshot: {
      state: binding.readiness_state,
      reasons: Array.isArray(binding.readiness_reasons)
        ? binding.readiness_reasons
        : [],
    },
    initialEvent: {
      eventType: "n8n_bridge_request",
      eventStatus: "running",
      provenance: "native_event",
      message: "n8n workflow bridge request accepted",
      payloadSummary: {
        executionId: input.request.executionId,
        externalWorkflowId: binding.external_workflow_id,
      },
      evidenceRef: {
        sourceSystem: "n8n",
        executionId: input.request.executionId,
      },
    },
    evidence: [
      {
        evidenceType: "n8n_execution_payload",
        sourceSystem: "n8n",
        sourceId: input.request.executionId,
        summary: evidence,
      },
    ],
  });
  return { runId: ledger.run.id, created: ledger.created };
}

export async function loadExistingN8nWorkflowRun(
  database: WorkflowDb,
  input: { tenantId: string; idempotencyKey: string },
): Promise<{ id: string } | null> {
  const [run] = await dbSelect(database)
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenant_id, input.tenantId),
        eq(workflowRuns.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  return run ?? null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function lowerCaseHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key.toLowerCase(), value as string]),
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dbSelect(database: WorkflowDb): any {
  return database as any;
}
