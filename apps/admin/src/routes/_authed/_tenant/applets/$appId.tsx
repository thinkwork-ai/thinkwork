import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Braces, Code2 } from "lucide-react";
import { useQuery } from "urql";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { AdminAppletQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/applets/$appId")({
  component: AppletDetailPage,
});

function AppletDetailPage() {
  const { appId } = Route.useParams();
  const navigate = useNavigate();
  const [result] = useQuery({
    query: AdminAppletQuery,
    variables: { appId },
    requestPolicy: "cache-and-network",
  });

  const payload = result.data?.adminApplet;
  const applet = payload?.applet;

  useBreadcrumbs([
    { label: "Applets", href: "/applets" },
    { label: applet?.name ?? "Applet" },
  ]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  if (!payload || !applet) {
    return (
      <PageLayout
        header={
          <PageHeader title="Applet not found">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/applets" })}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Applets
            </Button>
          </PageHeader>
        }
      >
        <EmptyState
          icon={Code2}
          title="Applet unavailable"
          description="The applet may have been deleted or the current account cannot inspect it."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <PageHeader title={applet.name}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/applets" })}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </PageHeader>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Code2 className="h-4 w-4 text-primary" />
            Source
          </div>
          <pre className="max-h-[calc(100vh-16rem)] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-relaxed">
            <code>{payload.source}</code>
          </pre>
        </section>

        <aside className="min-w-0 space-y-4">
          <section className="space-y-2 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Provenance</h2>
            <dl className="grid gap-2 text-sm">
              <Detail label="App ID" value={applet.appId} />
              <Detail label="Version" value={`v${applet.version}`} />
              <Detail
                label="Generated"
                value={relativeTime(applet.generatedAt)}
              />
              <Detail label="Thread" value={applet.threadId ?? "None"} />
              <Detail label="Agent" value={applet.artifact.agentId ?? "None"} />
              <Detail label="Model" value={applet.modelId ?? "Unknown"} />
              <Detail label="Stdlib" value={applet.stdlibVersionAtGeneration} />
            </dl>
          </section>

          <section className="space-y-2 rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Braces className="h-4 w-4 text-primary" />
              Metadata
            </div>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/30 p-3 text-xs leading-relaxed">
              <code>{formatJson(payload.metadata)}</code>
            </pre>
          </section>
        </aside>
      </div>
    </PageLayout>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value ?? {}, null, 2);
}
