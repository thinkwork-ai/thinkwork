import { getGraphqlClient } from "@/lib/graphql/client";

type SubscriptionRequest = {
  query: string;
  variables?: Record<string, unknown>;
};

type SubscriptionSink = {
  next(value: unknown): void;
  error(error: unknown): void;
  complete(): void;
};

export const wsClient = {
  subscribe(request: SubscriptionRequest, sink: SubscriptionSink) {
    const subscription = getGraphqlClient()
      .subscription(request.query, request.variables)
      .subscribe((value) => sink.next(value));
    return () => subscription.unsubscribe();
  },
};
