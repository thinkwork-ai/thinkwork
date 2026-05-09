import { createFileRoute } from "@tanstack/react-router";

// U4 placeholder. U6 lands the Pages tab (Table + Graph for compiled wiki pages).
export const Route = createFileRoute("/_authed/_shell/memory/pages")({
  component: PagesPlaceholder,
});

function PagesPlaceholder() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold">Pages</h1>
      <p className="text-sm text-muted-foreground">
        Compiled wiki pages will live here. Coming in U6.
      </p>
    </div>
  );
}
