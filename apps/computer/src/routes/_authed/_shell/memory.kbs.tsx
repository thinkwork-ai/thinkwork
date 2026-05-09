import { createFileRoute } from "@tanstack/react-router";

// U4 placeholder. U7 lands the KBs index (read-only listing).
export const Route = createFileRoute("/_authed/_shell/memory/kbs")({
  component: KbsPlaceholder,
});

function KbsPlaceholder() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-8">
      <h1 className="text-lg font-semibold">Knowledge Bases</h1>
      <p className="text-sm text-muted-foreground">
        Tenant knowledge bases will list here. Coming in U7.
      </p>
    </div>
  );
}
