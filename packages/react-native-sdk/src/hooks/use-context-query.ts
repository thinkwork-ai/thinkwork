import { useCallback, useState } from "react";
import {
  queryContext,
  type ContextEngineDepth,
  type ContextEngineMode,
  type ContextEngineResponse,
  type ContextEngineScope,
  type ContextProviderFamily,
} from "../context-engine";

export interface UseContextQueryArgs {
  apiBaseUrl: string;
  query: string;
  mode?: ContextEngineMode;
  scope?: ContextEngineScope;
  depth?: ContextEngineDepth;
  limit?: number;
  providers?: {
    ids?: string[];
    families?: ContextProviderFamily[];
  };
}

export function useContextQuery(args: UseContextQueryArgs) {
  const [data, setData] = useState<ContextEngineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(async () => {
    const trimmed = args.query.trim();
    if (!trimmed) {
      setData(null);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await queryContext({ ...args, query: trimmed });
      setData(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [args]);

  return {
    data,
    results: data?.hits ?? [],
    providers: data?.providers ?? [],
    loading,
    error,
    run,
  };
}
