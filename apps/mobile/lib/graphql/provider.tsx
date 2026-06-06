import { Provider as UrqlProvider } from "urql";
import { useEffect, useState } from "react";
import { subscribePlatformConfig } from "@/lib/platform-config";
import {
  getGraphqlClient,
  resetGraphqlClientForPlatformConfigChange,
} from "./client";

export function GraphQLProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState(() => getGraphqlClient());

  useEffect(() => {
    setClient(resetGraphqlClientForPlatformConfigChange());
    return subscribePlatformConfig(() => {
      setClient(resetGraphqlClientForPlatformConfigChange());
    });
  }, []);

  return <UrqlProvider value={client}>{children}</UrqlProvider>;
}
