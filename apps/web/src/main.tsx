import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as UrqlProvider } from "urql";
import { ThemeProvider, TooltipProvider } from "@thinkwork/ui";
import type { TokenStorage } from "@/lib/token-storage";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { LocalStorageTokenStorage } from "@/lib/token-storage/local-storage";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import type { router } from "./router";
import "./index.css";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// macOS desktop only: opt into the NSVisualEffectView sidebar material. The
// window is created with `vibrancy: "sidebar"`; this class makes the renderer
// paint transparent behind the sidebar so the material shows through. Gated to
// macOS so Windows/Linux (no vibrancy) keep their opaque background.
if (isDesktopBuild() && /Mac/i.test(navigator.platform)) {
  document.documentElement.classList.add("desktop-vibrancy");

  // Keep the native window appearance in sync with the in-app theme so the
  // vibrancy material renders light/dark to match (otherwise it follows the OS
  // appearance and a light scrim over a dark material reads muddy grey).
  const root = document.documentElement;
  const syncNativeTheme = () => {
    window.thinkworkBridge?.setNativeTheme?.(
      root.classList.contains("dark") ? "dark" : "light",
    );
  };
  syncNativeTheme();
  new MutationObserver(syncNativeTheme).observe(root, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

void bootstrap();

async function bootstrap() {
  await loadRuntimeConfig();
  const [
    { AuthProvider },
    { PageHeaderProvider },
    { TenantProvider },
    { configureTokenStorage },
    { graphqlClient },
    { router },
  ] = await Promise.all([
    import("@/context/AuthContext"),
    import("@/context/PageHeaderContext"),
    import("@/context/TenantContext"),
    import("@/lib/auth"),
    import("@/lib/graphql-client"),
    import("./router"),
  ]);
  const tokenStorage = await createTokenStorage();
  configureTokenStorage(tokenStorage);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <UrqlProvider value={graphqlClient}>
          <AuthProvider tokenStorage={tokenStorage}>
            <TenantProvider>
              <PageHeaderProvider>
                <TooltipProvider>
                  <RouterProvider router={router} />
                </TooltipProvider>
              </PageHeaderProvider>
            </TenantProvider>
          </AuthProvider>
        </UrqlProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

async function createTokenStorage(): Promise<TokenStorage> {
  if (isDesktopBuild()) {
    const { DesktopBridgeTokenStorage } = await import(
      "@/lib/token-storage/desktop-bridge"
    );
    return new DesktopBridgeTokenStorage();
  }

  return new LocalStorageTokenStorage();
}
