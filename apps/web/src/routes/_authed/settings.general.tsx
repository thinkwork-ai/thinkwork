import { createFileRoute } from "@tanstack/react-router";
import { SettingsGeneral } from "@/components/settings/SettingsGeneral";

// General is visible to all members; operator-only content (Deployment,
// Resources & URLs, Rename) is gated inside the component and server-side (U8).
export const Route = createFileRoute("/_authed/settings/general")({
  component: SettingsGeneral,
});
