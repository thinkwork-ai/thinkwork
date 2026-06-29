import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { AlertCircle, AppWindow, Loader2, PlugZap } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { InstalledPluginAppsQuery } from "@/lib/plugin-app-queries";
import type { InstalledPluginAppsQuery as InstalledPluginAppsQueryResult } from "@/gql/graphql";
import { TwentyClientEngagementApp } from "@/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp";

type InstalledPluginApp =
  InstalledPluginAppsQueryResult["installedPluginApps"][number];

export function PluginAppsIndexRoute() {
  const navigate = useNavigate();
  const [{ data, fetching, error }] = useQuery<InstalledPluginAppsQueryResult>({
    query: InstalledPluginAppsQuery,
    requestPolicy: "cache-and-network",
  });
  const apps = data?.installedPluginApps ?? [];

  useEffect(() => {
    const firstApp = apps[0];
    if (!firstApp) return;
    void navigate({
      to: "/apps/$appRouteSegment",
      params: { appRouteSegment: firstApp.routeSegment },
      replace: true,
    });
  }, [apps, navigate]);

  if (fetching && apps.length === 0) return <PluginAppLoading />;
  if (error) {
    return (
      <PluginAppMessage
        icon={<AlertCircle className="size-5" />}
        title="Apps unavailable"
        description={error.message}
      />
    );
  }
  if (apps.length === 0) {
    return (
      <PluginAppMessage
        icon={<AppWindow className="size-5" />}
        title="No apps installed"
        description="Install a plugin app to open it here."
      />
    );
  }

  return <PluginAppLoading />;
}

export function PluginAppRoute({
  appRouteSegment,
}: {
  appRouteSegment: string;
}) {
  const [{ data, fetching, error }] = useQuery<InstalledPluginAppsQueryResult>({
    query: InstalledPluginAppsQuery,
    requestPolicy: "cache-and-network",
  });
  const apps = data?.installedPluginApps ?? [];
  const app = apps.find(
    (candidate) => candidate.routeSegment === appRouteSegment,
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
    return <TwentyClientEngagementApp appDisplayName={app.displayName} />;
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
