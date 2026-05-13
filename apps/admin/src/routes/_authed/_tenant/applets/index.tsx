import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { AppWindow, Palette, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AdminAppletsQuery,
  TenantDetailQuery,
  UpdateTenantArtifactStyleMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/applets/")({
  component: AppletsPage,
});

type AppletRow = {
  appId: string;
  name: string;
  version: number;
  threadId: string | null;
  agentId: string | null;
  prompt: string | null;
  generatedAt: string;
  stdlibVersionAtGeneration: string;
};

const columns: ColumnDef<AppletRow>[] = [
  {
    accessorKey: "name",
    header: "App",
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <AppWindow className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate max-w-[320px]">{row.original.name}</span>
      </span>
    ),
  },
  {
    accessorKey: "version",
    header: "Version",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">
        v{row.original.version}
      </span>
    ),
    size: 90,
  },
  {
    accessorKey: "threadId",
    header: "Thread",
    cell: ({ row }) => (
      <span className="block max-w-[220px] truncate text-sm text-muted-foreground">
        {row.original.threadId ?? "None"}
      </span>
    ),
  },
  {
    accessorKey: "generatedAt",
    header: "Generated",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {relativeTime(row.original.generatedAt)}
      </span>
    ),
    size: 120,
  },
];

function AppletsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [userFilter, setUserFilter] = useState("");
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const trimmedUserFilter = userFilter.trim();

  useBreadcrumbs([{ label: "Artifacts" }]);

  const [result] = useQuery({
    query: AdminAppletsQuery,
    variables: {
      tenantId: tenantId!,
      userId: trimmedUserFilter || null,
      limit: 50,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [settingsResult, refetchSettings] = useQuery({
    query: TenantDetailQuery,
    variables: { id: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, updateTenantArtifactStyle] = useMutation(
    UpdateTenantArtifactStyleMutation,
  );

  const rows = useMemo<AppletRow[]>(() => {
    const nodes = result.data?.adminApplets.nodes ?? [];
    return nodes.map((applet) => ({
      appId: applet.appId,
      name: applet.name,
      version: applet.version,
      threadId: applet.threadId ?? applet.artifact.threadId ?? null,
      agentId: applet.artifact.agentId ?? null,
      prompt: applet.prompt ?? null,
      generatedAt: applet.generatedAt,
      stdlibVersionAtGeneration: applet.stdlibVersionAtGeneration,
    }));
  }, [result.data]);
  const features = normalizeFeatures(
    settingsResult.data?.tenant?.settings?.features,
  );
  const savedTheme = appletThemeFromFeatures(features);

  if (result.fetching && !result.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Artifacts"
          actions={
            <Button
              type="button"
              variant={savedTheme ? "secondary" : "default"}
              onClick={() => setStyleDialogOpen(true)}
            >
              <Palette className="mr-2 h-4 w-4" />
              Set App Style
            </Button>
          }
        >
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
              placeholder="Filter by user ID"
              className="pl-8"
            />
          </div>
        </PageHeader>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={AppWindow}
          title="No apps found"
          description="Apps created by Computer will appear here for read-only support inspection."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          pageSize={10}
          onRowClick={(row) =>
            navigate({
              to: "/applets/$appId",
              params: { appId: row.appId },
            })
          }
        />
      )}
      <SetAppStyleDialog
        open={styleDialogOpen}
        onOpenChange={setStyleDialogOpen}
        savedThemeCss={savedTheme?.css ?? ""}
        saving={settingsResult.fetching}
        onSave={async (css) => {
          if (!tenantId) return;
          const appletTheme = buildAppletTheme(css);
          if (!appletTheme) {
            throw new Error(
              "Paste the globals.css Theme block copied from shadcn Create.",
            );
          }
          const nextFeatures = {
            ...features,
            artifactStyle: {
              ...(normalizeRecord(features.artifactStyle) ?? {}),
              appletTheme,
              updatedAt: new Date().toISOString(),
            },
          };
          const result = await updateTenantArtifactStyle({
            tenantId,
            input: { features: JSON.stringify(nextFeatures) },
          });
          if (result.error) throw new Error(result.error.message);
          refetchSettings({ requestPolicy: "network-only" });
        }}
        onClear={async () => {
          if (!tenantId) return;
          const { appletTheme: _unused, ...artifactStyle } =
            normalizeRecord(features.artifactStyle) ?? {};
          const nextFeatures = {
            ...features,
            artifactStyle: {
              ...artifactStyle,
              updatedAt: new Date().toISOString(),
            },
          };
          const result = await updateTenantArtifactStyle({
            tenantId,
            input: { features: JSON.stringify(nextFeatures) },
          });
          if (result.error) throw new Error(result.error.message);
          refetchSettings({ requestPolicy: "network-only" });
        }}
      />
    </PageLayout>
  );
}

function SetAppStyleDialog({
  open,
  onOpenChange,
  savedThemeCss,
  saving,
  onSave,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedThemeCss: string;
  saving: boolean;
  onSave: (css: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [css, setCss] = useState(savedThemeCss);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCss(savedThemeCss);
      setError(null);
    }
  }, [open, savedThemeCss]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      setCss(await file.text());
      setError(null);
    } catch {
      setError("Could not read that theme file.");
    }
  }

  async function submit(kind: "save" | "clear") {
    setSubmitting(true);
    setError(null);
    try {
      if (kind === "save") await onSave(css);
      else await onClear();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update style.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set App Style</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Paste the Theme code copied from shadcn Create. These tokens are
            stored on tenant settings and injected into every rendered app
            artifact unless an artifact carries its own theme.
          </p>
          <div className="flex justify-end">
            <label>
              <input
                type="file"
                accept=".css,text/css,text/plain"
                className="sr-only"
                onChange={(event) =>
                  void handleFile(event.currentTarget.files?.[0])
                }
              />
              <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                <Upload className="h-4 w-4" />
                Upload CSS
              </span>
            </label>
          </div>
          <Textarea
            value={css}
            onChange={(event) => setCss(event.target.value)}
            placeholder=":root { --background: oklch(...); --chart-1: oklch(...); }"
            className="min-h-72 font-mono text-xs"
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting || saving}
            onClick={() => void submit("clear")}
          >
            Clear
          </Button>
          <Button
            type="button"
            disabled={submitting || saving}
            onClick={() => void submit("save")}
          >
            Save Style
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeFeatures(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return normalizeRecord(value) ?? {};
}

function appletThemeFromFeatures(features: Record<string, unknown>) {
  const artifactStyle = normalizeRecord(features.artifactStyle);
  const appletTheme = normalizeRecord(artifactStyle?.appletTheme);
  if (!appletTheme || typeof appletTheme.css !== "string") return null;
  return {
    source:
      typeof appletTheme.source === "string"
        ? appletTheme.source
        : "shadcn-create",
    css: appletTheme.css,
  };
}

function buildAppletTheme(css: string) {
  const trimmed = css.trim();
  if (!trimmed || trimmed.length > 20_000) return null;
  if (!trimmed.includes(":root") && !trimmed.includes(".dark")) return null;
  if (
    !Object.keys(parseThemeTokens(trimmed, "light")).length &&
    !Object.keys(parseThemeTokens(trimmed, "dark")).length
  ) {
    return null;
  }
  return { source: "shadcn-create", css: trimmed };
}

function parseThemeTokens(css: string, theme: "light" | "dark") {
  const selector = theme === "dark" ? "\\.dark" : ":root";
  const blockPattern = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`, "g");
  const tokens: Record<string, string> = {};
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(css))) {
    const tokenPattern = /(--[a-z0-9-]+)\s*:\s*([^;{}<>]+)\s*;?/gi;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = tokenPattern.exec(blockMatch[1] ?? ""))) {
      const name = tokenMatch[1]?.trim();
      const value = tokenMatch[2]?.trim();
      if (!name || !value) continue;
      if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(value)) {
        continue;
      }
      tokens[name] = value;
    }
  }
  return tokens;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
