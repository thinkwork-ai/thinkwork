import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_SPANS_LOG_GROUP = process.env.SPANS_LOG_GROUP || "aws/spans";
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 200;

export interface CloudWatchLogsClientLike {
  send(command: FilterLogEventsCommand): Promise<CloudWatchLogEventsOutput>;
}

interface CloudWatchLogEventsOutput {
  events?: Array<{ message?: string; timestamp?: number }>;
}

export interface FetchSpansForSessionOptions {
  cloudWatch?: CloudWatchLogsClientLike;
  limit?: number;
  runtimeLogGroup?: string | null;
  spansLogGroup?: string;
  startTime?: number;
}

export type AgentCoreSpanRecord = Record<string, unknown>;

const defaultCloudWatch = new CloudWatchLogsClient({ region: REGION });

export async function fetchSpansForSession(
  sessionId: string,
  options: FetchSpansForSessionOptions = {},
): Promise<AgentCoreSpanRecord[]> {
  const cloudWatch =
    options.cloudWatch ?? (defaultCloudWatch as CloudWatchLogsClientLike);
  const startTime = options.startTime ?? Date.now() - DEFAULT_LOOKBACK_MS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const filterPattern = `"${sessionId}"`;
  const spansLogGroup = options.spansLogGroup ?? DEFAULT_SPANS_LOG_GROUP;
  const runtimeLogGroup = options.runtimeLogGroup ?? null;

  const [spansResp, runtimeResp] = await Promise.all([
    cloudWatch.send(
      new FilterLogEventsCommand({
        logGroupName: spansLogGroup,
        startTime,
        filterPattern,
        limit,
      }),
    ),
    runtimeLogGroup
      ? cloudWatch.send(
          new FilterLogEventsCommand({
            logGroupName: runtimeLogGroup,
            startTime,
            filterPattern,
            limit,
          }),
        )
      : Promise.resolve({ events: [] } as CloudWatchLogEventsOutput),
  ]);

  return [
    ...parseCloudWatchEvents(spansResp, false),
    ...parseCloudWatchEvents(runtimeResp, true),
  ];
}

function parseCloudWatchEvents(
  resp: CloudWatchLogEventsOutput,
  onlyStrandsTracer: boolean,
): AgentCoreSpanRecord[] {
  return (resp.events ?? []).flatMap((event) => {
    const parsed = parseJsonObject(event.message);
    if (!parsed) return [];
    if (
      onlyStrandsTracer &&
      (parsed.scope as { name?: string } | undefined)?.name !==
        "strands.telemetry.tracer"
    ) {
      return [];
    }
    if (onlyStrandsTracer && !parsed.spanId) return [];
    return [
      {
        ...parsed,
        cloudWatchTimestamp:
          parsed.cloudWatchTimestamp ?? event.timestamp ?? null,
      },
    ];
  });
}

function parseJsonObject(
  message: string | undefined,
): AgentCoreSpanRecord | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is AgentCoreSpanRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
