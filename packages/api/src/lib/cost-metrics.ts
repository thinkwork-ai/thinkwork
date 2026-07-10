/**
 * Cost-observability metrics (THINK-245 U5/U10) — CloudWatch Embedded Metric
 * Format envelopes printed to stdout, namespace `Thinkwork/Costs`, `Stage`
 * dimension. EMF needs no IAM grant (the log pipeline extracts the metrics),
 * which is why it was chosen over PutMetricData.
 *
 * Consumers: trace-invocation-reconciler (ReconcilerMatched /
 * ReconcilerUnreconciled / ReconcilerAmbiguous) and cost-drift-check
 * (CostDriftPercent / CostDriftCheckFailed). CloudWatch alarms on these feed
 * the cost-alerts SNS topic — the reconciler ran silently broken for two
 * weeks once; these metrics are the "never again" contract (AE4).
 */

export const COST_METRICS_NAMESPACE = "Thinkwork/Costs";

export interface CostMetricPoint {
  name: string;
  value: number;
  unit?: "Count" | "Percent";
  /** Extra dimensions beyond Stage (keep cardinality low — model at most). */
  dimensions?: Record<string, string>;
}

export function buildCostMetricEnvelope(
  points: CostMetricPoint[],
  timestampMs: number = Date.now(),
): Record<string, unknown> {
  const stage = process.env.STAGE || "dev";
  const dimensions: Record<string, string> = { Stage: stage };
  for (const point of points) {
    for (const [key, value] of Object.entries(point.dimensions ?? {})) {
      if (key.trim() && value.trim()) dimensions[key] = value;
    }
  }
  const dimensionNames = Object.keys(dimensions).sort();
  const envelope: Record<string, unknown> = {
    _aws: {
      Timestamp: timestampMs,
      CloudWatchMetrics: [
        {
          Namespace: COST_METRICS_NAMESPACE,
          Dimensions: [dimensionNames],
          Metrics: points.map((point) => ({
            Name: point.name,
            Unit: point.unit ?? "Count",
          })),
        },
      ],
    },
    ...dimensions,
  };
  for (const point of points) {
    envelope[point.name] = point.value;
  }
  return envelope;
}

/** Emit one EMF envelope carrying the given metric points. */
export function emitCostMetrics(points: CostMetricPoint[]): void {
  if (points.length === 0) return;
  console.log(JSON.stringify(buildCostMetricEnvelope(points)));
}
