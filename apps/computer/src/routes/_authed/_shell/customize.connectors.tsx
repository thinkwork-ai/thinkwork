import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { useConnectorItems } from "@/components/customize/use-customize-data";

export const Route = createFileRoute("/_authed/_shell/customize/connectors")({
  component: ConnectorsTab,
});

function ConnectorsTab() {
  const { items, fetching, error } = useConnectorItems();
  return (
    <CustomizeTabBody
      activeTab="/customize/connectors"
      items={items}
      searchPlaceholder="Search connectors…"
      emptyMessage={
        error
          ? `Couldn't load connectors: ${error.message}`
          : fetching
            ? "Loading connectors…"
            : "No connectors match your filters."
      }
    />
  );
}
