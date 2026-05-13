import { useMemo } from "react";
import { gql, useQuery } from "urql";
import { PageLayout } from "@/components/PageLayout";
import type { Target } from "@/lib/agent-builder-api";
import { WorkspaceEditor } from "./WorkspaceEditor";

const AgentDetailQuery = gql`
  query AgentDetail($id: ID!) {
    agent(id: $id) {
      id
      name
      slug
    }
  }
`;

export interface AgentBuilderShellProps {
  agentId: string;
  initialFolder?: string;
}

export function AgentBuilderShell({
  agentId,
  initialFolder,
}: AgentBuilderShellProps) {
  const [result] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });
  const agent = result.data?.agent;
  const target = useMemo<Target>(() => ({ agentId }), [agentId]);

  return (
    <PageLayout
      header={
        <div className="flex w-full items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              Agent Builder
              {agent?.name ? (
                <span className="ml-2 font-medium text-muted-foreground">
                  : {agent.name}
                </span>
              ) : null}
            </h1>
          </div>
        </div>
      }
    >
      <WorkspaceEditor
        target={target}
        mode="agent"
        agentId={agentId}
        initialFolder={initialFolder}
      />
    </PageLayout>
  );
}
