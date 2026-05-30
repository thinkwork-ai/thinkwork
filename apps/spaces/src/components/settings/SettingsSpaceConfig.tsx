import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
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
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { SpaceAccessMode } from "@/gql/graphql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";
import {
  SettingsSpaceQuery,
  SettingsUpdateSpaceMutation,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

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

  // Title lives in the settings header bar as nested breadcrumbs; the "Spaces"
  // crumb links back to the list. A header action opens the Space in the app.
  usePageHeaderActions({
    title: spaceName,
    breadcrumbs: [
      { label: "Spaces", href: "/settings/spaces" },
      { label: spaceName },
    ],
    action: (
      <Button asChild variant="ghost" size="sm">
        <Link to="/spaces/$spaceId" params={{ spaceId }}>
          Open in app
        </Link>
      </Button>
    ),
    actionKey: `space-config:${spaceId}`,
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
      <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This space could not be loaded — it may have been removed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="shrink-0 px-6 pt-6">
        <div className="mx-auto w-full max-w-3xl">
          <DetailsSection
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
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-8">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <h2 className="mb-3 shrink-0 text-base font-medium text-foreground">
            Instructions &amp; files
          </h2>
          <WorkspaceFileEditor
            target={{ spaceId }}
            targetKey={`space:${spaceId}`}
            client={spacesWorkspaceFilesClient}
            defaultOpenFile="CONTEXT.md"
            className="min-h-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
}

function DetailsSection({
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
    <SettingsSection
      label="Space"
      action={
        <div className="flex items-center gap-3">
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
      }
    >
      <div className="space-y-4 p-4">
        <Labeled label="Name">
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Labeled>
        <Labeled label="Description">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
        </Labeled>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Access">
            <Select
              value={form.accessMode}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, accessMode: v as SpaceAccessMode }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SpaceAccessMode.Public}>Public</SelectItem>
                <SelectItem value={SpaceAccessMode.Private}>Private</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <div>
              <Badge variant="secondary">{titleCase(status)}</Badge>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
