import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { CONNECTORS_FIXTURE } from "@/components/customize/customize-fixtures";

export const Route = createFileRoute("/_authed/_shell/customize/connectors")({
  component: ConnectorsTab,
});

/**
 * v1 renders a fixture catalog. U4 swaps the fixture for real urql
 * queries against tenant_connector_catalog + tenant_mcp_servers + the
 * caller's connector / agent_mcp_server bindings.
 */
function ConnectorsTab() {
  return (
    <CustomizeTabBody
      activeTab="/customize/connectors"
      items={CONNECTORS_FIXTURE}
      searchPlaceholder="Search connectors…"
      emptyMessage="No connectors match your filters."
    />
  );
}
