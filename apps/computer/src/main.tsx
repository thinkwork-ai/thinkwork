import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as UrqlProvider } from "urql";
import { ThemeProvider, TooltipProvider } from "@thinkwork/ui";
import { AuthProvider } from "@/context/AuthContext";
import { TenantProvider } from "@/context/TenantContext";
import { graphqlClient } from "@/lib/graphql-client";
import { router } from "./router";
import "./index.css";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <UrqlProvider value={graphqlClient}>
        <AuthProvider>
          <TenantProvider>
            <TooltipProvider>
              <RouterProvider router={router} />
            </TooltipProvider>
          </TenantProvider>
        </AuthProvider>
      </UrqlProvider>
    </ThemeProvider>
  </StrictMode>,
);
