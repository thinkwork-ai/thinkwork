import { createFileRoute } from "@tanstack/react-router";
import { SelfProfilePage } from "@/components/profile/SelfProfilePage";

export const Route = createFileRoute("/_authed/_shell/profile")({
  component: SelfProfilePage,
});
