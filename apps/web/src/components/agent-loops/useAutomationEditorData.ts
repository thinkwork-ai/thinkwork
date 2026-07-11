import { useMemo } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { SpacesQuery, SettingsGitRoutinesQuery } from "@/lib/graphql-queries";
import {
  SettingsAgentProfilesQuery,
  SettingsTenantAgentQuery,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import {
  buildMemberOptions,
  buildRoutineOptions,
  buildWorkerOptions,
  buildWorkflowOptions,
  type RoutineRow,
  type TenantMemberRow,
} from "./agent-loop-options";
import type { AgentLoopSpaceOption } from "./agent-loop-types";
import { defaultSpaceIdFromAgentRuntimeConfig } from "./agent-loop-utils";

type AgentProfilesData = {
  agentProfiles?: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
};
type SpacesData = { spaces?: AgentLoopSpaceOption[] };
type TenantAgentData = {
  agent?: { id: string; name?: string | null; runtimeConfig?: unknown } | null;
};
type RoutinesData = { routines?: RoutineRow[] };
type MembersData = { tenantMembers?: TenantMemberRow[] };

export function useAutomationEditorData() {
  const { tenantId, userId } = useTenant();
  const [agentResult] = useQuery<TenantAgentData>({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [profilesResult] = useQuery<AgentProfilesData>({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [spacesResult] = useQuery<SpacesData>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [routinesResult] = useQuery<RoutinesData>({
    query: SettingsGitRoutinesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [membersResult] = useQuery<MembersData>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const workerOptions = useMemo(
    () =>
      buildWorkerOptions({
        agent: agentResult.data?.agent ?? null,
        profiles: profilesResult.data?.agentProfiles ?? [],
      }),
    [agentResult.data?.agent, profilesResult.data?.agentProfiles],
  );
  const spaceOptions = useMemo(
    () => spacesResult.data?.spaces ?? [],
    [spacesResult.data?.spaces],
  );
  const routineOptions = useMemo(
    () => buildRoutineOptions(routinesResult.data?.routines ?? []),
    [routinesResult.data?.routines],
  );
  const workflowOptions = useMemo(
    () => buildWorkflowOptions(routinesResult.data?.routines ?? []),
    [routinesResult.data?.routines],
  );
  const memberOptions = useMemo(
    () =>
      buildMemberOptions(
        membersResult.data?.tenantMembers ?? [],
        userId ? { id: userId, label: "You" } : null,
      ),
    [membersResult.data?.tenantMembers, userId],
  );
  const defaultSpaceId = useMemo(
    () =>
      defaultSpaceIdFromAgentRuntimeConfig(
        agentResult.data?.agent?.runtimeConfig,
      ),
    [agentResult.data?.agent?.runtimeConfig],
  );

  return {
    tenantId,
    userId,
    workerOptions,
    spaceOptions,
    routineOptions,
    workflowOptions,
    memberOptions,
    defaultSpaceId,
  };
}
