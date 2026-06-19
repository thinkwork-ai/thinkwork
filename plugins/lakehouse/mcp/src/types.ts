export interface McpEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta: {
    tool: string;
    auditId?: string;
  };
}

export interface AuditEvent {
  auditId: string;
  actor: string;
  tool: string;
  integrationKey: string;
  bundleVersion: string;
  policyDecision: string;
  result: "allowed" | "denied" | "failed" | "succeeded";
  createdAt: string;
}
