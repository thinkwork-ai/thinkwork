import { createFileRoute } from "@tanstack/react-router";
import { SettingsCrm } from "@/components/settings/SettingsCrm";

export const Route = createFileRoute("/_authed/settings/crm")({
  component: SettingsCrm,
});
