import { useCallback, useState } from "react";
import {
  runBrainPageEnrichment,
  type BrainEnrichmentProposal,
  type BrainEnrichmentSourceFamily,
} from "../brain";

export function useBrainEnrichment(args: { graphqlUrl: string }) {
  const [proposal, setProposal] = useState<BrainEnrichmentProposal | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

  return { proposal, loading, error, run, reset: () => setProposal(null) };
}
