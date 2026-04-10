import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TenantDetailQuery } from "@/lib/graphql-queries";
import { formatCents, formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([{ label: "Settings" }]);

  const [result] = useQuery({
    query: TenantDetailQuery,
    variables: { id: tenantId! },
    pause: !tenantId,
  });

  if (!tenantId) return <PageSkeleton />;

  const tenant = result.data?.tenant;

  return (
    <PageLayout
      header={<PageHeader title="Settings" description="Tenant configuration and preferences" />}
    >
      {result.fetching || !tenant ? (
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
