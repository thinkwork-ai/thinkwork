export type SlackMetricName =
  | "slack.events.ingest_ms"
  | "slack.events.dedupe_hits"
  | "slack.events.unknown_team"
  | "slack.dispatch.success"
  | "slack.dispatch.failure"
  | "slack.attribution.degraded";

export type SlackMetricUnit = "Count" | "Milliseconds";

export interface SlackMetricPoint {
  name: SlackMetricName;
  value: number;
  unit: SlackMetricUnit;
  dimensions?: Record<string, string>;
}

export interface SlackMetrics {
  emit(point: SlackMetricPoint): void;
  ingestMs(value: number, dimensions?: Record<string, string>): void;
  dedupeHit(dimensions?: Record<string, string>): void;
  unknownTeam(dimensions?: Record<string, string>): void;
  dispatchSuccess(surface: string): void;
  dispatchFailure(errorClass: string): void;
  attributionDegraded(dimensions?: Record<string, string>): void;
}

const SLACK_METRICS_NAMESPACE = "ThinkWork/Slack";

export function createSlackMetrics(
  sink: (payload: Record<string, unknown>) => void = (payload) =>
    console.log(JSON.stringify(payload)),
  nowMs: () => number = Date.now,
): SlackMetrics {
  const metrics: SlackMetrics = {
    emit(point) {
      sink(buildSlackMetricEnvelope(point, nowMs()));
    },
    ingestMs(value, dimensions) {
      metrics.emit({
        name: "slack.events.ingest_ms",
        value,
        unit: "Milliseconds",
        dimensions,
      });
    },
    dedupeHit(dimensions) {
      metrics.emit({
        name: "slack.events.dedupe_hits",
        value: 1,
        unit: "Count",
        dimensions,
      });
    },
    unknownTeam(dimensions) {
      metrics.emit({
        name: "slack.events.unknown_team",
        value: 1,
        unit: "Count",
        dimensions,
      });
    },
    dispatchSuccess(surface) {
      metrics.emit({
        name: "slack.dispatch.success",
        value: 1,
        unit: "Count",
        dimensions: { surface },
      });
    },
    dispatchFailure(errorClass) {
      metrics.emit({
        name: "slack.dispatch.failure",
        value: 1,
        unit: "Count",
        dimensions: { error_class: errorClass },
      });
    },
    attributionDegraded(dimensions) {
      metrics.emit({
        name: "slack.attribution.degraded",
        value: 1,
        unit: "Count",
        dimensions,
      });
    },
  };
  return metrics;
}

export const slackMetrics = createSlackMetrics();

export function buildSlackMetricEnvelope(
  point: SlackMetricPoint,
  timestampMs: number = Date.now(),
): Record<string, unknown> {
  const dimensions = sanitizeDimensions(point.dimensions);
  const dimensionNames = Object.keys(dimensions).sort();
  return {
    _aws: {
      Timestamp: timestampMs,
      CloudWatchMetrics: [
        {
          Namespace: SLACK_METRICS_NAMESPACE,
          Dimensions: [dimensionNames],
          Metrics: [{ Name: point.name, Unit: point.unit }],
        },
      ],
    },
    ...dimensions,
    [point.name]: point.value,
  };
}

function sanitizeDimensions(
  dimensions: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(dimensions ?? {})) {
    if (key.trim() && value.trim()) out[key] = value;
  }
  return out;
}
