import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  TenantSlugPicker,
  tenantSlugServerError,
} from "@/components/tenant/TenantSlugPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyableRow } from "@/components/ui/copyable-row";
import {
  DeploymentStatusQuery,
  RenameTenantSlugMutation,
  SetKnowledgeGraphDeploymentMutation,
  TenantDetailQuery,
} from "@/lib/graphql-queries";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCents, formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { tenantId, refetch: refetchTenantContext } = useTenant();
  useBreadcrumbs([{ label: "Settings" }]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [disableKnowledgeGraphOpen, setDisableKnowledgeGraphOpen] =
    useState(false);
  const [pendingKnowledgeGraphEnabled, setPendingKnowledgeGraphEnabled] =
    useState<boolean | null>(null);

  const [tenantResult, refetchTenant] = useQuery({
    query: TenantDetailQuery,
    variables: { id: tenantId! },
    pause: !tenantId,
  });
  const [renameResult, renameTenantSlug] = useMutation(
    RenameTenantSlugMutation,
  );

  const [deployResult, refetchDeploy] = useQuery({
    query: DeploymentStatusQuery,
  });
  const [knowledgeGraphResult, setKnowledgeGraphDeployment] = useMutation(
    SetKnowledgeGraphDeploymentMutation,
  );

  if (!tenantId) return <PageSkeleton />;

  const tenant = tenantResult.data?.tenant;
  const deploy = deployResult.data?.deploymentStatus;
  const knowledgeGraphDesiredEnabled =
    pendingKnowledgeGraphEnabled ?? Boolean(deploy?.cogneeEnabled);
  const knowledgeGraphQueued =
    pendingKnowledgeGraphEnabled !== null &&
    pendingKnowledgeGraphEnabled !== Boolean(deploy?.cogneeEnabled);

  async function submitTenantSlug(nextSlug: string) {
    if (!tenant) return;
    setSlugError(null);
    if (nextSlug === tenant.slug) {
      setRenameOpen(false);
      return;
    }
    const result = await renameTenantSlug({
      tenantId: tenant.id,
      newSlug: nextSlug,
    });
    if (result.error) {
      const code = result.error.graphQLErrors?.[0]?.extensions?.code;
      setSlugError(tenantSlugServerError(code, result.error.message));
      return;
    }
    toast.success("Tenant identifier updated.");
    setRenameOpen(false);
    refetchTenant({ requestPolicy: "network-only" });
    refetchTenantContext();
  }

  async function requestKnowledgeGraphDeployment(enabled: boolean) {
    const result = await setKnowledgeGraphDeployment({ enabled });
    if (result.error) {
      toast.error(
        `Could not ${enabled ? "enable" : "disable"} Knowledge Graph: ${result.error.message}`,
      );
      return;
    }
    setPendingKnowledgeGraphEnabled(enabled);
    setDisableKnowledgeGraphOpen(false);
    const message =
      result.data?.setKnowledgeGraphDeployment.message ??
      `Knowledge Graph ${enabled ? "enable" : "disable"} deployment queued.`;
    toast.success(message);
    refetchDeploy({ requestPolicy: "network-only" });
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Settings"
          description="Tenant configuration and preferences"
        />
      }
    >
      {tenantResult.fetching || !tenant ? (
        <PageSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Row label="Name" value={tenant.name} />
              <Row label="Plan" value={tenant.plan} />
              {tenant.issuePrefix && (
                <Row label="Issue Prefix" value={tenant.issuePrefix} />
              )}
              <Row label="Issue Counter" value={String(tenant.issueCounter)} />
              <Row label="Created" value={formatDateTime(tenant.createdAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tenant identifier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyableRow
                label="Subdomain"
                value={`${tenant.slug}.thinkwork.ai`}
              />
              <Button
                variant="outline"
                onClick={() => {
                  setSlugDraft(tenant.slug);
                  setSlugError(null);
                  setRenameOpen(true);
                }}
              >
                Rename
              </Button>
            </CardContent>
          </Card>

          {tenant.settings && (
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tenant.settings.defaultModel && (
                  <Row
                    label="Default Model"
                    value={tenant.settings.defaultModel}
                  />
                )}
                {tenant.settings.budgetMonthlyCents != null && (
                  <Row
                    label="Monthly Budget"
                    value={formatCents(tenant.settings.budgetMonthlyCents)}
                  />
                )}
                {tenant.settings.autoCloseThreadMinutes != null && (
                  <Row
                    label="Auto-close Threads"
                    value={`${tenant.settings.autoCloseThreadMinutes} min`}
                  />
                )}
                {tenant.settings.maxAgents != null && (
                  <Row
                    label="Max Agents"
                    value={String(tenant.settings.maxAgents)}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {deploy && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Knowledge Graph</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Cognee</div>
                      <div className="text-xs text-muted-foreground">
                        Ontology and knowledge-graph infrastructure
                      </div>
                    </div>
                    <Switch
                      checked={knowledgeGraphDesiredEnabled}
                      disabled={knowledgeGraphResult.fetching}
                      aria-label="Toggle Knowledge Graph infrastructure"
                      onCheckedChange={(checked) => {
                        if (checked) {
                          void requestKnowledgeGraphDeployment(true);
                        } else {
                          setDisableKnowledgeGraphOpen(true);
                        }
                      }}
                    />
                  </div>
                  <StatusRow
                    label="Status"
                    value={
                      knowledgeGraphQueued
                        ? "deployment queued"
                        : deploy.cogneeEnabled
                          ? "enabled"
                          : "disabled"
                    }
                    active={deploy.cogneeEnabled || knowledgeGraphQueued}
                  />
                  {deploy.cogneeBackendMode && (
                    <Row label="Backend" value={deploy.cogneeBackendMode} />
                  )}
                  {deploy.cogneeServiceName && (
                    <Row label="Service" value={deploy.cogneeServiceName} />
                  )}
                  {deploy.cogneeLogGroupName && (
                    <CopyableRow
                      label="Logs"
                      value={deploy.cogneeLogGroupName}
                    />
                  )}
                  {deploy.cogneeEndpoint && (
                    <CopyableRow
                      label="Endpoint"
                      value={deploy.cogneeEndpoint}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Deployment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Row label="Stage" value={deploy.stage} />
                  <Row label="Source" value={deploy.source} />
                  <Row label="Region" value={deploy.region} />
                  {deploy.accountId && (
                    <Row label="Account" value={deploy.accountId} />
                  )}
                  <StatusRow
                    label="AgentCore"
                    value={deploy.agentcoreStatus}
                    active={deploy.agentcoreStatus === "managed (always on)"}
                  />
                  <StatusRow
                    label="Memory"
                    value={
                      deploy.managedMemoryEnabled
                        ? "managed (always on)"
                        : "disabled"
                    }
                    active={deploy.managedMemoryEnabled}
                  />
                  <StatusRow
                    label="Hindsight"
                    value={deploy.hindsightEnabled ? "enabled" : "disabled"}
                    active={deploy.hindsightEnabled}
                  />
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Resources & URLs</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {deploy.bucketName && (
                    <CopyableRow label="S3 Bucket" value={deploy.bucketName} />
                  )}
                  {deploy.databaseEndpoint && (
                    <CopyableRow
                      label="Database"
                      value={deploy.databaseEndpoint}
                    />
                  )}
                  {deploy.ecrUrl && (
                    <CopyableRow label="ECR" value={deploy.ecrUrl} />
                  )}
                  {deploy.adminUrl && (
                    <CopyableRow label="Admin" value={deploy.adminUrl} url />
                  )}
                  {deploy.docsUrl && (
                    <CopyableRow label="Docs" value={deploy.docsUrl} url />
                  )}
                  {deploy.apiEndpoint && (
                    <CopyableRow label="API" value={deploy.apiEndpoint} url />
                  )}
                  {deploy.appsyncUrl && (
                    <CopyableRow
                      label="AppSync"
                      value={deploy.appsyncUrl}
                      url
                    />
                  )}
                  {deploy.appsyncRealtimeUrl && (
                    <CopyableRow
                      label="WebSocket"
                      value={deploy.appsyncRealtimeUrl}
                      url
                    />
                  )}
                  {deploy.hindsightEndpoint && (
                    <CopyableRow
                      label="Hindsight"
                      value={deploy.hindsightEndpoint}
                      url
                    />
                  )}
                  {deploy.cogneeEndpoint && (
                    <CopyableRow label="Cognee" value={deploy.cogneeEndpoint} />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename tenant identifier</DialogTitle>
            <DialogDescription>
              Existing tenant-scoped email addresses move to the new subdomain.
            </DialogDescription>
          </DialogHeader>
          {tenant && (
            <TenantSlugPicker
              value={slugDraft}
              onValueChange={(value) => {
                setSlugDraft(value);
                setSlugError(null);
              }}
              currentSlug={tenant.slug}
              serverError={slugError}
              loading={renameResult.fetching}
              submitLabel="Save"
              onCancel={() => setRenameOpen(false)}
              onSubmit={submitTenantSlug}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={disableKnowledgeGraphOpen}
        onOpenChange={setDisableKnowledgeGraphOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Knowledge Graph?</AlertDialogTitle>
            <AlertDialogDescription>
              This queues a Terraform deployment that disables Cognee
              infrastructure for the stage. Snapshot or export graph data before
              confirming if it needs to be retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void requestKnowledgeGraphDeployment(false)}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{value}</span>
    </div>
  );
}

function StatusRow({
  label,
  value,
  active,
}: {
  label: string;
  value: string | null | undefined;
  active: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <Badge variant={active ? "default" : "secondary"}>
        {value || "unknown"}
      </Badge>
    </div>
  );
}
