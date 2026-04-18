import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Provider as UrqlProvider } from "urql";
import { createThinkworkClient, type ThinkworkGraphqlClient } from "./client";
import type { ThinkworkConfig } from "../types";

const ClientContext = createContext<ThinkworkGraphqlClient | null>(null);

export function ThinkworkGraphqlProvider({
  config,
  children,
}: {
  config: ThinkworkConfig;
  children: ReactNode;
}) {
  const graphql = useMemo(() => createThinkworkClient(config), [config]);
  return (
    <ClientContext.Provider value={graphql}>
      <UrqlProvider value={graphql.client}>{children}</UrqlProvider>
    </ClientContext.Provider>
  );
}

export function useThinkworkClient(): ThinkworkGraphqlClient {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useThinkworkClient must be used inside ThinkworkProvider");
  return ctx;
}
