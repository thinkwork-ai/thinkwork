import { describe, expect, it } from "vitest";
import {
  WORKFLOW_EVIDENCE_STORAGE_POLICY,
  WORKFLOW_REDACTED_VALUE,
  redactEvidenceValue,
  summarizeWorkflowEvidence,
} from "./evidence-redaction.js";

describe("workflow evidence redaction", () => {
  it("documents the tenant-scoped evidence storage policy", () => {
    expect(WORKFLOW_EVIDENCE_STORAGE_POLICY).toEqual({
      access: "tenant_scoped",
      encryption: "aws_managed_kms_or_stronger",
      rawPayloadLogging: "forbidden",
      inlinePayload: "redacted_summary_only",
      offload: "store_uri_and_hash_only",
      defaultRetentionDays: 90,
    });
  });

  it("redacts secret-like fields and known token shapes", () => {
    const redacted = redactEvidenceValue({
      ok: true,
      apiKey: "sk-live-secret",
      nested: {
        authorization: "Bearer ghp_123456789012345678901234",
      },
      message:
        "Authorization: Bearer ya29.123456789012345678901234567890 should hide",
    });

    expect(redacted.redacted).toBe(true);
    expect(redacted.value).toEqual({
      ok: true,
      apiKey: WORKFLOW_REDACTED_VALUE,
      nested: { authorization: WORKFLOW_REDACTED_VALUE },
      message: `Authorization: Bearer ${WORKFLOW_REDACTED_VALUE} should hide`,
    });
  });

  it("keeps small safe payloads inline as summary-only evidence", () => {
    const summary = summarizeWorkflowEvidence({
      payload: { event: "task.completed", taskId: "TASK-1" },
      summary: { provider: "twenty" },
    });

    expect(summary.redactionState).toBe("summary_only");
    expect(summary.sensitivity).toBeNull();
    expect(summary.summary).toEqual(
      expect.objectContaining({
        provider: "twenty",
        redacted: false,
        payload: { event: "task.completed", taskId: "TASK-1" },
      }),
    );
  });

  it("stores oversized evidence by reference with bounded preview metadata", () => {
    const summary = summarizeWorkflowEvidence({
      payload: { body: "x".repeat(600) },
      maxInlineBytes: 40,
      uri: "s3://tenant/workflow-evidence/payload.json",
    });

    expect(summary.redactionState).toBe("offloaded");
    expect(summary.uri).toBe("s3://tenant/workflow-evidence/payload.json");
    expect(summary.summary).toEqual(
      expect.objectContaining({
        payloadRef: "s3://tenant/workflow-evidence/payload.json",
        preview: expect.objectContaining({ body: `${"x".repeat(512)}...` }),
      }),
    );
    expect(summary.summary).not.toHaveProperty("payload");
  });
});
