import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsWiki } from "@/components/settings/SettingsWiki";

export const Route = createFileRoute("/_authed/settings/wiki")({
  component: () => (
    <OperatorGuard>
      <SettingsWiki />
    </OperatorGuard>
  ),
});
