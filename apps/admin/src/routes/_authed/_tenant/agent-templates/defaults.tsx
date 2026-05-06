import { createFileRoute } from "@tanstack/react-router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/defaults",
)({
  component: DefaultWorkspacePage,
});

const DEFAULT_ROUTER = `# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md

## chat
- load: docs/tone.md, memory/preferences.md

## email
- load: docs/procedures/

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
`;

const DEFAULT_FILES: Record<string, string> = {
  "SOUL.md":
    "# Soul\n\nEdit this file to define your agent's personality and values.\n",
  "IDENTITY.md":
    "# Identity\n\nEdit this file to define your agent's name and role.\n",
  "USER.md":
    "# User Context\n\nEdit this file to describe the users this agent works with.\n",
  "ROUTER.md": DEFAULT_ROUTER,
  "memory/lessons.md":
    "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
  "memory/preferences.md":
    "# Preferences\n\nDiscovered user and team preferences.\n",
  "memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
};

function DefaultWorkspacePage() {
  useBreadcrumbs([
    { label: "Templates", href: "/agent-templates" },
    { label: "Default Workspace" },
  ]);

  return (
    <PageLayout
      header={
        <div>
          <h1 className="text-lg font-semibold">Default Workspace</h1>
          <p className="text-xs text-muted-foreground">
            Default workspace files for new Computer and Agent templates
          </p>
        </div>
      }
    >
      <WorkspaceEditor
        target={{ defaults: true }}
        mode="defaults"
        bootstrapFiles={DEFAULT_FILES}
        bootstrapLabel="Bootstrap"
      />
    </PageLayout>
  );
}
