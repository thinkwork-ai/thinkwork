import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { graphql } from "@/gql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsPane } from "@/components/settings/SettingsContent";

// THINK-137 U8 (R8): the Webhooks detail surface retired. A webhook is now an
// Automation; this route resolves the webhook's owning Automation and redirects
// to its detail. Webhooks with no bound Automation (or a missing id) fall back
// to the Automations index.
const WebhookOwningLoopQuery = graphql(`
  query WebhookOwningLoop($id: ID!) {
    webhook(id: $id) {
      id
      agentLoopId
    }
  }
`);

export const Route = createFileRoute("/_authed/settings/webhooks/$webhookId")({
  component: WebhookDetailRedirect,
});

function WebhookDetailRedirect() {
  const { webhookId } = Route.useParams();
  const navigate = useNavigate();
  const [result] = useQuery({
    query: WebhookOwningLoopQuery,
    variables: { id: webhookId },
  });

  useEffect(() => {
    if (result.fetching) return;
    const agentLoopId = result.data?.webhook?.agentLoopId ?? null;
    if (agentLoopId) {
      navigate({
        to: "/settings/agent-loops/$agentLoopId",
        params: { agentLoopId },
        replace: true,
      });
    } else {
      navigate({ to: "/settings/automations", replace: true });
    }
  }, [result.fetching, result.data, navigate]);

  return (
    <SettingsPane>
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    </SettingsPane>
  );
}
