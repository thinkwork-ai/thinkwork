import {
  runConnectorDispatchTick,
  type ConnectorDispatchResult,
  type ConnectorRuntimeTickOptions,
} from "../lib/connectors/runtime.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface ConnectorPollerEvent {
  tenantId?: unknown;
  connectorId?: unknown;
  limit?: unknown;
  force?: unknown;
  now?: unknown;
}

export interface ConnectorPollerResult {
  ok: true;
  startedAt: string;
  durationMs: number;
  options: {
    tenantId?: string;
    connectorId?: string;
    limit: number;
    force: boolean;
    now: string;
  };
  resultCount: number;
  counts: Record<ConnectorDispatchResult["status"], number>;
  results: ConnectorDispatchResult[];
}

export async function handler(
  event: ConnectorPollerEvent = {},
): Promise<ConnectorPollerResult> {
  const startedAt = new Date();

  try {
    const options = buildTickOptions(event);
    const results = await runConnectorDispatchTick(options);
    const durationMs = Date.now() - startedAt.getTime();
    const response: ConnectorPollerResult = {
      ok: true,
      startedAt: startedAt.toISOString(),
      durationMs,
      options: {
        tenantId: options.tenantId,
        connectorId: options.connectorId,
        limit: options.limit ?? DEFAULT_LIMIT,
        force: options.force ?? false,
        now: (options.now ?? startedAt).toISOString(),
      },
      resultCount: results.length,
      counts: summarizeResults(results),
      results,
    };

    console.log(
      `[connector-poller] completed result_count=${response.resultCount} duration_ms=${durationMs} counts=${JSON.stringify(
        response.counts,
      )}`,
    );

    return response;
  } catch (error) {
    const durationMs = Date.now() - startedAt.getTime();
    console.error(
      `[connector-poller] failed duration_ms=${durationMs} error=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

export function buildTickOptions(
  event: ConnectorPollerEvent = {},
): ConnectorRuntimeTickOptions {
  return {
    tenantId: readString(event.tenantId),
    connectorId: readString(event.connectorId),
    limit: readLimit(event.limit, process.env.CONNECTOR_POLLER_LIMIT),
    force: event.force === true,
    now: readNow(event.now),
  };
}

export function summarizeResults(
  results: ConnectorDispatchResult[],
): Record<ConnectorDispatchResult["status"], number> {
  const counts: Record<ConnectorDispatchResult["status"], number> = {
    dispatched: 0,
    duplicate: 0,
    unsupported_target: 0,
    skipped: 0,
    failed: 0,
  };

  for (const result of results) counts[result.status] += 1;
  return counts;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readLimit(eventValue: unknown, envValue: unknown): number {
  const value =
    parsePositiveInteger(eventValue) ?? parsePositiveInteger(envValue);
  if (!value) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0)
    return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : undefined;
}

function readNow(value: unknown): Date | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid connector poller now value");
  }
  return parsed;
}
