const CONTEXT_ENGINE_ALIASES = [
  "query_context",
  "context_engine",
  "query_erp_customer_context",
  "query_crm_opportunity_context",
  "query_support_case_context",
  "query_catalog_context",
] as const;

const KNOWLEDGE_GRAPH_ALIASES = [
  "knowledge_graph_search",
  "knowledge_graph_get_entity",
  "knowledge_graph_neighbors",
  "knowledge-graph",
  "knowledge_graph",
] as const;

const IDENTITY_RESOLUTION_ALIASES = [
  "resolve_entities",
  "propose_mapping_candidates",
  "confirm_mapping",
  "identity-resolution",
  "identity_resolution",
] as const;

const TOOL_POLICY_ALIASES: Record<string, readonly string[]> = {
  knowledge_graph_search: KNOWLEDGE_GRAPH_ALIASES,
  knowledge_graph_get_entity: KNOWLEDGE_GRAPH_ALIASES,
  knowledge_graph_neighbors: KNOWLEDGE_GRAPH_ALIASES,
  "knowledge-graph": KNOWLEDGE_GRAPH_ALIASES,
  knowledge_graph: KNOWLEDGE_GRAPH_ALIASES,
  resolve_entities: IDENTITY_RESOLUTION_ALIASES,
  propose_mapping_candidates: IDENTITY_RESOLUTION_ALIASES,
  confirm_mapping: IDENTITY_RESOLUTION_ALIASES,
  "identity-resolution": IDENTITY_RESOLUTION_ALIASES,
  identity_resolution: IDENTITY_RESOLUTION_ALIASES,
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
