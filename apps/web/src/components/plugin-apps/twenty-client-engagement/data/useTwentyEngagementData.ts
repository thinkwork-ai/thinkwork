import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";

import type {
  PluginAppOverlaysQuery,
  PluginAppOverlaysQueryVariables,
  UpsertPluginAppOverlayMutation,
  UpsertPluginAppOverlayMutationVariables,
} from "@/gql/graphql";
import {
  PluginAppOverlaysQuery as PluginAppOverlaysQueryDocument,
  UpsertPluginAppOverlayMutation as UpsertOverlayDocument,
} from "@/lib/plugin-app-queries";
import {
  fetchTwentyEngagementDashboard,
  saveTwentyStakeholder,
  updateTwentyLayerStatus,
  updateTwentyOpportunityStage,
  type EngagementAccount,
  type EngagementLayer,
  type EngagementOpportunity,
  type EngagementStakeholder,
  type SaveStakeholderInput,
} from "./twentyEngagementApi";
import { TWENTY_CLIENT_ENGAGEMENT_APP_KEY, TWENTY_PROVIDER } from "./model";

export type {
  EngagementAccount,
  EngagementCompany,
  EngagementLayer,
  EngagementOpportunity,
  EngagementOpportunityWithLayers,
  EngagementStakeholder,
} from "./twentyEngagementApi";

const OPPORTUNITY_OVERLAY_SECTIONS = [
  "strategic-goals",
  "baseline-capture",
  "kpi-framework",
  "use-case-scope",
  "check-ins",
  "executive-view",
];
const APP_OVERLAY_RECORD_ID = TWENTY_CLIENT_ENGAGEMENT_APP_KEY;
const APP_OVERLAY_SECTIONS = ["use-case-pipeline", "strategic-pipeline"];
const COMPANY_OVERLAY_SECTIONS = ["account-profile"];

export function useTwentyEngagementData(
  selectedOpportunityId: string | null,
  selectedAccountId: string | null,
) {
  const [accounts, setAccounts] = useState<EngagementAccount[]>([]);
  const [dashboardFetching, setDashboardFetching] = useState(false);
  const [dashboardError, setDashboardError] = useState<Error | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashboardFetching(true);
    setDashboardError(null);
    try {
      const dashboard = await fetchTwentyEngagementDashboard();
      setAccounts(dashboard.accounts);
    } catch (error) {
      setDashboardError(
        error instanceof Error
          ? error
          : new Error("Could not load Twenty engagement data"),
      );
    } finally {
      setDashboardFetching(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

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
  const [appOverlayResult, reexecuteAppOverlays] = useQuery<
    PluginAppOverlaysQuery,
    PluginAppOverlaysQueryVariables
  >({
    query: PluginAppOverlaysQueryDocument,
    variables: {
      input: {
        appKey: TWENTY_CLIENT_ENGAGEMENT_APP_KEY,
        provider: TWENTY_PROVIDER,
        providerRecordType: "app",
        providerRecordId: APP_OVERLAY_RECORD_ID,
        sectionKeys: APP_OVERLAY_SECTIONS,
      },
    },
    requestPolicy: "cache-and-network",
  });
  const [companyOverlayResult, reexecuteCompanyOverlays] = useQuery<
    PluginAppOverlaysQuery,
    PluginAppOverlaysQueryVariables
  >({
    query: PluginAppOverlaysQueryDocument,
    pause: !selectedAccountId,
    variables: {
      input: {
        appKey: TWENTY_CLIENT_ENGAGEMENT_APP_KEY,
        provider: TWENTY_PROVIDER,
        providerRecordType: "company",
        providerRecordId: selectedAccountId ?? "",
        sectionKeys: COMPANY_OVERLAY_SECTIONS,
      },
    },
    requestPolicy: "cache-and-network",
  });

  const [, upsertOverlay] = useMutation<
    UpsertPluginAppOverlayMutation,
    UpsertPluginAppOverlayMutationVariables
  >(UpsertOverlayDocument);

  const overlayBySection = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const overlay of overlayResult.data?.pluginAppOverlays ?? []) {
      map.set(overlay.sectionKey, objectPayload(overlay.payload));
    }
    return map;
  }, [overlayResult.data]);
  const appOverlayBySection = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const overlay of appOverlayResult.data?.pluginAppOverlays ?? []) {
      map.set(overlay.sectionKey, objectPayload(overlay.payload));
    }
    return map;
  }, [appOverlayResult.data]);
  const companyOverlayBySection = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const overlay of companyOverlayResult.data?.pluginAppOverlays ?? []) {
      map.set(overlay.sectionKey, objectPayload(overlay.payload));
    }
    return map;
  }, [companyOverlayResult.data]);

  return {
    accounts,
    dashboardFetching,
    dashboardError,
    overlayFetching: overlayResult.fetching,
    overlayError: overlayResult.error,
    overlayBySection,
    appOverlayFetching: appOverlayResult.fetching,
    appOverlayError: appOverlayResult.error,
    appOverlayBySection,
    companyOverlayFetching: companyOverlayResult.fetching,
    companyOverlayError: companyOverlayResult.error,
    companyOverlayBySection,
    refreshDashboard: loadDashboard,
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
    saveAppOverlay: async (
      sectionKey: string,
      payload: Record<string, unknown>,
    ) => {
      const result = await upsertOverlay({
        input: {
          appKey: TWENTY_CLIENT_ENGAGEMENT_APP_KEY,
          provider: TWENTY_PROVIDER,
          providerRecordType: "app",
          providerRecordId: APP_OVERLAY_RECORD_ID,
          sectionKey,
          payload,
        },
      });
      if (result.error) throw result.error;
      reexecuteAppOverlays({ requestPolicy: "network-only" });
      return result.data?.upsertPluginAppOverlay;
    },
    saveCompanyOverlay: async (
      companyId: string,
      sectionKey: string,
      payload: Record<string, unknown>,
    ) => {
      const result = await upsertOverlay({
        input: {
          appKey: TWENTY_CLIENT_ENGAGEMENT_APP_KEY,
          provider: TWENTY_PROVIDER,
          providerRecordType: "company",
          providerRecordId: companyId,
          sectionKey,
          payload,
        },
      });
      if (result.error) throw result.error;
      reexecuteCompanyOverlays({ requestPolicy: "network-only" });
      return result.data?.upsertPluginAppOverlay;
    },
    saveStakeholder: async (
      input: SaveStakeholderInput,
    ): Promise<EngagementStakeholder> => {
      const stakeholder = await saveTwentyStakeholder(input);
      await loadDashboard();
      return stakeholder;
    },
    updateOpportunityStage: async (
      opportunityId: string,
      stage: string,
    ): Promise<EngagementOpportunity> => {
      const opportunity = await updateTwentyOpportunityStage(
        opportunityId,
        stage,
      );
      await loadDashboard();
      return opportunity;
    },
    updateLayerStatus: async (
      layerId: string,
      layerStatus: string,
    ): Promise<EngagementLayer> => {
      const layer = await updateTwentyLayerStatus(layerId, layerStatus);
      await loadDashboard();
      return layer;
    },
  };
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
