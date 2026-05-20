import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SpaceAgentAssignmentStatus } from "@/gql/graphql";
import {
  SetSpaceAgentAvailabilityMutation,
  SpacesListQuery,
} from "@/lib/graphql-queries";

interface AgentSpacesPanelProps {
  tenantId: string;
  agentId: string;
}

export function AgentSpacesPanel({ tenantId, agentId }: AgentSpacesPanelProps) {
  const [pendingSpaceId, setPendingSpaceId] = useState<string | null>(null);
  const [spacesResult, reexecuteSpaces] = useQuery({
    query: SpacesListQuery,
    variables: { tenantId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, setAvailability] = useMutation(SetSpaceAgentAvailabilityMutation);

  const rows = useMemo(
    () =>
      (spacesResult.data?.spaces ?? []).map((space) => {
        const assignment = space.agentAssignments.find(
          (item) => item.agent?.id === agentId,
        );
        const active = assignment?.status === SpaceAgentAssignmentStatus.Active;
        return {
          id: space.id,
          name: space.name,
          slug: space.slug,
          kind: space.kind,
          active,
          status: assignment?.status ?? null,
        };
      }),
    [agentId, spacesResult.data?.spaces],
  );

  async function toggleSpace(spaceId: string, enabled: boolean) {
    setPendingSpaceId(spaceId);
    const response = await setAvailability({
      input: {
        tenantId,
        spaceId,
        agentId,
        enabled,
      },
    });
    setPendingSpaceId(null);

    if (response.error) {
      toast.error(
        `Could not update Space availability: ${response.error.message}`,
      );
      return;
    }

    reexecuteSpaces({ requestPolicy: "network-only" });
  }

  return (
    <section className="rounded-md border">
      <div className="border-b px-3 py-2">
        <div className="font-medium">Space Availability</div>
        <div className="text-xs text-muted-foreground">
          Controls where this agent can be mentioned and invoked.
        </div>
      </div>
      <div className="divide-y">
        {rows.length === 0 && !spacesResult.fetching ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            No active Spaces are configured.
          </div>
        ) : (
          rows.map((space) => (
            <div
              key={space.id}
              className="flex items-center justify-between gap-3 px-3 py-3"
            >
              <div className="min-w-0">
                <Link
                  to="/spaces/$spaceId"
                  params={{ spaceId: space.id }}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {space.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {formatLabel(space.kind)}
                  </Badge>
                  {space.status ? (
                    <Badge variant="outline" className="text-[10px]">
                      {formatLabel(space.status)}
                    </Badge>
                  ) : null}
                  <span className="truncate text-xs text-muted-foreground">
                    {space.slug}
                  </span>
                </div>
              </div>
              <Switch
                checked={space.active}
                disabled={pendingSpaceId === space.id}
                onCheckedChange={(checked) => toggleSpace(space.id, checked)}
                aria-label={`Toggle ${space.name} availability`}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
