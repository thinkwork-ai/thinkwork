import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getIdToken } from "@/lib/auth";
import { readRuntimeEnv } from "@/lib/runtime-config";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    // Skip auth gate when Cognito isn't configured (local dev without deploy)
    if (
      !readRuntimeEnv("VITE_COGNITO_USER_POOL_ID") ||
      !readRuntimeEnv("VITE_COGNITO_CLIENT_ID")
    ) {
      return;
    }

    // Use getIdToken (which has the localStorage fallback) instead of
    // getCurrentSession. amazon-cognito-identity-js can't reconstruct an
    // SRP session for Google-federated users, so getCurrentSession() returns
    // null on every reload — which then redirect-loops federated users back
    // to /sign-in. getIdToken consults localStorage where storeTokens
    // wrote the OAuth tokens, so federated sessions survive a reload.
    const token = await getIdToken();
    if (!token) {
      throw redirect({
        to: "/sign-in",
        search: { next: window.location.pathname },
      });
    }
  },
  component: () => <Outlet />,
});
