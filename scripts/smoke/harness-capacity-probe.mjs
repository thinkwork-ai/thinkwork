#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import {
  GetServiceQuotaCommand,
  ServiceQuotasClient,
} from "@aws-sdk/client-service-quotas";

import {
  invokeHarness,
  mintHarnessAssertion,
  percentile,
  requiredEnv,
  safeError,
} from "./harness-probe-lib.mjs";

const region = requiredEnv("AWS_REGION");
const targetSessions = Number(process.env.HARNESS_CAPACITY_SESSIONS ?? 100);
const targetNewSessionsPerSecond = Number(
  process.env.HARNESS_CAPACITY_NEW_SESSIONS_PER_SECOND ?? 10,
);
const activeSessionQuotaCode = "L-3E5722B2";
const containerSessionRateQuotaCode = "L-0B3AF7ED";

if (
  !Number.isInteger(targetSessions) ||
  targetSessions < 1 ||
  !Number.isFinite(targetNewSessionsPerSecond) ||
  targetNewSessionsPerSecond <= 0
) {
  throw new Error("Capacity targets must be positive numbers");
}

const quotaClient = new ServiceQuotasClient({ region });
const [activeQuota, rateQuota] = await Promise.all([
  quotaClient.send(
    new GetServiceQuotaCommand({
      ServiceCode: "bedrock-agentcore",
      QuotaCode: activeSessionQuotaCode,
    }),
  ),
  quotaClient.send(
    new GetServiceQuotaCommand({
      ServiceCode: "bedrock-agentcore",
      QuotaCode: containerSessionRateQuotaCode,
    }),
  ),
]);
const activeLimit = activeQuota.Quota?.Value ?? 0;
const newSessionsPerMinuteLimit = rateQuota.Quota?.Value ?? 0;
const requiredNewSessionsPerMinute = targetNewSessionsPerSecond * 60;
const activeHeadroom = 1 - targetSessions / activeLimit;
const rateHeadroom =
  1 - requiredNewSessionsPerMinute / newSessionsPerMinuteLimit;
const quotaGate = activeHeadroom >= 0.5 && rateHeadroom >= 0.5;

if (!quotaGate && process.env.HARNESS_CAPACITY_ALLOW_QUOTA_SHORTFALL !== "1") {
  console.log(
    JSON.stringify({
      result: "BLOCKED_QUOTA",
      targetSessions,
      targetNewSessionsPerSecond,
      quotas: {
        activeLimit,
        activeHeadroom,
        newSessionsPerMinuteLimit,
        requiredNewSessionsPerMinute,
        rateHeadroom,
      },
    }),
  );
  process.exitCode = 2;
} else {
  const token = await mintHarnessAssertion();
  let active = 0;
  let maxConcurrent = 0;
  const startedAt = performance.now();
  const launches = [];
  for (let index = 0; index < targetSessions; index += 1) {
    const scheduledAt =
      startedAt + (index / targetNewSessionsPerSecond) * 1_000;
    const delayMs = scheduledAt - performance.now();
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    launches.push(
      invokeHarness({
        token,
        sessionId: `think316-capacity-${randomUUID()}`,
        messages: [
          {
            role: "user",
            content: [
              {
                text: "Capacity probe: reply with exactly READY. Do not call a tool.",
              },
            ],
          },
        ],
      })
        .then((response) => ({ ok: /READY/i.test(response.text), ...response }))
        .catch((error) => ({ ok: false, error: safeError(error) }))
        .finally(() => {
          active -= 1;
        }),
    );
  }

  const results = await Promise.all(launches);
  const passed = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const throttles = failures.filter((result) =>
    /throttl|429/i.test(result.error ?? ""),
  );
  const latencyValues = passed.map((result) => result.latencyMs);
  const result =
    failures.length === 0 &&
    quotaGate &&
    maxConcurrent >= Math.min(targetSessions, 100)
      ? "PASS"
      : "FAIL";
  console.log(
    JSON.stringify({
      result,
      targetSessions,
      targetNewSessionsPerSecond,
      completed: passed.length,
      failures: failures.length,
      throttles: throttles.length,
      maxConcurrent,
      latencyMs: {
        p50: percentile(latencyValues, 50),
        p95: percentile(latencyValues, 95),
        p99: percentile(latencyValues, 99),
      },
      quotas: {
        activeLimit,
        activeHeadroom,
        newSessionsPerMinuteLimit,
        requiredNewSessionsPerMinute,
        rateHeadroom,
      },
      failureKinds: [...new Set(failures.map((failure) => failure.error))],
    }),
  );
  if (result !== "PASS") process.exitCode = 1;
}
