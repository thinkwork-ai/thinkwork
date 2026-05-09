import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { useConnectorItems } from "@/components/customize/use-customize-data";
import { useConnectorMutation } from "@/components/customize/use-customize-mutations";

export const Route = createFileRoute("/_authed/_shell/customize/connectors")({
  component: ConnectorsTab,
});

function ConnectorsTab() {
  const { items, fetching, error } = useConnectorItems();
  const { toggle } = useConnectorMutation();

  const handleAction = useCallback(
    (slug: string, nextConnected: boolean) => {
      const item = items.find((i) => i.id === slug);
      if (item?.typeBadge === "MCP") {
        toast.message(
          "Connect this MCP server from the mobile app's per-user OAuth flow.",
        );
        return;
      }
      void toggle(slug, nextConnected);
    },
    [items, toggle],
  );

  return (
    <CustomizeTabBody
      activeTab="/customize/connectors"
      items={items}
      onAction={handleAction}
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
