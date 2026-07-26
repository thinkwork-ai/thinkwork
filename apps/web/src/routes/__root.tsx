import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@thinkwork/ui";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      {/* App-wide toast host. Without this, sonner's `toast()` calls (flag
          dialog, settings saves, eval run errors, …) render nothing. */}
      <Toaster richColors closeButton />
    </>
  );
}
