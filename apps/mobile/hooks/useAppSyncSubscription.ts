import { useEffect, useState } from "react";
import { wsClient } from "@/lib/graphql/subscriptions";

export function useAppSyncSubscription<T>(
  query: string,
  variables?: Record<string, unknown>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = wsClient.subscribe(
      { query, variables },
      {
        next: (result) => setData(result.data as T),
        error: (err) =>
          setError(err instanceof Error ? err : new Error(String(err))),
        complete: () => {},
      },
    );
    return () => unsubscribe();
  }, [query, JSON.stringify(variables)]);

  return { data, error };
}
