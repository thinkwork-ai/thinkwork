import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  FileText,
  ShieldCheck,
  Sparkles,
  Workflow,
  Wrench,
} from "lucide-react";
import { useMutation, useQuery } from "urql";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@thinkwork/ui";
import { SpaceAccessMode } from "@/gql/graphql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsSpaceQuery,
  SettingsUpdateSpaceMutation,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { ScopedWorkspaceEditor } from "@/components/workspace-settings/ScopedWorkspaceEditor";

export function SettingsSpaceConfig() {
  const { spaceId } = useParams({
    from: "/_authed/settings/spaces/$spaceId",
  });

  const [result, refetch] = useQuery({
    query: SettingsSpaceQuery,
    variables: { id: spaceId },
    requestPolicy: "cache-and-network",
  });
  const space = result.data?.space ?? null;
  const spaceName =
    space?.name?.trim() || (result.fetching ? "Space" : "Space");

  // Title lives in the settings header as nested breadcrumbs; the SPACE.md
  // files shortcut sits as an icon action on the right (matching how other
  // surfaces expose their workspace files).
  usePageHeaderActions({
    title: spaceName,
    breadcrumbs: [
      { label: "Spaces", href: "/settings/spaces" },
      { label: spaceName },
    ],
    action: (
      <Button
        asChild
        size="icon-sm"
        variant="ghost"
        title="Open SPACE.md"
        aria-label="Open SPACE.md"
      >
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId }}
          state={(prev) => ({
            ...prev,
            openSpaceFiles: true,
            defaultOpenFile: "SPACE.md",
          })}
        >
          <FileText className="size-4" />
        </Link>
      </Button>
    ),
    actionKey: `space-files:${spaceId}`,
  });

  if (result.fetching && !result.data) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (!space) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This space could not be loaded — it may have been removed.
        </p>
      </div>
    );
  }

  const manifest = readSpaceManifest(space.config);
  const manifestDiagnostics = readSpaceManifestDiagnostics(
    space.renderDiagnostics,
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <SettingsPageTitle title={spaceName} />
        <InformationSection
          spaceId={spaceId}
          tenantId={space.tenantId}
          name={space.name}
          description={space.description ?? ""}
          accessMode={(space.accessMode as SpaceAccessMode) ?? null}
          status={space.status}
          onSaved={() => refetch({ requestPolicy: "network-only" })}
        />
        <ManifestOverviewSection
          manifest={manifest}
          diagnostics={manifestDiagnostics}
        />
        <SpaceWorkspaceSection spaceId={spaceId} />
      </div>
    </div>
  );
}

/**
 * Embedded file editor over this Space's workspace source (SPACE.md, GOAL.md,
 * agents/, …). The client targets `{ spaceId }` directly, so the tree lists
 * only this Space's files and edits land under its source. Replaces the
 * Spaces/<name>/ slice of the retired consolidated Settings → Workspace page.
 * Space-local agent profiles surface naturally via the `agents/` folder.
 */
function SpaceWorkspaceSection({ spaceId }: { spaceId: string }) {
  return (
    <SettingsSection label="Workspace files">
      <div className="h-[28rem]">
        <ScopedWorkspaceEditor
          target={{ spaceId }}
          targetKey={`space:${spaceId}`}
          defaultOpenFile="SPACE.md"
          bordered={false}
          className="h-full"
        />
      </div>
    </SettingsSection>
  );
}

function InformationSection({
  spaceId,
  tenantId,
  name,
  description,
  accessMode,
  status,
  onSaved,
}: {
  spaceId: string;
  tenantId: string;
  name: string;
  description: string;
  accessMode: SpaceAccessMode | null;
  status: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name,
    description,
    accessMode: accessMode ?? SpaceAccessMode.Public,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [{ fetching: saving }, updateSpace] = useMutation(
    SettingsUpdateSpaceMutation,
  );

  // Re-sync when the underlying record changes (e.g. after refetch).
  useEffect(() => {
    setForm({
      name,
      description,
      accessMode: accessMode ?? SpaceAccessMode.Public,
    });
  }, [name, description, accessMode]);

  async function onSave() {
    setErrorMsg(null);
    setSaved(false);
    const res = await updateSpace({
      input: {
        tenantId,
        spaceId,
        name: form.name.trim(),
        description: form.description,
        accessMode: form.accessMode,
      },
    });
    if (res.error) {
      setErrorMsg(res.error.message);
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <SettingsSection label="Information">
      <SettingsRow label="Name" description="Display name for this Space.">
        <Input
          className="w-72"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </SettingsRow>
      <SettingsRow label="Access" description="Who can see and use this Space.">
        <Select
          value={form.accessMode}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, accessMode: v as SpaceAccessMode }))
          }
        >
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SpaceAccessMode.Public}>Public</SelectItem>
            <SelectItem value={SpaceAccessMode.Private}>Private</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Status"
        description="Current lifecycle state of the Space."
      >
        <Badge variant="secondary">{titleCase(status)}</Badge>
      </SettingsRow>
      <SettingsRow
        label="Description"
        description="What this Space is for; shown to its members."
      >
        <Textarea
          className="w-72"
          rows={3}
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
        />
      </SettingsRow>
      <div className="flex items-center justify-end gap-3 px-4 py-3.5">
        {saved ? (
          <span className="text-sm text-muted-foreground">Saved</span>
        ) : null}
        {errorMsg ? (
          <span className="text-sm text-destructive">{errorMsg}</span>
        ) : null}
        <Button onClick={onSave} disabled={saving || !form.name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsSection>
  );
}

