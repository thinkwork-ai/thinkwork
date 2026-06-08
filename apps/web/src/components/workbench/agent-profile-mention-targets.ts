import type { MentionTarget } from "@/components/spaces/MentionMenu";

export interface AgentProfileMentionSource {
  id: string;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  routingGuidance?: string | null;
  enabled?: boolean | null;
  spaces?: Array<{ id: string } | null> | null;
}

export function mergeAgentProfileMentionTargets(
  baseTargets: readonly MentionTarget[] | null | undefined,
  profiles: readonly AgentProfileMentionSource[] | null | undefined,
  selectedSpaceId?: string | null,
): MentionTarget[] {
  const targetsByKey = new Map<string, MentionTarget>();

  for (const target of baseTargets ?? []) {
    targetsByKey.set(`${target.targetType}:${target.targetId}`, target);
  }

  for (const profile of profiles ?? []) {
    if (profile.enabled === false) continue;
    const displayName = profile.name?.trim();
    if (!profile.id || !displayName) continue;

    const profileSpaces = (profile.spaces ?? []).filter(
      (space): space is { id: string } => Boolean(space?.id),
    );
    if (
      selectedSpaceId &&
      profileSpaces.length > 0 &&
      !profileSpaces.some((space) => space.id === selectedSpaceId)
    ) {
      continue;
    }

    const targetKey = `AGENT_PROFILE:${profile.id}`;
    if (targetsByKey.has(targetKey)) continue;

    const aliases = Array.from(
      new Set(
        [displayName, profile.slug]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    targetsByKey.set(targetKey, {
      id: `agent_profile:${profile.id}`,
      targetType: "AGENT_PROFILE",
      targetId: profile.id,
      displayName,
      aliases,
      isDefaultAgent: false,
      avatarUrl: null,
      role: "Agent Profile",
      email: null,
      description: profile.description ?? profile.routingGuidance ?? null,
    });
  }

  return [...targetsByKey.values()].sort(compareMentionTargets);
}

function compareMentionTargets(a: MentionTarget, b: MentionTarget) {
  return a.displayName.localeCompare(b.displayName);
}
