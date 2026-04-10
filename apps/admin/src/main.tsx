import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as UrqlProvider } from "urql";
import { ThemeProvider } from "@/context/ThemeContext";
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { AuthProvider } from "@/context/AuthContext";
import { DialogProvider } from "@/context/DialogContext";
import { PanelProvider } from "@/context/PanelContext";
import { TenantProvider } from "@/context/TenantContext";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { graphqlClient } from "@/lib/graphql-client";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UrqlProvider value={graphqlClient}>
        <ThemeProvider>
          <AuthProvider>
            <TenantProvider>
              <BreadcrumbProvider>
                <DialogProvider>
                  <PanelProvider>
                    <TooltipProvider>
                      <RouterProvider router={router} />
                    </TooltipProvider>
                  </PanelProvider>
                </DialogProvider>
              </BreadcrumbProvider>
            </TenantProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </UrqlProvider>
    </QueryClientProvider>
  </StrictMode>,
);
