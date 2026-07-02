/**
 * Tier-`model` execution (Eval Execution Tiers v1): one stateless
 * Bedrock Converse call — the profile's model + the run's pinned
 * composed system prompt + the case query. No workspace bootstrap, no
 * tools, no MCP, no memory: this is how every generic eval framework
 * runs a case, reserved here for cases whose behavior doesn't depend on
 * the agent harness. ~1–2s and ~1/4 the cost of a full Pi turn.
 *
 * The response envelope mirrors invokeAgentCoreForEval's relevant subset
 * ({ output, durationMs, usage }) so the worker's scoring and telemetry
 * paths are tier-agnostic.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { evalMaxTokens, type EvalAgentUsage } from "./agentcore-direct.js";

const client = new BedrockRuntimeClient({});

/**
 * Model ids that only exist as cross-region inference profiles reject
 * on-demand invocation under their bare id. Retrying once with the `us.`
 * prefix mirrors what the Pi runtime does internally, without hardcoding
 * a catalog of which vendors need it.
 */
export function shouldRetryWithUsPrefix(
  modelId: string,
  error: unknown,
): boolean {
  if (modelId.startsWith("us.")) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /on-demand throughput|inference profile|ValidationException/i.test(
    message,
  );
}

export async function invokeModelForEval(input: {
  modelId: string;
  systemPrompt: string | null;
  query: string;
}): Promise<{
  output: string;
  durationMs: number;
  usage?: EvalAgentUsage;
  /** The model id the call actually succeeded under (us.-prefix retry). */
  resolvedModelId: string;
}> {
  const startedAt = Date.now();
  const converse = async (modelId: string) =>
    client.send(
      new ConverseCommand({
        modelId,
        ...(input.systemPrompt
          ? { system: [{ text: input.systemPrompt }] }
          : {}),
        messages: [{ role: "user", content: [{ text: input.query }] }],
        inferenceConfig: { maxTokens: evalMaxTokens(), temperature: 0 },
      }),
    );

  let resolvedModelId = input.modelId;
  let response;
  try {
    response = await converse(resolvedModelId);
  } catch (err) {
    if (!shouldRetryWithUsPrefix(resolvedModelId, err)) throw err;
    resolvedModelId = `us.${resolvedModelId}`;
    response = await converse(resolvedModelId);
  }

  const output = (response.output?.message?.content ?? [])
    .map((block) => ("text" in block && block.text ? block.text : ""))
    .join("");
  const inputTokens = response.usage?.inputTokens;
  const outputTokens = response.usage?.outputTokens;
  const usage =
    typeof inputTokens === "number" && typeof outputTokens === "number"
      ? { inputTokens, outputTokens }
      : undefined;

  return {
    output,
    durationMs: Date.now() - startedAt,
    ...(usage ? { usage } : {}),
    resolvedModelId,
  };
}