function ManifestOverviewSection({
  manifest,
  diagnostics,
}: {
  manifest: SpaceManifestOverview | null;
  diagnostics: SpaceManifestDiagnostics | null;
}) {
  const status = diagnostics?.status ?? (manifest ? "ok" : "warning");
  const statusLabel =
    status === "error"
      ? "Needs review"
      : status === "warning"
        ? "Pending"
        : "Synced";
  const pendingFields =
    diagnostics?.pendingFields ?? manifest?.pendingFields ?? [];
  const workflows = manifest?.workflows ?? [];
  const builtInTools = manifest?.tools?.builtIn ?? [];
  const mcpTools = manifest?.tools?.mcp ?? [];
  const skills = manifest?.skills ?? [];
  const reviewMode = manifest?.reviewPolicy?.mode ?? "none";
  const bashPolicy = manifest?.runtimePolicy?.bash ?? "default";

  return (
    <SettingsSection label="SPACE.md overview">
      <div className="divide-y divide-border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {manifest?.title ?? "No manifest projection"}
            </p>
            {manifest?.description ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {manifest.description}
              </p>
            ) : null}
          </div>
          <Badge variant={status === "error" ? "destructive" : "secondary"}>
            {statusLabel}
          </Badge>
        </div>

        <OverviewGrid>
          <OverviewPanel
            icon={<Workflow className="size-4" />}
            label="Workflows"
            empty="No workflows"
            items={workflows.map((workflow) => ({
              key: workflow.key,
              label: workflow.name,
              description: workflow.description ?? workflow.source,
            }))}
          />
          <OverviewPanel
            icon={<Wrench className="size-4" />}
            label="Tools"
            empty="No tools"
            items={[
              ...builtInTools.map((tool) => ({
                key: `built-in:${tool}`,
                label: tool,
                description: "Built-in",
              })),
              ...mcpTools.map((tool) => ({
                key: `mcp:${tool}`,
                label: tool,
                description: "MCP",
              })),
            ]}
          />
          <OverviewPanel
            icon={<Sparkles className="size-4" />}
            label="Skills"
            empty="No skills"
            items={skills.map((skill) => ({
              key: skill,
              label: skill,
              description: "Catalog skill",
            }))}
          />
          <OverviewPanel
            icon={<ShieldCheck className="size-4" />}
            label="Policy"
            empty="Default policy"
            items={[
              {
                key: "review",
                label: `Review ${reviewMode}`,
                description: "Review policy",
              },
              {
                key: "bash",
                label: `Bash ${bashPolicy}`,
                description: "Runtime policy",
              },
              ...pendingFields.map((field) => ({
                key: `pending:${field}`,
                label: field,
                description: "Pending apply",
              })),
            ]}
          />
        </OverviewGrid>

        {diagnostics?.diagnostics?.length ? (
          <div className="space-y-2 px-4 py-3.5">
            {diagnostics.diagnostics.slice(0, 4).map((diagnostic) => (
              <div
                key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.message}`}
                className="rounded-md border border-border bg-muted/30 px-3 py-2"
              >
                <p className="text-sm font-medium text-foreground">
                  {diagnostic.path ?? diagnostic.code}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {diagnostic.message}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

function OverviewGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
      {children}
    </div>
  );
}

function OverviewPanel({
  icon,
  label,
  empty,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  empty: string;
  items: Array<{ key: string; label: string; description: string }>;
}) {
  return (
    <div className="min-w-0 space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item.key}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
              title={item.description}
            >
              <span className="truncate font-medium text-foreground">
                {item.label}
              </span>
              <span className="text-muted-foreground">{item.description}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type SpaceManifestOverview = {
  title?: string | null;
  description?: string | null;
  workflows?: Array<{
    key: string;
    name: string;
    description?: string | null;
    source: string;
  }>;
  tools?: { builtIn?: string[]; mcp?: string[] };
  skills?: string[];
  runtimePolicy?: { bash?: string | null };
  reviewPolicy?: { mode?: string | null };
  pendingFields?: string[];
};

type SpaceManifestDiagnostics = {
  status?: "ok" | "warning" | "error";
  diagnostics?: Array<{
    severity: "info" | "warning" | "error";
    code: string;
    path?: string;
    message: string;
  }>;
  pendingFields?: string[];
};

function readSpaceManifest(value: unknown): SpaceManifestOverview | null {
  const config = readJsonObject(value);
  const manifest = readJsonObject(config?.spaceManifest);
  if (!manifest) return null;
  return manifest as SpaceManifestOverview;
}

function readSpaceManifestDiagnostics(
  value: unknown,
): SpaceManifestDiagnostics | null {
  const diagnostics = readJsonObject(value);
  const manifest = readJsonObject(diagnostics?.spaceManifest);
  if (!manifest) return null;
  return manifest as SpaceManifestDiagnostics;
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return readJsonObject(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
