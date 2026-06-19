export interface MeltanoStateSummary {
  stateId: string;
  streamStates: Array<{
    streamName: string;
    cursorField: string;
    cursorValue: string | null;
  }>;
  capturedAt: string;
}

export function summarizeMeltanoState(input: {
  stateId: string;
  state: Record<string, unknown>;
  capturedAt: string;
}): MeltanoStateSummary {
  const streamStates = Object.entries(input.state).map(
    ([streamName, value]) => {
      const record = value && typeof value === "object" ? value : {};
      return {
        streamName,
        cursorField:
          typeof (record as Record<string, unknown>).cursorField === "string"
            ? ((record as Record<string, unknown>).cursorField as string)
            : "unknown",
        cursorValue:
          typeof (record as Record<string, unknown>).cursorValue === "string"
            ? ((record as Record<string, unknown>).cursorValue as string)
            : null,
      };
    },
  );
  return {
    stateId: input.stateId,
    streamStates,
    capturedAt: input.capturedAt,
  };
}
