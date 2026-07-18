#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import {
  invokeHarness,
  mintHarnessAssertion,
  percentile,
  requiredEnv,
} from "./harness-probe-lib.mjs";

const iterations = Number(process.env.HARNESS_STRATEGY_ITERATIONS ?? 5);
const owner = process.env.HARNESS_PROBE_OWNER ?? "alice";
const expectedValue =
  process.env.HARNESS_PROBE_EXPECTED_VALUE ?? "fixture-alice";
requiredEnv("HARNESS_ARN");
requiredEnv("HARNESS_QUALIFIER");

if (!Number.isInteger(iterations) || iterations < 3) {
  throw new Error("HARNESS_STRATEGY_ITERATIONS must be an integer >= 3");
}

const firstPrompt = `Call owner_probe with requested_owner exactly '${owner}'. After the governed result, reply with FIRST:<harmlessValue>. Never guess.`;
const secondPrompt = `Call owner_probe again with requested_owner exactly '${owner}'. Reply with SECOND:<harmlessValue>. Never guess.`;

async function invoke(token, sessionId, messages) {
  return invokeHarness({ token, sessionId, messages });
}

async function runReuse(token) {
  const sessionId = `think316-reuse-${randomUUID()}`;
  const first = await invoke(token, sessionId, [
    { role: "user", content: [{ text: firstPrompt }] },
  ]);
  const second = await invoke(token, sessionId, [
    { role: "user", content: [{ text: secondPrompt }] },
  ]);
  return { first, second };
}

async function runFresh(token) {
  const first = await invoke(token, `think316-fresh-${randomUUID()}`, [
    { role: "user", content: [{ text: firstPrompt }] },
  ]);
  const second = await invoke(token, `think316-fresh-${randomUUID()}`, [
    { role: "user", content: [{ text: firstPrompt }] },
    { role: "assistant", content: [{ text: first.text }] },
    { role: "user", content: [{ text: secondPrompt }] },
  ]);
  return { first, second };
}

const reuseRuns = [];
const freshRuns = [];
for (let index = 0; index < iterations; index += 1) {
  const token = await mintHarnessAssertion({
    participantId: owner,
    threadId: `harness-strategy-${index}`,
  });
  reuseRuns.push(await runReuse(token));
  freshRuns.push(await runFresh(token));
}

const correct = (run) =>
  run.first.text.includes(expectedValue) &&
  run.second.text.includes(expectedValue) &&
  !/DENIED/i.test(`${run.first.text} ${run.second.text}`);
const reuseCorrect = reuseRuns.every(correct);
const freshCorrect = freshRuns.every(correct);
const latency = (runs) => runs.map((run) => run.second.latencyMs);
const inputTokens = (runs) =>
  runs.map((run) => run.second.usage.inputTokens).filter((value) => value > 0);
const reuseP95Latency = percentile(latency(reuseRuns), 95);
const freshP95Latency = percentile(latency(freshRuns), 95);
const reuseP95Tokens = percentile(inputTokens(reuseRuns), 95);
const freshP95Tokens = percentile(inputTokens(freshRuns), 95);
const latencyBenefit =
  freshP95Latency > 0 ? 1 - reuseP95Latency / freshP95Latency : 0;
const tokenBenefit =
  freshP95Tokens > 0 && reuseP95Tokens > 0
    ? 1 - reuseP95Tokens / freshP95Tokens
    : 0;
const correctnessIdentical = reuseCorrect && freshCorrect;
const selectedStrategy =
  correctnessIdentical && (latencyBenefit >= 0.2 || tokenBenefit >= 0.2)
    ? "reuse"
    : "fresh";
const result = correctnessIdentical ? "PASS" : "FAIL";

console.log(
  JSON.stringify({
    result,
    selectedStrategy,
    iterations,
    correctness: { reuse: reuseCorrect, fresh: freshCorrect },
    p95: {
      reuseLatencyMs: reuseP95Latency,
      freshLatencyMs: freshP95Latency,
      latencyBenefit,
      reuseInputTokens: reuseP95Tokens || null,
      freshInputTokens: freshP95Tokens || null,
      tokenBenefit: freshP95Tokens ? tokenBenefit : null,
    },
  }),
);
if (result !== "PASS") process.exitCode = 1;
