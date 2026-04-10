const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterStrength {
  inputStrength: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  outputStrength: "NONE" | "LOW" | "MEDIUM" | "HIGH";
}

export interface GuardrailConfig {
  contentFilters?: {
    hate?: FilterStrength;
    insults?: FilterStrength;
    sexual?: FilterStrength;
    violence?: FilterStrength;
    misconduct?: FilterStrength;
  };
  deniedTopics?: Array<{
    name: string;
    definition: string;
    examples?: string[];
  }>;
}

export interface Guardrail {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  bedrock_guardrail_id: string | null;
  bedrock_version: string | null;
  is_default: boolean;
  status: string;
  config: GuardrailConfig;
  created_at: string;
  updated_at: string;
  assigned_templates_count?: number;
  assigned_templates?: Array<{ id: string; name: string; slug: string | null }>;
}

export interface GuardrailBlock {
  id: string;
  tenant_id: string;
  agent_id: string;
  guardrail_id: string;
  thread_id: string | null;
  message_id: string | null;
  block_type: string;
  action: string;
  blocked_topics: string[] | null;
  content_filters: Record<string, unknown> | null;
  raw_response: Record<string, unknown> | null;
  user_message: string | null;
  created_at: string;
}

export interface GuardrailStats {
  guardrails_count: number;
  templates_with_guardrails: number;
  blocks_24h: number;
  blocks_7d: number;
  blocks_30d: number;
  blocks_by_type: Array<{ type: string; count: number }>;
  blocks_by_action: Array<{ action: string; count: number }>;
  recent_blocks: GuardrailBlock[];
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

function tenantHeaders(tenantId: string) {
  return { "x-tenant-id": tenantId };
}

export function listGuardrails(tenantId: string): Promise<Guardrail[]> {
  return apiFetch("/api/guardrails", {
    headers: tenantHeaders(tenantId),
  });
}

export function getGuardrail(tenantId: string, id: string): Promise<Guardrail> {
  return apiFetch(`/api/guardrails/${id}`, {
    headers: tenantHeaders(tenantId),
  });
}

export function createGuardrail(
  tenantId: string,
  data: { name: string; description?: string; config: GuardrailConfig },
): Promise<Guardrail> {
  return apiFetch("/api/guardrails", {
    method: "POST",
    headers: tenantHeaders(tenantId),
    body: JSON.stringify(data),
  });
}

export function updateGuardrail(
  tenantId: string,
  id: string,
  data: { name?: string; description?: string; config?: GuardrailConfig },
): Promise<Guardrail> {
  return apiFetch(`/api/guardrails/${id}`, {
    method: "PUT",
    headers: tenantHeaders(tenantId),
    body: JSON.stringify(data),
  });
}

export function deleteGuardrail(tenantId: string, id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/guardrails/${id}`, {
    method: "DELETE",
    headers: tenantHeaders(tenantId),
  });
}

export function toggleDefault(
  tenantId: string,
  id: string,
  isDefault: boolean,
): Promise<Guardrail> {
  return apiFetch(`/api/guardrails/${id}/default`, {
    method: "PUT",
    headers: tenantHeaders(tenantId),
    body: JSON.stringify({ is_default: isDefault }),
  });
}

export function getGuardrailStats(tenantId: string): Promise<GuardrailStats> {
  return apiFetch("/api/guardrails/stats", {
    headers: tenantHeaders(tenantId),
  });
}

export function assignTemplates(
  tenantId: string,
  guardrailId: string,
  templateIds: string[],
): Promise<{ assigned: number }> {
  return apiFetch(`/api/guardrails/${guardrailId}/templates`, {
    method: "PUT",
    headers: tenantHeaders(tenantId),
    body: JSON.stringify({ template_ids: templateIds }),
  });
}
