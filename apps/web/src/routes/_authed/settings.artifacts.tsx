import { Outlet, createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";

// Layout route for /settings/artifacts/* — operator-gated. The list renders in
// settings.artifacts.index.tsx and the detail in settings.artifacts.$id.tsx,
// both into this Outlet, so both stay inside the Settings shell.
export const Route = createFileRoute("/_authed/settings/artifacts")({
  component: () => (
    <OperatorGuard>
      <Outlet />
    </OperatorGuard>
  ),
});
