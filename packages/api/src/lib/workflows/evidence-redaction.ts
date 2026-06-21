import { createHash } from "node:crypto";

export const WORKFLOW_REDACTED_VALUE = "<redacted>";

export type WorkflowEvidenceRedactionState =
  | "summary_only"
  | "redacted"
  | "offloaded"
  | "raw_allowed";

export type WorkflowEvidenceSummaryInput = {
  payload: unknown;
  maxInlineBytes?: number;
  uri?: string | null;
  summary?: Record<string, unknown>;
};

export type WorkflowEvidenceSummary = {
  summary: Record<string, unknown>;
  redactionState: WorkflowEvidenceRedactionState;
  sensitivity: string | null;
  uri: string | null;
};

export const WORKFLOW_EVIDENCE_STORAGE_POLICY = {
  access: "tenant_scoped",
  encryption: "aws_managed_kms_or_stronger",
  rawPayloadLogging: "forbidden",
  inlinePayload: "redacted_summary_only",
  offload: "store_uri_and_hash_only",
  defaultRetentionDays: 90,
} as const;

const DEFAULT_MAX_INLINE_BYTES = 4096;
const PREVIEW_STRING_LIMIT = 512;
const SECRET_KEY_RE =
  /(authorization|password|passwd|secret|token|api[_-]?key|credential|signature|cookie)/i;
const AUTH_BEARER = /Authorization:\s*Bearer\s+([^\s"'<>]+)/gi;
const JWT = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const PREFIXED_TOKEN =
  /(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,})/g;

export function summarizeWorkflowEvidence(
  input: WorkflowEvidenceSummaryInput,
): WorkflowEvidenceSummary {
  const maxInlineBytes = input.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
  const redaction = redactEvidenceValue(input.payload);
  const json = stableJson(redaction.value);
  const bytes = Buffer.byteLength(json, "utf8");
  const payloadSha256 = createHash("sha256").update(json).digest("hex");
  const base = {
    ...(input.summary ?? {}),
    payloadBytes: bytes,
    payloadSha256,
    redacted: redaction.redacted,
  };

  if (bytes > maxInlineBytes) {
    return {
      summary: {
        ...base,
        payloadRef: input.uri ?? null,
        preview: previewValue(redaction.value),
      },
      redactionState: input.uri ? "offloaded" : "redacted",
      sensitivity: redaction.redacted ? "sensitive" : "oversize",
      uri: input.uri ?? null,
    };
  }

  return {
    summary: {
      ...base,
      payload: redaction.value,
    },
    redactionState: redaction.redacted ? "redacted" : "summary_only",
    sensitivity: redaction.redacted ? "sensitive" : null,
    uri: input.uri ?? null,
  };
}

export function redactEvidenceValue(value: unknown): {
  value: unknown;
  redacted: boolean;
} {
  return redact(value, new Set<object>(), null);
}

function redact(
  value: unknown,
  seen: Set<object>,
  key: string | null,
): { value: unknown; redacted: boolean } {
  if (value == null) return { value, redacted: false };
  if (typeof value === "string") {
    if (key && SECRET_KEY_RE.test(key)) {
      return { value: WORKFLOW_REDACTED_VALUE, redacted: true };
    }
    const scrubbed = scrubKnownTokenShapes(value);
    return { value: scrubbed, redacted: scrubbed !== value };
  }
  if (typeof value !== "object") return { value, redacted: false };
  if (seen.has(value)) {
    return { value: "[Circular]", redacted: true };
  }
  seen.add(value);

  if (Array.isArray(value)) {
    let redacted = false;
    const out = value.map((item) => {
      const next = redact(item, seen, key);
      redacted = redacted || next.redacted;
      return next.value;
    });
    return { value: out, redacted };
  }

  let redacted = false;
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (SECRET_KEY_RE.test(childKey)) {
      out[childKey] = WORKFLOW_REDACTED_VALUE;
      redacted = true;
      continue;
    }
    const next = redact(childValue, seen, childKey);
    out[childKey] = next.value;
    redacted = redacted || next.redacted;
  }
  return { value: out, redacted };
}

function scrubKnownTokenShapes(message: string): string {
  let out = message;
  out = out.replace(
    AUTH_BEARER,
    `Authorization: Bearer ${WORKFLOW_REDACTED_VALUE}`,
  );
  out = out.replace(JWT, WORKFLOW_REDACTED_VALUE);
  out = out.replace(PREFIXED_TOKEN, WORKFLOW_REDACTED_VALUE);
  return out;
}

function previewValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > PREVIEW_STRING_LIMIT
      ? `${value.slice(0, PREVIEW_STRING_LIMIT)}...`
      : value;
  }
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 5).map(previewValue);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 10)
      .map(([key, child]) => [key, previewValue(child)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
