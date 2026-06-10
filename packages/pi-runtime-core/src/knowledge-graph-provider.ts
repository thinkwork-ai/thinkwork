/**
 * KnowledgeGraphProvider — the host-supplied seam for the tenant knowledge
 * graph (plan 2026-06-09-004 U7).
 *
 * Mirrors the {@link MemoryProvider} seam shape: a narrow request/response
 * contract; the host supplies transport + identity. The knowledge-graph
 * extension reaches the graph ONLY through this interface — it never builds
 * an HTTP/GraphQL client of its own — so the extension is identical on the
 * cloud and desktop hosts.
 *
 * Identity discipline (R15): tenant/user/turn identity is NOT part of this
 * contract. The host closes over a turn-bound credential when it constructs
 * the provider (snapshot-at-entry, never re-read from env mid-turn — see
 * feedback_completion_callback_snapshot_pattern), and the platform API
 * resolves the tenant server-side from that credential. A prompt-injected
 * turn therefore cannot flip tenants by parameter.
 *
 * Result discipline (R17): results carry entity/relationship labels,
 * summaries, and observation-ID references — NEVER verbatim evidence
 * snippets. Snippets are the channel that carries raw per-user memory text
 * past the promotion gate; they stay admin-only (the Explorer UI).
 *
 * Positioning vs memory: the graph is the tenant's shared institutional
 * layer (customers, projects, decisions and how they connect across the
 * whole company); `recall`/`reflect` remain the user's own episodic memory.
 */

/** A matched graph entity. No snippet/evidence-text field by design. */
export interface KnowledgeGraphEntityItem {
  id: string;
  /** Display label (e.g. "Acme Corp"). */
  label: string;
  /** Approved ontology type slug (e.g. "company"), when grounded to one. */
  typeSlug: string | null;
  /** Normalizer-produced entity summary, when present. */
  summary: string | null;
  /** Known aliases for the entity. */
  aliases: string[];
  /** Number of graph relationships touching this entity. */
  relationshipCount: number;
  /** Number of supporting evidence rows behind this entity. */
  evidenceCount: number;
  /**
   * Hindsight observation ids supporting this entity
   * (`evidence_source_ref` where the evidence source is a hindsight
   * observation). References only — never the observation text.
   */
  observationIds: string[];
}

/** A 1-hop relationship between two matched/neighboring entities. */
export interface KnowledgeGraphRelationshipItem {
  id: string;
  /** Relationship label (e.g. "serves"). */
  label: string;
  /** Approved ontology type slug, when grounded to one. */
  typeSlug: string | null;
  /** Label of the relationship's source entity. */
  fromLabel: string;
  /** Label of the relationship's target entity. */
  toLabel: string;
}

export interface KnowledgeGraphSearchRequest {
  /** Entity name/alias to search for (alias-tolerant match). */
  query: string;
  /** Optional cap on matched entities (bounded by the backend). */
  limit?: number;
}

export interface KnowledgeGraphSearchResult {
  entities: KnowledgeGraphEntityItem[];
  relationships: KnowledgeGraphRelationshipItem[];
}

export interface KnowledgeGraphProvider {
  /**
   * Search the tenant knowledge graph: alias-tolerant entity match plus a
   * bounded 1-hop relationship expansion. The optional `signal` lets the
   * caller cancel an in-flight call — the agent-facing tool passes the
   * turn's abort signal so a user abort / host timeout tears down the
   * underlying request instead of orphaning it.
   */
  search(
    request: KnowledgeGraphSearchRequest,
    signal?: AbortSignal,
  ): Promise<KnowledgeGraphSearchResult>;
}
