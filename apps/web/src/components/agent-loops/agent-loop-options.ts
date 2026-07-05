import type {
  AgentLoopMemberOption,
  AgentLoopRoutineOption,
  AgentLoopWorkerOption,
} from "./agent-loop-types";

export interface RoutineRow {
  id: string;
  name: string;
  description?: string | null;
  engine: string;
  status: string;
  validatedSha?: string | null;
  fixturePaths?: string | null;
  disabledReason?: string | null;
}

function routineIneligibleReason(routine: RoutineRow): string | null {
  if (routine.status !== "active") {
    return routine.disabledReason
      ? `disabled: ${routine.disabledReason}`
      : `${routine.status}`;
  }
  return null;
}

function gitRoutineIneligibleReason(routine: RoutineRow): string | null {
  const statusReason = routineIneligibleReason(routine);
  if (statusReason) return statusReason;
  const hasFixtures = (() => {
    try {
      const parsed = routine.fixturePaths
        ? JSON.parse(routine.fixturePaths)
        : null;
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();
  if (!routine.validatedSha && !hasFixtures) {
    return "no validated version yet";
  }
  return null;
}

/** git_python routines → routine target options. */
export function buildRoutineOptions(
  routines: RoutineRow[],
): AgentLoopRoutineOption[] {
  return routines
    .filter((routine) => routine.engine === "git_python")
    .map((routine) => ({
      id: routine.id,
      name: routine.name,
      description: routine.description ?? null,
      disabledReason: gitRoutineIneligibleReason(routine),
    }));
}

/** step_functions routines → workflow target options. */
export function buildWorkflowOptions(
  routines: RoutineRow[],
): AgentLoopRoutineOption[] {
  return routines
    .filter((routine) => routine.engine === "step_functions")
    .map((routine) => ({
      id: routine.id,
      name: routine.name,
      description: routine.description ?? null,
      disabledReason: routineIneligibleReason(routine),
    }));
}

export interface TenantMemberRow {
  principalType?: string | null;
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } | null;
}

/** Tenant members → run-as user options. Guarantees the current user is
 * present so "run as self" always resolves. */
export function buildMemberOptions(
  members: TenantMemberRow[],
  current?: { id: string; label: string } | null,
): AgentLoopMemberOption[] {
  const options: AgentLoopMemberOption[] = [];
  const seen = new Set<string>();
  if (current?.id) {
    options.push({ id: current.id, label: current.label });
    seen.add(current.id);
  }
  for (const member of members) {
    const user = member.user;
    if (!user?.id || seen.has(user.id)) continue;
    if (member.principalType && member.principalType !== "user") continue;
    options.push({ id: user.id, label: user.name || user.email || user.id });
    seen.add(user.id);
  }
  return options;
}

export function buildWorkerOptions(input: {
  agent?: { id: string; name?: string | null } | null;
  profiles: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
}): AgentLoopWorkerOption[] {
  const options: AgentLoopWorkerOption[] = [];
  if (input.agent?.id) {
    options.push({
      id: input.agent.id,
      type: "agent",
      label: input.agent.name ?? "Default Agent",
      description: "Tenant default Agent",
    });
  }
  for (const profile of input.profiles) {
    if (!profile.enabled) continue;
    options.push({
      id: profile.id,
      type: "agent_profile",
      label: profile.name,
      description: profile.description,
    });
  }
  return options;
}
