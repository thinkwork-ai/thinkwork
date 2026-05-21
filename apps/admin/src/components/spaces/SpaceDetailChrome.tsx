import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { type SpaceAdminDetailQuery as SpaceAdminDetailQueryResult } from "@/gql/graphql";
import {
  SpaceAdminDetailQuery,
  UpdateSpaceMutation,
} from "@/lib/graphql-queries";

type SpaceDetailTab =
  | "configuration"
  | "workspace"
  | "tools"
  | "memory"
  | "automations";
type Space = NonNullable<SpaceAdminDetailQueryResult["space"]>;
type SpaceAccessMode = "PUBLIC" | "PRIVATE";
type SpaceDraft = {
  name: string;
  description: string;
  accessMode: SpaceAccessMode;
};

interface SpaceDetailChromeContext {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
}

interface SpaceDetailChromeProps {
  spaceId: string;
  activeTab: SpaceDetailTab;
  children: (context: SpaceDetailChromeContext) => ReactNode;
}

export function SpaceDetailChrome({
  spaceId,
  activeTab,
  children,
}: SpaceDetailChromeProps) {
  const { tenantId } = useTenant();
  const [draft, setDraft] = useState<SpaceDraft>({
    name: "",
    description: "",
    accessMode: "PUBLIC",
  });
  const [updateResult, updateSpace] = useMutation(UpdateSpaceMutation);

  const [spaceResult, reexecuteSpaceQuery] = useQuery({
    query: SpaceAdminDetailQuery,
    variables: { id: spaceId },
    pause: !spaceId,
    requestPolicy: "cache-and-network",
  });

  const space = spaceResult.data?.space ?? null;

  useEffect(() => {
    if (!space) return;
    setDraft({
      name: space.name,
      description: space.description ?? "",
      accessMode: space.accessMode as SpaceAccessMode,
    });
  }, [space?.id, space?.name, space?.description, space?.accessMode]);

  useBreadcrumbs([
    { label: "Spaces", href: "/spaces" },
    { label: space?.name ?? "Space" },
  ]);

  const dirty = Boolean(
    space &&
      (draft.name.trim() !== space.name ||
        (draft.description.trim() || null) !== (space.description ?? null) ||
        draft.accessMode !== space.accessMode),
  );
  const canSave =
    dirty && draft.name.trim().length > 0 && !updateResult.fetching;

  async function handleSaveSpace() {
    if (!space || !tenantId || !canSave) return;
    const response = await updateSpace({
      input: {
        tenantId,
        spaceId: space.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        accessMode: draft.accessMode,
      },
    });

    if (response.error) {
      toast.error(`Could not save Space: ${response.error.message}`);
      return;
    }

    const updated = response.data?.updateSpace;
    if (updated) {
      setDraft({
        name: updated.name,
        description: updated.description ?? "",
        accessMode: updated.accessMode as SpaceAccessMode,
      });
    }
    toast.success("Space saved.");
    reexecuteSpaceQuery({ requestPolicy: "network-only" });
  }

  if (!tenantId || (spaceResult.fetching && !spaceResult.data)) {
    return <PageSkeleton />;
  }

  if (!space) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Space not found"
            description={spaceResult.error?.message}
          />
        }
      >
        <div className="text-sm text-muted-foreground">
          The Space could not be loaded or is not available to this tenant.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
            {space.name}
          </h1>
          <div className="flex justify-start lg:justify-center">
            <Tabs value={activeTab}>
              <TabsList>
                <TabsTrigger value="configuration" asChild className="px-4">
                  <Link
                    to="/spaces/$spaceId/configuration"
                    params={{ spaceId }}
                  >
                    Configuration
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="workspace" asChild className="px-4">
                  <Link to="/spaces/$spaceId/workspace" params={{ spaceId }}>
                    Workspace
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="tools" asChild className="px-4">
                  <Link to="/spaces/$spaceId/tools" params={{ spaceId }}>
                    Tools
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="memory" asChild className="px-4">
                  <Link to="/spaces/$spaceId/memory" params={{ spaceId }}>
                    Memory
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="automations" asChild className="px-4">
                  <Link to="/spaces/$spaceId/automations" params={{ spaceId }}>
                    Automations
                  </Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex justify-start lg:justify-end">
            {dirty ? (
              <Button size="sm" onClick={handleSaveSpace} disabled={!canSave}>
                {updateResult.fetching ? "Saving..." : "Save"}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {children({
        space,
        draft,
        setDraft,
      })}
    </PageLayout>
  );
}

export function SpaceConfigurationPanel({
  draft,
  setDraft,
}: {
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
}) {
  return (
    <section className="rounded-md border p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="space-name">Name</Label>
          <Input
            id="space-name"
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="space-access">Access</Label>
          <Select
            value={draft.accessMode}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                accessMode: value as SpaceAccessMode,
              }))
            }
          >
            <SelectTrigger id="space-access">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Public</SelectItem>
              <SelectItem value="PRIVATE">Private</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="space-description">Description</Label>
          <Textarea
            id="space-description"
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </div>
      </div>
    </section>
  );
}

export function SpaceWorkspacePanel({ spaceId }: { spaceId: string }) {
  return (
    <WorkspaceEditor
      target={{ spaceId }}
      mode="context"
      className="min-h-[620px]"
    />
  );
}

export function SpaceToolsPanel() {
  return <EmptyPanel title="No tools selected." />;
}

export function SpaceMemoryPanel() {
  return <EmptyPanel title="No knowledge bases selected." />;
}

export function SpaceAutomationsPanel() {
  return <EmptyPanel title="No Space automations." />;
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <section className="rounded-md border p-4 text-sm text-muted-foreground">
      {title}
    </section>
  );
}
