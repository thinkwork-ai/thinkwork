import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { FileText, SlidersHorizontal, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  SettingsDeleteSpaceMutation,
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
  const { file, view } = useSearch({
    from: "/_authed/settings/spaces/$spaceId",
  });
  const navigate = useNavigate();
  const workspaceView = view === "workspace";

  const [result, refetch] = useQuery({
    query: SettingsSpaceQuery,
    variables: { id: spaceId },
    requestPolicy: "cache-and-network",
  });
  const space = result.data?.space ?? null;
  const spaceName =
    space?.name?.trim() || (result.fetching ? "Space" : "Space");

  const viewToggle = (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      aria-label={workspaceView ? "Space config" : "Space files"}
      title={workspaceView ? "Space config" : "Space files"}
    >
      {workspaceView ? (
        <Link to="/settings/spaces/$spaceId" params={{ spaceId }} search={{}}>
          <SlidersHorizontal className="size-4" />
          <span className="sr-only">Space config</span>
        </Link>
      ) : (
        <Link
          to="/settings/spaces/$spaceId"
          params={{ spaceId }}
          search={{ view: "workspace" }}
        >
          <FileText className="size-4" />
          <span className="sr-only">Space files</span>
        </Link>
      )}
    </Button>
  );

  usePageHeaderActions({
    title: spaceName,
    breadcrumbs: workspaceView
      ? [
          { label: "Spaces", href: "/settings/spaces" },
          {
            label: spaceName,
            href: `/settings/spaces/${spaceId}`,
            search: {},
          },
          { label: "Files" },
        ]
      : [{ label: "Spaces", href: "/settings/spaces" }, { label: spaceName }],
    action: viewToggle,
    actionKey: `space-detail:${spaceId}:${workspaceView ? "workspace" : "config"}`,
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

  if (workspaceView) {
    return (
      <div className="h-full min-h-0">
        <ScopedWorkspaceEditor
          target={{ spaceId }}
          targetKey={`space:${spaceId}`}
          defaultOpenFile={file}
          bordered={false}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <SpaceDeleteController
          tenantId={space.tenantId}
          spaceId={spaceId}
          spaceName={space.name}
          onDeleted={() => navigate({ to: "/settings/spaces" })}
          renderTrigger={(open) => (
            <SettingsPageTitle
              title={spaceName}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={open}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </Button>
              }
            />
          )}
        />
        <InformationSection
          spaceId={spaceId}
          tenantId={space.tenantId}
          name={space.name}
          description={space.description ?? ""}
          accessMode={(space.accessMode as SpaceAccessMode) ?? null}
          status={space.status}
          onSaved={() => refetch({ requestPolicy: "network-only" })}
        />
      </div>
    </div>
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

function SpaceDeleteController({
  tenantId,
  spaceId,
  spaceName,
  onDeleted,
  renderTrigger,
}: {
  tenantId: string;
  spaceId: string;
  spaceName: string;
  onDeleted: () => void;
  renderTrigger: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [{ fetching }, deleteSpace] = useMutation(SettingsDeleteSpaceMutation);

  async function onConfirm() {
    setErrorMsg(null);
    const result = await deleteSpace({ tenantId, id: spaceId });
    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    toast.success("Space deleted");
    setOpen(false);
    onDeleted();
  }

  return (
    <>
      {renderTrigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Space</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p>
              This archives {spaceName}. Existing threads and workspace source
              files are preserved, but the Space is removed from active use.
            </p>
            {errorMsg ? (
              <p className="text-sm text-destructive">{errorMsg}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={fetching}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onConfirm()}
              disabled={fetching}
            >
              {fetching ? "Deleting..." : "Delete Space"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
