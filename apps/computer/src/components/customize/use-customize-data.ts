import { useQuery } from "urql";
import {
  ConnectorCatalogQuery,
  CustomizeBindingsQuery,
  SkillCatalogQuery,
  WorkflowCatalogQuery,
} from "@/lib/graphql-queries";
import type { CustomizeItem } from "./customize-filtering";

interface CatalogConnector {
  id: string;
  slug: string;
  kind: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
}

interface CatalogSkill {
  id: string;
  skillId: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
}

interface CatalogWorkflow {
  id: string;
  slug: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
}

interface BindingsResult {
  computerId: string;
  connectedConnectorSlugs: string[];
  connectedSkillIds: string[];
  connectedWorkflowSlugs: string[];
}

interface CustomizeQueryResult {
  items: CustomizeItem[];
  fetching: boolean;
  error: Error | null;
}

function fallbackIcon(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

/**
 * Merge connectorCatalog + customizeBindings into the CustomizeItem[]
 * shape the table renders. Items are flagged `connected` when the
 * catalog slug appears in the bindings response. MCP-kind connectors
 * carry the "MCP" type badge.
 */
export function useConnectorItems(): CustomizeQueryResult {
  const [catalog] = useQuery<{ connectorCatalog: CatalogConnector[] }>({
    query: ConnectorCatalogQuery,
  });
  const [bindings] = useQuery<{ customizeBindings: BindingsResult | null }>({
    query: CustomizeBindingsQuery,
  });

  const fetching = catalog.fetching || bindings.fetching;
  const error = catalog.error ?? bindings.error ?? null;
  const connected = new Set(
    bindings.data?.customizeBindings?.connectedConnectorSlugs ?? [],
  );

  const items: CustomizeItem[] = (catalog.data?.connectorCatalog ?? []).map(
    (row) => ({
      id: row.slug,
      name: row.displayName,
      description: row.description ?? null,
      category: row.category ?? null,
      iconUrl: row.icon ?? null,
      iconFallback: fallbackIcon(row.displayName),
      typeBadge: row.kind === "mcp" ? "MCP" : undefined,
      connected: connected.has(row.slug),
    }),
  );

  return { items, fetching, error: error ? new Error(error.message) : null };
}

export function useSkillItems(): CustomizeQueryResult {
  const [catalog] = useQuery<{ skillCatalog: CatalogSkill[] }>({
    query: SkillCatalogQuery,
  });
  const [bindings] = useQuery<{ customizeBindings: BindingsResult | null }>({
    query: CustomizeBindingsQuery,
  });

  const fetching = catalog.fetching || bindings.fetching;
  const error = catalog.error ?? bindings.error ?? null;
  const connected = new Set(
    bindings.data?.customizeBindings?.connectedSkillIds ?? [],
  );

  const items: CustomizeItem[] = (catalog.data?.skillCatalog ?? []).map(
    (row) => ({
      id: row.skillId,
      name: row.displayName,
      description: row.description ?? null,
      category: row.category ?? null,
      iconUrl: row.icon ?? null,
      iconFallback: fallbackIcon(row.displayName),
      connected: connected.has(row.skillId),
    }),
  );

  return { items, fetching, error: error ? new Error(error.message) : null };
}

export function useWorkflowItems(): CustomizeQueryResult {
  const [catalog] = useQuery<{ workflowCatalog: CatalogWorkflow[] }>({
    query: WorkflowCatalogQuery,
  });
  const [bindings] = useQuery<{ customizeBindings: BindingsResult | null }>({
    query: CustomizeBindingsQuery,
  });

  const fetching = catalog.fetching || bindings.fetching;
  const error = catalog.error ?? bindings.error ?? null;
  const connected = new Set(
    bindings.data?.customizeBindings?.connectedWorkflowSlugs ?? [],
  );

  const items: CustomizeItem[] = (catalog.data?.workflowCatalog ?? []).map(
    (row) => ({
      id: row.slug,
      name: row.displayName,
      description: row.description ?? null,
      category: row.category ?? null,
      iconUrl: row.icon ?? null,
      iconFallback: fallbackIcon(row.displayName),
      connected: connected.has(row.slug),
    }),
  );

  return { items, fetching, error: error ? new Error(error.message) : null };
}
