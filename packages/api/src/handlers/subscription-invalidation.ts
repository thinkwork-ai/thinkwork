import type { ScheduledEvent } from "aws-lambda";

import { processSubscriptionInvalidations } from "../lib/subscription-invalidation.js";

type Processor = typeof processSubscriptionInvalidations;

export async function runSubscriptionInvalidationWorker(
  event: Partial<ScheduledEvent<Record<string, unknown>>> & { limit?: unknown },
  process: Processor = processSubscriptionInvalidations,
): Promise<{ processed: number; retried: number }> {
  const requestedLimit = Number(event.limit ?? 25);
  const limit =
    Number.isInteger(requestedLimit) &&
    requestedLimit >= 1 &&
    requestedLimit <= 100
      ? requestedLimit
      : 25;
  const result = await process({ limit });
  console.info("[subscription-invalidation] drain complete", result);
  return result;
}

export const handler = async (
  event: Partial<ScheduledEvent<Record<string, unknown>>> & { limit?: unknown },
) => runSubscriptionInvalidationWorker(event);
