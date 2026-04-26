import { createHash } from "node:crypto";

import type { GraphQLContext } from "../../context.js";
import { agents, and, asc, db, eq } from "../../utils.js";
import {
  activationAutomationCandidateToGraphql,
  activationAutomationCandidates,
  assertActivationAutomationOwner,
  loadActivationSession,
} from "./shared.js";

const DISCLOSURE_VERSION = "activation-automation-v1";
const DEFAULT_COST_ESTIMATE = {
  runsPerMonth: 4,
  perRunUsd: 0,
  monthlyUsdMin: 0,
  monthlyUsdMax: 0,
  estimateBasis: "static-preview",
};

export const generateActivationAutomationCandidates = async (
  _parent: unknown,
  args: { sessionId: string },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.sessionId);
  await assertActivationAutomationOwner(ctx, session);

  const existing = await db
    .select()
    .from(activationAutomationCandidates)
    .where(
      and(
        eq(activationAutomationCandidates.session_id, session.id),
        eq(activationAutomationCandidates.user_id, session.user_id),
        eq(activationAutomationCandidates.tenant_id, session.tenant_id),
      ),
    )
    .orderBy(asc(activationAutomationCandidates.created_at));
  if (existing.length > 0) {
    return existing.map(activationAutomationCandidateToGraphql);
  }

  const [pairedAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.human_pair_id, session.user_id),
        eq(agents.tenant_id, session.tenant_id),
      ),
    )
    .limit(1);
  if (!pairedAgent) return [];

  const candidates = buildActivationAutomationCandidateRows(session, pairedAgent.id);
  if (candidates.length > 0) {
    await db.insert(activationAutomationCandidates).values(candidates).onConflictDoNothing();
  }

  const rows = await db
    .select()
    .from(activationAutomationCandidates)
    .where(
      and(
        eq(activationAutomationCandidates.session_id, session.id),
        eq(activationAutomationCandidates.user_id, session.user_id),
        eq(activationAutomationCandidates.tenant_id, session.tenant_id),
      ),
    )
    .orderBy(asc(activationAutomationCandidates.created_at));

  return rows.map(activationAutomationCandidateToGraphql);
};

export function buildActivationAutomationCandidateRows(
  session: {
    id: string;
    tenant_id: string;
    user_id: string;
    layer_states: unknown;
  },
  targetAgentId: string,
) {
  const states =
    typeof session.layer_states === "object" && session.layer_states !== null
      ? (session.layer_states as Record<string, any>)
      : {};
  const rows = [];

  for (const layer of ["rhythms", "decisions"] as const) {
    const entries = Array.isArray(states[layer]?.entries)
      ? states[layer].entries
      : [];
    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      if (!entry) continue;
      if (!isConfirmedActivationEntry(entry)) continue;
      const schedule = inferSchedule(entry);
      if (!schedule) continue;
      const title = String(entry.title ?? "Activation follow-up").slice(0, 160);
      const summary = String(entry.summary ?? entry.content ?? title).slice(0, 1000);
      const prompt = `Use my activation context to help with: ${summary}`.slice(
        0,
        2000,
      );
      const duplicateKey = hashDuplicateKey({
        userId: session.user_id,
        layer,
        title,
        scheduleExpression: schedule.expression,
        prompt,
      });
      rows.push({
        session_id: session.id,
        tenant_id: session.tenant_id,
        user_id: session.user_id,
        source_layer: layer,
        title,
        summary,
        why_suggested: `Suggested from your confirmed ${layer} activation entry.`,
        target_type: "agent",
        target_agent_id: targetAgentId,
        trigger_type: "agent_scheduled",
        schedule_type: "cron",
        schedule_expression: schedule.expression,
        timezone: schedule.timezone,
        prompt,
        config: { activationSessionId: session.id, sourceLayer: layer },
        status: "generated",
        cost_estimate: DEFAULT_COST_ESTIMATE,
        disclosure_version: DISCLOSURE_VERSION,
        duplicate_key: duplicateKey,
      });
      if (rows.length >= 3) return rows;
    }
  }

  return rows;
}

export function inferActivationAutomationSchedule(entry: unknown) {
  const row = asRecord(entry);
  if (!row) return null;
  if (
    typeof row.scheduleExpression === "string" &&
    isSupportedScheduleExpression(row.scheduleExpression)
  ) {
    return {
      expression: row.scheduleExpression.trim(),
      timezone: typeof row.timezone === "string" ? row.timezone : "UTC",
    };
  }
  const metadata =
    typeof row.metadata === "object" && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {};
  const cadence = String(row.cadence ?? metadata.cadence ?? "").toLowerCase();
  if (cadence.includes("daily")) {
    return { expression: "cron(0 9 * * ? *)", timezone: "UTC" };
  }
  if (cadence.includes("weekly") || cadence.includes("monday")) {
    return { expression: "cron(0 9 ? * MON *)", timezone: "UTC" };
  }
  return null;
}

function inferSchedule(entry: Record<string, unknown>) {
  return inferActivationAutomationSchedule(entry);
}

function hashDuplicateKey(input: Record<string, string>) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function isSupportedScheduleExpression(value: string) {
  const expression = value.trim().toLowerCase();
  return expression.startsWith("cron(") || expression.startsWith("rate(");
}

function isConfirmedActivationEntry(entry: Record<string, unknown>) {
  if (entry.epistemicState == null) return true;
  return String(entry.epistemicState).toLowerCase() === "confirmed";
}
