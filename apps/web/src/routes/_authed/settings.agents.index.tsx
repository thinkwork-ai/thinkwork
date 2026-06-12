import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsAgents } from "@/components/settings/SettingsAgents";

export type SettingsAgentsView = "workspace";

export type SettingsAgentsSearch = {
  /** `workspace` shows the main-agent workspace editor; absent = config view. */
  view?: SettingsAgentsView;
  /** Optional file to open when `view=workspace` (defaults to AGENTS.md). */
  file?: string;
};

// Settings → Agents: a single page with two views toggled by the header icon.
// The default config view holds the Default Agent + Agent Profiles sections;
// `?view=workspace` swaps in the S3-backed editor over the tenant Agent
// source (baseline AGENTS.md plus its skills/ and agents/ folders) —
// the surface that replaced the standalone /settings/main-agent route.
export const Route = createFileRoute("/_authed/settings/agents/")({
  validateSearch: (search: Record<string, unknown>): SettingsAgentsSearch => ({
    view: search.view === "workspace" ? "workspace" : undefined,
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <SettingsAgents />
    </OperatorGuard>
  ),
});

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
