const CONTEXT_ENGINE_ALIASES = [
  "query_context",
  "context_engine",
  "query_erp_customer_context",
  "query_crm_opportunity_context",
  "query_support_case_context",
  "query_catalog_context",
] as const;

const TOOL_POLICY_ALIASES: Record<string, readonly string[]> = {
  "web-search": ["web-search", "web_search"],
  web_search: ["web-search", "web_search"],
  "web-extract": ["web-extract", "web_extract"],
  web_extract: ["web-extract", "web_extract"],
  "agent-email-send": ["agent-email-send", "send_email"],
  send_email: ["agent-email-send", "send_email"],
  query_context: CONTEXT_ENGINE_ALIASES,
  context_engine: CONTEXT_ENGINE_ALIASES,
  query_erp_customer_context: CONTEXT_ENGINE_ALIASES,
  query_crm_opportunity_context: CONTEXT_ENGINE_ALIASES,
  query_support_case_context: CONTEXT_ENGINE_ALIASES,
  query_catalog_context: CONTEXT_ENGINE_ALIASES,
};

export function toolPolicyAliases(toolName: string): string[] {
  return Array.from(
    new Set([toolName, ...(TOOL_POLICY_ALIASES[toolName] ?? [])]),
  );
}
