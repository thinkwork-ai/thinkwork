/**
 * Sync review page — shows diff per linked agent and lets admin apply selectively.
 * Reached via "Review each" button in TemplateSyncDialog after saving a template.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { toast } from "sonner";
import { ArrowLeft, Users, Loader2 } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AgentTemplateDetailQuery,
  LinkedAgentsForTemplateQuery,
  SyncTemplateToAllAgentsMutation,
} from "@/lib/graphql-queries";
import { AgentSyncCard } from "./-components/AgentSyncCard";

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/$templateId_/sync",
)({
  component: TemplateSyncReviewPage,
});

function TemplateSyncReviewPage() {
  const { templateId } = Route.useParams();
  const navigate = useNavigate();

  useBreadcrumbs([
    { label: "Templates", href: "/agent-templates" },
    { label: "Sync" },
  ]);

  const [{ data: templateData, fetching: templateFetching }] = useQuery({
    query: AgentTemplateDetailQuery,
    variables: { id: templateId },
  });
  const [{ data: linkedData, fetching: linkedFetching }, refetchLinked] = useQuery({
    query: LinkedAgentsForTemplateQuery,
    variables: { templateId },
  });

  const [{ fetching: pushing }, pushAll] = useMutation(SyncTemplateToAllAgentsMutation);

  const agentTemplate = templateData?.agentTemplate;
  const agents = linkedData?.linkedAgentsForTemplate ?? [];

  const handlePushAll = async () => {
    const res = await pushAll({ templateId });
    if (res.error) {
      toast.error(`Push failed: ${res.error.message}`);
      return;
    }
    const s = res.data?.syncTemplateToAllAgents;
    if (s) {
      if (s.agentsFailed > 0) {
        toast.warning(`Synced ${s.agentsSynced}, failed ${s.agentsFailed}`);
      } else {
        toast.success(`Synced ${s.agentsSynced} agent${s.agentsSynced === 1 ? "" : "s"}`);
      }
    }
    refetchLinked({ requestPolicy: "network-only" });
  };

  if (templateFetching || linkedFetching) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                navigate({
                  to: "/agent-templates/$templateId",
                  params: { templateId },
                })
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Sync to Linked Agents</h1>
              <p className="text-xs text-muted-foreground">
                {agentTemplate?.name} · {agents.length} linked agent
                {agents.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <Button onClick={handlePushAll} disabled={pushing || agents.length === 0}>
            {pushing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Push to all {agents.length}
          </Button>
        </div>
      }
    >
      <div className="max-w-3xl mx-auto space-y-3">
        {agents.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No agents are linked to this template.
              <div className="mt-3">
                <Button variant="outline" asChild>
                  <Link
                    to="/agent-templates/$templateId"
                    params={{ templateId }}
                  >
                    Back to template
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {agents.map((agent: any) => (
          <AgentSyncCard
            key={agent.id}
            templateId={templateId}
            agentId={agent.id}
            agentName={agent.name}
            agentSlug={agent.slug}
            onSynced={() => refetchLinked({ requestPolicy: "network-only" })}
          />
        ))}
      </div>
    </PageLayout>
  );
}
