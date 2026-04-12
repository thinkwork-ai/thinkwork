import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Copy, Check } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TenantDetailQuery, DeploymentStatusQuery } from "@/lib/graphql-queries";
import { formatCents, formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([{ label: "Settings" }]);

  const [tenantResult] = useQuery({
    query: TenantDetailQuery,
    variables: { id: tenantId! },
    pause: !tenantId,
  });

  const [deployResult] = useQuery({ query: DeploymentStatusQuery });

  if (!tenantId) return <PageSkeleton />;

  const tenant = tenantResult.data?.tenant;
  const deploy = deployResult.data?.deploymentStatus;

  return (
    <PageLayout
      header={<PageHeader title="Settings" description="Tenant configuration and preferences" />}
    >
      {tenantResult.fetching || !tenant ? (
        <PageSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Row label="Name" value={tenant.name} />
              <Row label="Slug" value={tenant.slug} />
              <Row label="Plan" value={tenant.plan} />
              {tenant.issuePrefix && <Row label="Issue Prefix" value={tenant.issuePrefix} />}
              <Row label="Issue Counter" value={String(tenant.issueCounter)} />
              <Row label="Created" value={formatDateTime(tenant.createdAt)} />
            </CardContent>
          </Card>

          {tenant.settings && (
            <Card>
              <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {tenant.settings.defaultModel && (
                  <Row label="Default Model" value={tenant.settings.defaultModel} />
                )}
                {tenant.settings.budgetMonthlyCents != null && (
                  <Row label="Monthly Budget" value={formatCents(tenant.settings.budgetMonthlyCents)} />
                )}
                {tenant.settings.autoCloseThreadMinutes != null && (
                  <Row label="Auto-close Threads" value={`${tenant.settings.autoCloseThreadMinutes} min`} />
                )}
                {tenant.settings.maxAgents != null && (
                  <Row label="Max Agents" value={String(tenant.settings.maxAgents)} />
                )}
              </CardContent>
            </Card>
          )}

          {deploy && (
            <>
              <Card>
                <CardHeader><CardTitle>Deployment</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Row label="Stage" value={deploy.stage} />
                  <Row label="Source" value={deploy.source} />
                  <Row label="Region" value={deploy.region} />
                  {deploy.accountId && <Row label="Account" value={deploy.accountId} />}
                  <StatusRow label="AgentCore" value={deploy.agentcoreStatus} active={deploy.agentcoreStatus === "managed (always on)"} />
                  <StatusRow label="Memory" value={deploy.managedMemoryEnabled ? "managed (always on)" : "disabled"} active={deploy.managedMemoryEnabled} />
                  <StatusRow label="Hindsight" value={deploy.hindsightEnabled ? "enabled" : "disabled"} active={deploy.hindsightEnabled} />
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Resources & URLs</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {deploy.bucketName && <CopyableRow label="S3 Bucket" value={deploy.bucketName} />}
                  {deploy.databaseEndpoint && <CopyableRow label="Database" value={deploy.databaseEndpoint} />}
                  {deploy.ecrUrl && <CopyableRow label="ECR" value={deploy.ecrUrl} />}
                  {deploy.adminUrl && <CopyableRow label="Admin" value={deploy.adminUrl} url />}
                  {deploy.docsUrl && <CopyableRow label="Docs" value={deploy.docsUrl} url />}
                  {deploy.apiEndpoint && <CopyableRow label="API" value={deploy.apiEndpoint} url />}
                  {deploy.appsyncUrl && <CopyableRow label="AppSync" value={deploy.appsyncUrl} url />}
                  {deploy.appsyncRealtimeUrl && <CopyableRow label="WebSocket" value={deploy.appsyncRealtimeUrl} url />}
                  {deploy.hindsightEndpoint && <CopyableRow label="Hindsight" value={deploy.hindsightEndpoint} url />}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </PageLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatusRow({ label, value, active }: { label: string; value: string | null | undefined; active: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={active ? "default" : "secondary"}>{value || "unknown"}</Badge>
    </div>
  );
}

function CopyableRow({ label, value, url }: { label: string; value: string; url?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center justify-between text-sm gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {url ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-primary hover:underline"
          >
            {value.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span className="truncate">{value}</span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
