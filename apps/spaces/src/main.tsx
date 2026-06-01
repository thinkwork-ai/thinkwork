import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as UrqlProvider } from "urql";
import { ThemeProvider, TooltipProvider } from "@thinkwork/ui";
import { AuthProvider } from "@/context/AuthContext";
import { PageHeaderProvider } from "@/context/PageHeaderContext";
import { TenantProvider } from "@/context/TenantContext";
import { configureTokenStorage } from "@/lib/auth";
import { graphqlClient } from "@/lib/graphql-client";
import type { TokenStorage } from "@/lib/token-storage";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { LocalStorageTokenStorage } from "@/lib/token-storage/local-storage";
import { router } from "./router";
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
}

void createTokenStorage().then((tokenStorage) => {
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
});

async function createTokenStorage(): Promise<TokenStorage> {
  if (isDesktopBuild()) {
    const { DesktopBridgeTokenStorage } =
      await import("@/lib/token-storage/desktop-bridge");
    return new DesktopBridgeTokenStorage();
  }

  return new LocalStorageTokenStorage();
}
