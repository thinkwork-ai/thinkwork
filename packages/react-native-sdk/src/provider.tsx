import { type ReactNode } from "react";
import { ThinkworkAuthProvider } from "./auth/provider";
import { ThinkworkGraphqlProvider } from "./graphql/provider";
import type { ThinkworkConfig } from "./types";

export function ThinkworkProvider({
  config,
  children,
}: {
  config: ThinkworkConfig;
  children: ReactNode;
}) {
  return (
    <ThinkworkGraphqlProvider config={config}>
      <ThinkworkAuthProvider config={config}>{children}</ThinkworkAuthProvider>
    </ThinkworkGraphqlProvider>
  );
}
