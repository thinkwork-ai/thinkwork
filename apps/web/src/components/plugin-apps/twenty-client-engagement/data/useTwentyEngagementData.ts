import { useMemo } from "react";
import { useMutation, useQuery } from "urql";

import type {
  PluginAppOverlaysQuery,
  PluginAppOverlaysQueryVariables,
  TwentyEngagementDashboardQuery,
  TwentyEngagementDashboardQueryVariables,
  TwentyEngagementOpportunity,
  TwentyEngagementOpportunityLayer,
  UpsertPluginAppOverlayMutation,
  UpsertPluginAppOverlayMutationVariables,
  UpdateTwentyEngagementOpportunityLayerStatusMutation,
  UpdateTwentyEngagementOpportunityLayerStatusMutationVariables,
  UpdateTwentyEngagementOpportunityStageMutation,
  UpdateTwentyEngagementOpportunityStageMutationVariables,
} from "@/gql/graphql";
import {
  PluginAppOverlaysQuery as PluginAppOverlaysQueryDocument,
  TwentyEngagementDashboardQuery as TwentyEngagementDashboardQueryDocument,
  UpdateTwentyEngagementOpportunityLayerStatusMutation as UpdateLayerStatusDocument,
  UpdateTwentyEngagementOpportunityStageMutation as UpdateStageDocument,
  UpsertPluginAppOverlayMutation as UpsertOverlayDocument,
} from "@/lib/plugin-app-queries";
import { TWENTY_CLIENT_ENGAGEMENT_APP_KEY, TWENTY_PROVIDER } from "./model";

export type EngagementAccount =
  TwentyEngagementDashboardQuery["twentyEngagementDashboard"]["accounts"][number];
export type EngagementOpportunityWithLayers =
  EngagementAccount["opportunities"][number];
export type EngagementOpportunity = TwentyEngagementOpportunity;
export type EngagementLayer = TwentyEngagementOpportunityLayer;

const OPPORTUNITY_OVERLAY_SECTIONS = [
  "strategic-goals",
  "baseline-capture",
  "kpi-framework",
  "use-case-scope",
  "check-ins",
  "executive-view",
];

export function useTwentyEngagementData(selectedOpportunityId: string | null) {
  const [dashboardResult, reexecuteDashboard] = useQuery<
    TwentyEngagementDashboardQuery,
    TwentyEngagementDashboardQueryVariables
  >({
    query: TwentyEngagementDashboardQueryDocument,
    requestPolicy: "cache-and-network",
  });

  const [overlayResult, reexecuteOverlays] = useQuery<
    PluginAppOverlaysQuery,
    PluginAppOverlaysQueryVariables
  >({
    query: PluginAppOverlaysQueryDocument,
    pause: !selectedOpportunityId,
    variables: {
      input: {
        appKey: TWENTY_CLIENT_ENGAGEMENT_APP_KEY,
        provider: TWENTY_PROVIDER,
        providerRecordType: "opportunity",
        providerRecordId: selectedOpportunityId ?? "",
        sectionKeys: OPPORTUNITY_OVERLAY_SECTIONS,
      },
    },
    requestPolicy: "cache-and-network",
  });

  const [, upsertOverlay] = useMutation<
    UpsertPluginAppOverlayMutation,
    UpsertPluginAppOverlayMutationVariables
  >(UpsertOverlayDocument);
  const [, updateStageMutation] = useMutation<
    UpdateTwentyEngagementOpportunityStageMutation,
    UpdateTwentyEngagementOpportunityStageMutationVariables
  >(UpdateStageDocument);
  const [, updateLayerStatusMutation] = useMutation<
    UpdateTwentyEngagementOpportunityLayerStatusMutation,
    UpdateTwentyEngagementOpportunityLayerStatusMutationVariables
  >(UpdateLayerStatusDocument);

  const overlayBySection = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const overlay of overlayResult.data?.pluginAppOverlays ?? []) {
      map.set(overlay.sectionKey, objectPayload(overlay.payload));
    }
    return map;
  }, [overlayResult.data]);

  return {
    accounts: dashboardResult.data?.twentyEngagementDashboard.accounts ?? [],
    dashboardFetching: dashboardResult.fetching,
    dashboardError: dashboardResult.error,
    overlayFetching: overlayResult.fetching,
    overlayError: overlayResult.error,
    overlayBySection,
    refreshDashboard: () =>
      reexecuteDashboard({ requestPolicy: "network-only" }),
    saveOpportunityOverlay: async (
      opportunityId: string,
      sectionKey: string,
      payload: Record<string, unknown>,
    ) => {
      const result = await upsertOverlay({
        input: {
          appKey: TWENTY_CLIENT_ENGAGEMENT_APP_KEY,
          provider: TWENTY_PROVIDER,
          providerRecordType: "opportunity",
          providerRecordId: opportunityId,
          sectionKey,
          payload,
        },
      });
      if (result.error) throw result.error;
      reexecuteOverlays({ requestPolicy: "network-only" });
      return result.data?.upsertPluginAppOverlay;
    },
    updateOpportunityStage: async (opportunityId: string, stage: string) => {
      const result = await updateStageMutation({
        input: { opportunityId, stage },
      });
      if (result.error) throw result.error;
      reexecuteDashboard({ requestPolicy: "network-only" });
      return result.data?.updateTwentyEngagementOpportunityStage;
    },
    updateLayerStatus: async (layerId: string, layerStatus: string) => {
      const result = await updateLayerStatusMutation({
        input: { layerId, layerStatus },
      });
      if (result.error) throw result.error;
      reexecuteDashboard({ requestPolicy: "network-only" });
      return result.data?.updateTwentyEngagementOpportunityLayerStatus;
    },
  };
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
