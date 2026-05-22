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
