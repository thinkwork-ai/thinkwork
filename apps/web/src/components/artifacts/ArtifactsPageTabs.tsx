/**
 * Artifacts page tab row (THINK-153 U6): Artifacts | Plates.
 *
 * The Artifacts page's first tab row, following the Work Items list idiom
 * (line-variant tabs with a primary count per tab). The Artifacts tab is
 * unchanged (ArtifactsListBody); the Plates tab hosts the plate registry.
 *
 * Counts come from the same queries the bodies run (urql dedupes identical
 * document + variables), so the tab row adds no extra network round trips
 * beyond what the active body already issues.
 */

import { useState } from "react";
import { useQuery } from "urql";
import { Tabs, TabsList, TabsTrigger } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  AppletsQuery,
  DocumentPlatesListQuery,
  TenantArtifactsListQuery,
} from "@/lib/graphql-queries";
import { ArtifactsListBody } from "./ArtifactsListBody";
import { PlatesListBody } from "./plates/PlatesListBody";

type ArtifactsTab = "artifacts" | "plates";

export function ArtifactsPageTabs() {
  const { tenantId } = useTenant();
  const [tab, setTab] = useState<ArtifactsTab>("artifacts");

  const [appletsResult] = useQuery<{
    applets?: { nodes?: unknown[] | null } | null;
  }>({
    query: AppletsQuery,
    requestPolicy: "cache-and-network",
  });
  const [artifactsResult] = useQuery<{ artifacts?: unknown[] | null }>({
    query: TenantArtifactsListQuery,
    variables: { tenantId: tenantId ?? "", includeDrafts: false },
    requestPolicy: "cache-and-network",
    pause: !tenantId,
  });
  const [platesResult] = useQuery<{ documentPlates?: unknown[] | null }>({
    query: DocumentPlatesListQuery,
    variables: { tenantId },
    requestPolicy: "cache-and-network",
    pause: !tenantId,
  });

  const artifactCount =
    (appletsResult.data?.applets?.nodes?.length ?? 0) +
    (artifactsResult.data?.artifacts?.length ?? 0);
  const plateCount = platesResult.data?.documentPlates?.length ?? 0;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 px-6 pt-4">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ArtifactsTab)}
        >
          <TabsList variant="line" data-testid="artifacts-page-tabs">
            <TabsTrigger value="artifacts" data-testid="artifacts-tab">
              Artifacts
              <TabCount count={artifactCount} />
            </TabsTrigger>
            <TabsTrigger value="plates" data-testid="plates-tab">
              Plates
              <TabCount count={plateCount} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "artifacts" ? <ArtifactsListBody /> : <PlatesListBody />}
      </div>
    </div>
  );
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
      {count}
    </span>
  );
}
