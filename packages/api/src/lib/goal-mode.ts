import { GraphQLError } from "graphql";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { tenantSettings } from "@thinkwork/database-pg/schema";
import {
  DEFAULT_GOAL_TOKEN_BUDGET,
  MAX_GOAL_TOKEN_BUDGET,
  normalizeGoalDefaultTokenBudgetInput,
} from "./goal-budget.js";

export const GOAL_MODE_METADATA_KEY = "goalMode";
export const MAX_GOAL_OBJECTIVE_LENGTH = 20_000;
export const MAX_GOAL_RUN_ID_LENGTH = 128;

export const GOAL_MODE_ACTIONS = [
  "start",
  "resume",
  "pause",
  "cancel",
  "clear",
] as const;

export type GoalModeAction = (typeof GOAL_MODE_ACTIONS)[number];

export interface ComposerGoalModeIntent {
  enabled: true;
  action: GoalModeAction;
  objective?: string;
  goalRunId?: string;
}

export interface RuntimeGoalMode extends ComposerGoalModeIntent {
  resolvedBudget: {
    tokenBudget: number;
  };
}

type GoalBudgetRow = {
  goal_default_token_budget: number | null;
};

const FORBIDDEN_COMPOSER_BUDGET_KEYS = new Set([
  "budget",
  "resolvedBudget",
  "tokenBudget",
  "tokens",
  "maxTokens",
  "costBudget",
  "costBudgetCents",
]);

export function normalizeComposerGoalModeIntent(
  value: unknown,
  content: string | null | undefined,
): ComposerGoalModeIntent | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw badGoalModeInput("Goal mode metadata must be an object.");
  }
  if (value.enabled === false) return null;

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_COMPOSER_BUDGET_KEYS.has(key)) {
      throw badGoalModeInput(
        "Goal mode budget is resolved from tenant Agent settings, not composer metadata.",
      );
    }
  }

  const action = normalizeGoalModeAction(value.action);
  if (value.enabled !== true && !value.action) {
    throw badGoalModeInput("Goal mode metadata must be enabled.");
  }

  const goalRunId = normalizeGoalRunId(value.goalRunId);
  const objective = normalizeGoalObjective(value.objective, content, action);
  const intent: ComposerGoalModeIntent = {
    enabled: true,
    action,
  };
  if (objective) intent.objective = objective;
  if (goalRunId) intent.goalRunId = goalRunId;
  return intent;
}

export function normalizeMessageGoalModeMetadata(
  metadata: Record<string, unknown> | undefined,
  content: string | null | undefined,
): {
  metadata: Record<string, unknown> | undefined;
  goalMode: ComposerGoalModeIntent | null;
} {
  if (!metadata || !(GOAL_MODE_METADATA_KEY in metadata)) {
    return { metadata, goalMode: null };
  }
  const goalMode = normalizeComposerGoalModeIntent(
    metadata[GOAL_MODE_METADATA_KEY],
    content,
  );
  const nextMetadata = { ...metadata };
  if (goalMode) {
    nextMetadata[GOAL_MODE_METADATA_KEY] = goalMode;
  } else {
    delete nextMetadata[GOAL_MODE_METADATA_KEY];
  }
  return {
    metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
    goalMode,
  };
}

export async function resolveTenantGoalTokenBudget(
  db: Pick<NodePgDatabase<Record<string, never>>, "select">,
  tenantId: string,
): Promise<number> {
  const [settings] = (await db
    .select({
      goal_default_token_budget: tenantSettings.goal_default_token_budget,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenant_id, tenantId))
    .limit(1)) as GoalBudgetRow[];
  const normalized = normalizeGoalDefaultTokenBudgetInput(
    settings?.goal_default_token_budget ?? null,
  );
  return normalized ?? DEFAULT_GOAL_TOKEN_BUDGET;
}

export function toRuntimeGoalMode(
  goalMode: ComposerGoalModeIntent,
  tokenBudget: number,
): RuntimeGoalMode {
  const normalizedBudget = normalizeGoalDefaultTokenBudgetInput(tokenBudget);
  if (normalizedBudget === null) {
    throw badGoalModeInput("Goal token budget could not be resolved.");
  }
  return {
    ...goalMode,
    resolvedBudget: {
      tokenBudget: normalizedBudget,
    },
  };
}

export function toRuntimeGoalModePayload(goalMode: RuntimeGoalMode) {
  return {
    enabled: goalMode.enabled,
    action: goalMode.action,
    objective: goalMode.objective,
    goal_run_id: goalMode.goalRunId,
    resolved_budget: {
      token_budget: goalMode.resolvedBudget.tokenBudget,
    },
  };
}

function normalizeGoalModeAction(value: unknown): GoalModeAction {
  if (value === undefined || value === null || value === "") return "start";
  if (
    typeof value === "string" &&
    (GOAL_MODE_ACTIONS as readonly string[]).includes(value)
  ) {
    return value as GoalModeAction;
  }
  throw badGoalModeInput("Goal mode action is not supported.");
}

function normalizeGoalObjective(
  explicitObjective: unknown,
  content: string | null | undefined,
  action: GoalModeAction,
): string | undefined {
  const source =
    explicitObjective ?? (action === "start" ? content : undefined);
  if (source === undefined || source === null) {
    if (action === "start") {
      throw badGoalModeInput("Goal mode requires a text objective.");
    }
    return undefined;
  }
  if (typeof source !== "string") {
    throw badGoalModeInput("Goal mode objective must be text.");
  }
  const objective = source.trim();
  if (!objective) {
    if (action === "start") {
      throw badGoalModeInput("Goal mode requires a text objective.");
    }
    return undefined;
  }
  if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
    throw badGoalModeInput(
      `Goal mode objective must be ${MAX_GOAL_OBJECTIVE_LENGTH} characters or fewer.`,
    );
  }
  return objective;
}

function normalizeGoalRunId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw badGoalModeInput("Goal run id must be text.");
  }
  const goalRunId = value.trim();
  if (!goalRunId) return undefined;
  if (goalRunId.length > MAX_GOAL_RUN_ID_LENGTH) {
    throw badGoalModeInput(
      `Goal run id must be ${MAX_GOAL_RUN_ID_LENGTH} characters or fewer.`,
    );
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(goalRunId)) {
    throw badGoalModeInput("Goal run id contains unsupported characters.");
  }
  return goalRunId;
}

function badGoalModeInput(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function goalTokenBudgetPolicySummary(): {
  defaultTokenBudget: number;
  maxTokenBudget: number;
} {
  return {
    defaultTokenBudget: DEFAULT_GOAL_TOKEN_BUDGET,
    maxTokenBudget: MAX_GOAL_TOKEN_BUDGET,
  };
}
