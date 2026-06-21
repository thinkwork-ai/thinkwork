import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createN8nWorkflowBridgeCredential,
  extractN8nWorkflowBridgeSecret,
  n8nWorkflowBridgeCredentialFromSecret,
  n8nWorkflowBridgeSecretRef,
  recordN8nWorkflowBridgeRun,
  serializeN8nWorkflowBridgeSecret,
  signN8nWorkflowBridgePayload,
  verifyN8nWorkflowBridgeSignature,
} from "./n8n-bridge-contract.js";

type Rows = Record<string, unknown>[];

const selectQueue: Rows[] = [];
const insertRows = vi.fn<() => Rows>();
const insertValues = vi.fn();
const updateValues = vi.fn();

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertValues(value);
        const returning = () => Promise.resolve(insertRows());
        return {
          returning,
          onConflictDoNothing: () => ({ returning }),
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateValues(value);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  insertRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
});

describe("n8n workflow bridge contract", () => {
  it("serializes one-time bridge credentials for server-side verification", () => {
    const credential = createN8nWorkflowBridgeCredential();
    const secretRef = n8nWorkflowBridgeSecretRef({
      stage: "dev",
      tenantId: "tenant-1",
      bindingId: "binding-1",
    });
    const secretString = serializeN8nWorkflowBridgeSecret({
      sharedSecret: credential.sharedSecret,
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      bindingId: "binding-1",
      rotatedAt: new Date("2026-06-20T12:00:00Z"),
    });

    expect(secretRef).toBe(
      "thinkwork/dev/workflow-bridges/n8n/tenant-1/binding-1",
    );
    expect(secretString).not.toContain(credential.secretSha256);
    expect(extractN8nWorkflowBridgeSecret(secretString)).toBe(
      credential.sharedSecret,
    );
    expect(
      n8nWorkflowBridgeCredentialFromSecret(credential.sharedSecret),
    ).toEqual(credential);
    expect(extractN8nWorkflowBridgeSecret("not-json")).toBeNull();
  });

  it("generates and verifies HMAC bridge credentials", () => {
    const credential = createN8nWorkflowBridgeCredential();
    const timestamp = String(Date.now());
    const body = JSON.stringify({ workflowId: "workflow-1" });
    const signature = signN8nWorkflowBridgePayload({
      sharedSecret: credential.sharedSecret,
      timestamp,
      body,
    });

    expect(credential.sharedSecret).toMatch(/^tw_n8n_/);
    expect(() =>
      verifyN8nWorkflowBridgeSignature({
        secretSha256: credential.secretSha256,
        body,
        headers: {
          "x-thinkwork-timestamp": timestamp,
          "x-thinkwork-signature": signature,
        },
        sharedSecretResolver: () => credential.sharedSecret,
        now: new Date(Number(timestamp)),
      }),
    ).not.toThrow();
    expect(() =>
      verifyN8nWorkflowBridgeSignature({
        secretSha256: credential.secretSha256,
        body,
        headers: {
          "x-thinkwork-timestamp": timestamp,
          "x-thinkwork-signature": "00",
        },
        sharedSecretResolver: () => credential.sharedSecret,
        now: new Date(Number(timestamp)),
      }),
    ).toThrow(/signature is invalid/);
  });

  it("records n8n bridge requests as canonical workflow runs with evidence", async () => {
    selectQueue.push([
      {
        id: "binding-1",
        workflow_id: "workflow-1",
        workflow_version_id: "version-1",
        external_workflow_id: "n8n-workflow-1",
        external_workflow_name: "Fulfillment follow-up",
        capability_flags: { monitor: true },
        readiness_state: "ready",
        readiness_reasons: [],
      },
    ]);
    insertRows
      .mockReturnValueOnce([{ id: "workflow-run-1" }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const result = await recordN8nWorkflowBridgeRun(fakeDb(), {
      tenantId: "tenant-1",
      bindingId: "binding-1",
      request: {
        workflowId: "workflow-1",
        executionId: "exec-1",
        idempotencyKey: "n8n:exec-1",
        correlationId: "corr-1",
        payload: { ok: true, token: "secret" },
      },
    });

    expect(result).toEqual({ runId: "workflow-run-1", created: true });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "workflow-1",
        engine_binding_id: "binding-1",
        trigger_family: "n8n",
        idempotency_key: "n8n:exec-1",
        backend_execution_id: "exec-1",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_type: "n8n_execution_payload",
        source_system: "n8n",
        source_id: "exec-1",
        redaction_state: "redacted",
      }),
    );
  });
});
