import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getCurrentSession } from "@/lib/auth";

const COGNITO_CONFIGURED = !!(
  import.meta.env.VITE_COGNITO_USER_POOL_ID &&
  import.meta.env.VITE_COGNITO_CLIENT_ID
);

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    // Skip auth gate when Cognito isn't configured (local dev without deploy)
    if (!COGNITO_CONFIGURED) return;

    const session = await getCurrentSession();
    if (!session) {
      throw redirect({
        to: "/sign-in",
        search: { next: window.location.pathname },
      });
    }
  },
  component: () => <Outlet />,
});
