import { createFileRoute } from "@tanstack/react-router";
import { SettingsBilling } from "@/components/settings/SettingsBilling";

export const Route = createFileRoute("/_authed/settings/billing")({
  component: SettingsBilling,
});
