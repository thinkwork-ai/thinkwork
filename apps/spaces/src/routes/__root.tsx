import { Outlet, createRootRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getDesktopBridge } from "@/lib/desktop-runtime";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <DesktopOAuthRouteListener />
      <DesktopOpenThreadListener />
      <Outlet />
    </>
  );
}

function DesktopOAuthRouteListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    return bridge.onDeepLink(() => {
      void navigate({ to: "/auth/desktop-callback", replace: true });
    });
  }, [navigate]);

  return null;
}

// Notification click → open the thread (R7/R8). The route loader fetches the
// thread fresh when it isn't already in cache; the sidebar re-highlights off
// the route param automatically. No-op in the web build (no desktop bridge).
function DesktopOpenThreadListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    return bridge.onOpenThread(({ threadId }) => {
      void navigate({ to: "/threads/$id", params: { id: threadId } });
    });
  }, [navigate]);

  return null;
}
