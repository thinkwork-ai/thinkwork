import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as UrqlProvider } from "urql";
import { ThemeProvider, TooltipProvider } from "@thinkwork/ui";
import type { TokenStorage } from "@/lib/token-storage";
import { LocalStorageTokenStorage } from "@/lib/token-storage/local-storage";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import type { router } from "./router";
import "./index.css";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
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
  return new LocalStorageTokenStorage();
}
