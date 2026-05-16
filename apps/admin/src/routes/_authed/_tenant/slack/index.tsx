import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw, Slack } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import {
  SlackWorkspacesQuery,
  StartSlackWorkspaceInstallMutation,
  UninstallSlackWorkspaceMutation,
} from "@/lib/graphql-queries";
import { SlackInstallDialog } from "./-slack-install-dialog";
import { WorkspacesTable, type SlackWorkspaceRow } from "./-workspaces-table";

export const Route = createFileRoute("/_authed/_tenant/slack/")({
  component: SlackWorkspacePage,
});

function SlackWorkspacePage() {
  const { tenantId } = useTenant();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  useBreadcrumbs([{ label: "Slack" }]);

  const [result, refetch] = useQuery({
    query: SlackWorkspacesQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [installState, startInstall] = useMutation(
    StartSlackWorkspaceInstallMutation,
  );
  const [, uninstallWorkspace] = useMutation(UninstallSlackWorkspaceMutation);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const install = params.get("slackInstall");
    if (!install) return;
    if (install === "success") {
      setNotice("Slack workspace installed.");
      refetch({ requestPolicy: "network-only" });
    } else {
      setInstallError(params.get("error") || "Slack install failed.");
      setDialogOpen(true);
    }
    params.delete("slackInstall");
    params.delete("team");
    params.delete("error");
    const next = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    window.history.replaceState({}, "", next);
  }, [refetch]);

  const rows: SlackWorkspaceRow[] = useMemo(
    () =>
      (result.data?.slackWorkspaces ?? []).map((workspace) => ({
        id: workspace.id,
        slackTeamId: workspace.slackTeamId,
        slackTeamName: workspace.slackTeamName ?? null,
        botUserId: workspace.botUserId,
        appId: workspace.appId,
        status: workspace.status,
        installedAt: workspace.installedAt,
        updatedAt: workspace.updatedAt,
      })),
    [result.data?.slackWorkspaces],
  );

  if (!tenantId) return <PageSkeleton />;
  const activeCount = rows.filter((row) => row.status === "active").length;

  async function beginInstall() {
    setInstallError(null);
    const response = await startInstall({
      input: {
        tenantId,
        returnUrl: `${window.location.origin}/slack`,
      },
    });
    if (response.error) {
      setInstallError(response.error.message);
      return;
    }
    const authorizeUrl = response.data?.startSlackWorkspaceInstall.authorizeUrl;
    if (!authorizeUrl) {
      setInstallError("Slack install did not return an authorization URL.");
      return;
    }
    window.location.assign(authorizeUrl);
  }

  async function uninstall(row: SlackWorkspaceRow) {
    setUninstallingId(row.id);
    setInstallError(null);
    const response = await uninstallWorkspace({ id: row.id });
    setUninstallingId(null);
    if (response.error) {
      setInstallError(response.error.message);
      return;
    }
    setNotice("Slack workspace uninstalled.");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Slack"
          description={`${activeCount} active workspace${activeCount === 1 ? "" : "s"}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="mr-1 h-4 w-4" />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Install Slack
              </Button>
            </div>
          }
        />
      }
    >
      {notice && (
        <div className="mb-3 rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
          {notice}
        </div>
      )}
      {installError && !dialogOpen && (
        <p className="mb-3 text-sm text-destructive">{installError}</p>
      )}
      {result.error && (
        <p className="mb-3 text-sm text-destructive">{result.error.message}</p>
      )}

      {result.fetching && !result.data ? (
        <PageSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={Slack}
              title="No Slack workspaces"
              description="Install Slack to make the workspace app available for this tenant."
            />
          </CardContent>
        </Card>
      ) : (
        <WorkspacesTable
          rows={rows}
          uninstallingId={uninstallingId}
          onUninstall={uninstall}
        />
      )}

      <SlackInstallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        installing={installState.fetching}
        error={installError}
        onInstall={beginInstall}
      />
    </PageLayout>
  );
}
