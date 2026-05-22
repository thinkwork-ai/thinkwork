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
import { LocalStorageTokenStorage } from "@/lib/token-storage/local-storage";
import { router } from "./router";
import "./index.css";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
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

function isDesktopBuild(): boolean {
  return typeof __DESKTOP_BUILD__ !== "undefined" && __DESKTOP_BUILD__;
}
