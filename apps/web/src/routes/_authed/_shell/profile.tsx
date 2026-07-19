import { createFileRoute } from "@tanstack/react-router";
import { SelfProfilePage } from "@/components/profile/SelfProfilePage";

export type SelfProfileSearch = {
  view?: "workspace";
  file?: string;
};

export const Route = createFileRoute("/_authed/_shell/profile")({
  validateSearch: (search: Record<string, unknown>): SelfProfileSearch => ({
    view: search.view === "workspace" ? "workspace" : undefined,
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  component: SelfProfilePage,
});

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
