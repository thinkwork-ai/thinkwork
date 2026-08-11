/**
 * brainExpertQuestions — "The Brain has a question for you" (THINK-787).
 *
 * Pulls the Brain Consult loop's open questions and returns the ones
 * routed to the signed-in caller, matched through the Brain expert
 * registry by email. Unrouted questions (no expert_id) are an operator
 * concern and never surface here. Answers go back through `teachBrain`
 * with `answersQuestionId`.
 *
 * An account with no Brain connection configured — or a caller who is
 * not a registered expert — gets an empty list, not an error: this
 * query backs a passive inbox surface. Brain reachability failures are
 * SERVICE_UNAVAILABLE so the client can distinguish "no questions"
 * from "couldn't ask".
 */

import { GraphQLError } from "graphql";
import { getConfig, getSecret } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import {
  cachedM2mToken,
  m2mCredentialsFromSecret,
} from "../../../lib/twin/m2m-token.js";
import {
  type BrainExpertQuestionRow,
  type BrainExpertRow,
  brainExpertQuestionsUrlFrom,
  brainExpertsUrlFrom,
  getBrainOpsJson,
  matchExpertByEmail,
  questionsForExpert,
} from "../../../lib/brain/expert-questions.js";

const LOG_PREFIX = "[brain-expert-questions]";

export const brainExpertQuestions = async (
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) => {
  const email = (ctx.auth.email ?? "").trim();
  if (!email) return [];

  const opsApiUrl = (getConfig("BRAIN_OPS_API_URL", "") || "").trim();
  const secretRef = (getConfig("BRAIN_OPS_M2M_SECRET_ARN", "") || "").trim();
  if (!opsApiUrl || !secretRef) return [];

  let token: string;
  try {
    const secretValue: unknown = JSON.parse(await getSecret(secretRef));
    const creds = m2mCredentialsFromSecret(
      secretValue as Record<string, unknown>,
    );
    if (!creds) throw new Error("secret is not a client-credentials blob");
    token = await cachedM2mToken(secretRef, creds);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} could not mint Brain ops-api bearer: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }

  const unavailable = () =>
    new GraphQLError("Couldn't reach the Brain — try again.", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });

  const expertsResult = await getBrainOpsJson<{ experts?: BrainExpertRow[] }>({
    url: brainExpertsUrlFrom(opsApiUrl),
    token,
  });
  if (expertsResult.kind === "error") {
    console.error(`${LOG_PREFIX} experts fetch: ${expertsResult.message}`);
    throw unavailable();
  }
  const expert = matchExpertByEmail(expertsResult.body.experts ?? [], email);
  if (!expert) return [];

  const questionsResult = await getBrainOpsJson<{
    expert_questions?: BrainExpertQuestionRow[];
  }>({
    url: brainExpertQuestionsUrlFrom(opsApiUrl),
    token,
  });
  if (questionsResult.kind === "error") {
    console.error(`${LOG_PREFIX} questions fetch: ${questionsResult.message}`);
    throw unavailable();
  }

  return questionsForExpert(
    questionsResult.body.expert_questions ?? [],
    expert.id,
  ).map((q) => ({
    id: q.id,
    question: q.question,
    why: q.context?.why ?? null,
    domain: q.domain ?? null,
    taskId: q.task_id ?? null,
    createdAt: q.created_at ?? null,
  }));
};
