import { useCallback, useState } from "react";
import {
  listBrainEnrichmentSources,
  runBrainPageEnrichment,
  type BrainEnrichmentProposal,
  type BrainEnrichmentSourceAvailability,
  type BrainEnrichmentSourceFamily,
} from "../brain";

export function useBrainEnrichment(args: { graphqlUrl: string }) {
  const [proposal, setProposal] = useState<BrainEnrichmentProposal | null>(
    null,
  );
  const [sources, setSources] = useState<BrainEnrichmentSourceAvailability[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadSources = useCallback(
    async (input: {
      tenantId: string;
      pageTable: "wiki_pages" | "tenant_entity_pages";
      pageId: string;
    }) => {
      setSourcesLoading(true);
      setError(null);
      try {
        const next = await listBrainEnrichmentSources({
          graphqlUrl: args.graphqlUrl,
          input,
        });
        setSources(next);
        return next;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setSourcesLoading(false);
      }
    },
    [args.graphqlUrl],
  );

  const run = useCallback(
    async (input: {
      tenantId: string;
      pageTable: "wiki_pages" | "tenant_entity_pages";
      pageId: string;
      query?: string;
      sourceFamilies?: BrainEnrichmentSourceFamily[];
      limit?: number;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const next = await runBrainPageEnrichment({
          graphqlUrl: args.graphqlUrl,
          input,
        });
        setProposal(next);
        return next;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [args.graphqlUrl],
  );

  return {
    proposal,
    sources,
    loading,
    sourcesLoading,
    error,
    loadSources,
    run,
    reset: () => setProposal(null),
  };
}
