import type { FivetranComparisonSummary } from "./parity-report";

export function compareRowCounts(input: {
  streamName: string;
  fivetranRowCount?: number;
  meltanoRowCount?: number;
}): FivetranComparisonSummary {
  return {
    streamName: input.streamName,
    fivetranRowCount: input.fivetranRowCount,
    meltanoRowCount: input.meltanoRowCount,
  };
}
