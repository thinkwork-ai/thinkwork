import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "urql";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import {
  type DashboardArtifactManifest,
  type DashboardArtifactRefreshTask,
  getFixtureDashboardManifestByArtifactId,
} from "@/lib/app-artifacts";
import {
  DashboardArtifactQuery,
  RefreshDashboardArtifactMutation,
} from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/apps/$id")({
  component: AppArtifactPage,
});

interface DashboardArtifactResult {
  dashboardArtifact?: {
    manifest?: unknown;
    latestRefreshTask?: DashboardArtifactRefreshTask | null;
    canRefresh?: boolean | null;
  } | null;
}

interface RefreshDashboardArtifactResult {
  refreshDashboardArtifact?: {
    task?: DashboardArtifactRefreshTask | null;
  } | null;
}

function AppArtifactPage() {
  const { id } = Route.useParams();
  const [{ data, fetching, error }, reexecuteDashboardQuery] =
    useQuery<DashboardArtifactResult>({
      query: DashboardArtifactQuery,
      variables: { id },
      requestPolicy: "cache-and-network",
    });
  const [, refreshDashboardArtifact] =
    useMutation<RefreshDashboardArtifactResult>(
      RefreshDashboardArtifactMutation,
    );
  const fixtureManifest = getFixtureDashboardManifestByArtifactId(id);
  const manifest = useMemo(
    () =>
      parseDashboardManifest(data?.dashboardArtifact?.manifest) ??
      fixtureManifest,
    [data?.dashboardArtifact?.manifest, fixtureManifest],
  );
  const appLabel = manifest?.snapshot?.title?.trim() || "App";
  useBreadcrumbs([{ label: "Apps", href: "/apps" }, { label: appLabel }]);
  const latestRefreshTask = data?.dashboardArtifact?.latestRefreshTask ?? null;
  const isRefreshActive = ["pending", "running"].includes(
    String(latestRefreshTask?.status ?? "").toLowerCase(),
  );

  useEffect(() => {
    if (!isRefreshActive) return;
    const interval = window.setInterval(() => {
      reexecuteDashboardQuery({ requestPolicy: "network-only" });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [isRefreshActive, reexecuteDashboardQuery]);

  if (!manifest) {
    return (
      <main className="flex h-svh items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          {fetching
            ? "Loading generated app..."
            : error?.message || "Generated app not found."}
        </p>
      </main>
    );
  }

  return (
    <AppArtifactSplitShell
      manifest={manifest}
      latestRefreshTask={latestRefreshTask}
      canRefresh={data?.dashboardArtifact?.canRefresh ?? false}
      onRefreshDashboardArtifact={async () => {
        const result = await refreshDashboardArtifact({ id });
        if (result.error) throw result.error;
        reexecuteDashboardQuery({ requestPolicy: "network-only" });
        return result.data?.refreshDashboardArtifact?.task ?? null;
      }}
      onRefreshSettled={() =>
        reexecuteDashboardQuery({ requestPolicy: "network-only" })
      }
    />
  );
}

function parseDashboardManifest(
  value: unknown,
): DashboardArtifactManifest | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as DashboardArtifactManifest;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as DashboardArtifactManifest;
  }
  return null;
}
