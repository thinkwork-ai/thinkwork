import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { AlertCircle, AppWindow, Loader2, PlugZap } from "lucide-react";
import { Badge, Button, DataTable } from "@thinkwork/ui";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { InstalledPluginAppsQuery } from "@/lib/plugin-app-queries";
import type { InstalledPluginAppsQuery as InstalledPluginAppsQueryResult } from "@/gql/graphql";
import { TwentyClientEngagementApp } from "@/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp";

type InstalledPluginApp =
  InstalledPluginAppsQueryResult["installedPluginApps"][number];

type ApplicationRow = {
  id: string;
  pluginName: string;
  appName: string;
  statusLabel: string;
  isReady: boolean;
  pluginKey: string;
  routeSegment: string;
};

export function PluginAppsIndexRoute() {
  const [{ data, fetching, error }] = useQuery<InstalledPluginAppsQueryResult>({
    query: InstalledPluginAppsQuery,
    requestPolicy: "cache-and-network",
  });
  const apps = data?.installedPluginApps ?? [];

  usePageHeaderActions({
    title: "Applications",
    breadcrumbs: [{ label: "Applications" }],
  });

  if (fetching && apps.length === 0) return <PluginAppLoading />;
  if (error) {
    return (
      <PluginAppMessage
        icon={<AlertCircle className="size-5" />}
        title="Applications unavailable"
        description={error.message}
      />
    );
  }
  if (apps.length === 0) {
    return (
      <PluginAppMessage
        icon={<AppWindow className="size-5" />}
        title="No applications installed"
        description="Install a plugin application to open it here."
      />
    );
  }

  return <ApplicationsIndexPage apps={apps} />;
}

export function PluginAppRoute({
  pluginKey,
  appRouteSegment,
}: {
  pluginKey: string;
  appRouteSegment: string;
}) {
  const [{ data, fetching, error }] = useQuery<InstalledPluginAppsQueryResult>({
    query: InstalledPluginAppsQuery,
    requestPolicy: "cache-and-network",
  });
  const apps = data?.installedPluginApps ?? [];
  const app = apps.find(
    (candidate) =>
      candidate.pluginKey === pluginKey &&
      candidate.routeSegment === appRouteSegment,
  );

  if (fetching && !data) return <PluginAppLoading />;
  if (error) {
    return (
      <PluginAppMessage
        icon={<AlertCircle className="size-5" />}
        title="App unavailable"
        description={error.message}
      />
    );
  }
  if (!app) {
    return (
      <PluginAppMessage
        icon={<AppWindow className="size-5" />}
        title="App not found"
        description="The app may have been removed or is not available to your account."
      />
    );
  }
  if (app.readiness.state !== "ready") {
    return <PluginAppReadiness app={app} />;
  }

  return <PluginAppHost app={app} />;
}

function PluginAppHost({ app }: { app: InstalledPluginApp }) {
  if (app.pluginKey === "twenty" && app.appKey === "twenty-client-engagement") {
    return (
      <TwentyClientEngagementApp
        appDisplayName={app.displayName}
        pluginDisplayName={app.pluginDisplayName}
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <AppWindow className="size-4 text-muted-foreground" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">
            {app.displayName}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {app.pluginDisplayName}
          </p>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <AppWindow className="size-5" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">
              {app.displayName}
            </h2>
            {app.description ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {app.description}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    </section>
  );
}

function ApplicationsIndexPage({ apps }: { apps: InstalledPluginApp[] }) {
  const navigate = useNavigate();
  const rows = useMemo<ApplicationRow[]>(
    () =>
      apps.map((app) => ({
        id: app.id,
        pluginName: app.pluginDisplayName,
        appName: app.displayName,
        statusLabel:
          app.readiness.state === "ready" ? "Ready" : app.readiness.message,
        isReady: app.readiness.state === "ready",
        pluginKey: app.pluginKey,
        routeSegment: app.routeSegment,
      })),
    [apps],
  );
  const columns = useMemo<ColumnDef<ApplicationRow>[]>(
    () => [
      {
        accessorKey: "pluginName",
        header: "Plugin",
        cell: ({ row }) => (
          <span
            className="block truncate text-sm font-semibold text-foreground"
            title={row.original.pluginName}
          >
            {row.original.pluginName}
          </span>
        ),
      },
      {
        accessorKey: "appName",
        header: "Application",
        cell: ({ row }) => (
          <span
            className="block truncate text-sm text-muted-foreground"
            title={row.original.appName}
          >
            {row.original.appName}
          </span>
        ),
      },
      {
        accessorKey: "statusLabel",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={
              row.original.isReady
                ? "rounded-full border-green-500/40 bg-green-500/10 px-2 text-xs font-medium text-green-400"
                : "max-w-full rounded-full bg-muted/10 px-2 text-xs font-medium text-muted-foreground"
            }
          >
            <span className="truncate">{row.original.statusLabel}</span>
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <SettingsPageTitle
          title="Applications"
          description="Open installed plugin applications and custom workspace projections."
        />
        <DataTable
          columns={columns}
          data={rows}
          onRowClick={(row) => {
            void navigate({
              to: "/apps/$pluginKey/$appRouteSegment",
              params: {
                pluginKey: row.pluginKey,
                appRouteSegment: row.routeSegment,
              },
            });
          }}
          allowHorizontalScroll={false}
          pageSize={10}
          tableClassName="table-fixed [&_tbody_tr:last-child]:shadow-none"
          emptyState="No applications installed."
        />
      </main>
    </section>
  );
}

function PluginAppReadiness({ app }: { app: InstalledPluginApp }) {
  const navigate = useNavigate();
  const action = readinessAction(app);

  return (
    <PluginAppMessage
      icon={<PlugZap className="size-5" />}
      title={app.displayName}
      description={app.readiness.message}
      action={
        action ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void navigate(action.to);
            }}
          >
            {action.label}
          </Button>
        ) : null
      }
    />
  );
}

function PluginAppLoading() {
  return (
    <PluginAppMessage
      icon={<Loader2 className="size-5 animate-spin" />}
      title="Loading apps"
      description="Checking installed app surfaces."
    />
  );
}

function PluginAppMessage({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 items-center justify-center bg-background p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
        <Link
          to="/new"
          search={{ spaceId: undefined }}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          New thread
        </Link>
      </div>
    </section>
  );
}

function readinessAction(app: InstalledPluginApp) {
  if (app.readiness.nextAction === "connect_plugin") {
    return {
      label: "Connect plugin",
      to: {
        to: "/settings/plugins/$pluginKey",
        params: { pluginKey: app.pluginKey },
      },
    };
  }
  if (app.readiness.nextAction === "open_plugin_settings") {
    return {
      label: "Open plugin settings",
      to: {
        to: "/settings/plugins/$pluginKey",
        params: { pluginKey: app.pluginKey },
      },
    };
  }
  return null;
}
