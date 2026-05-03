export interface NormalizedRoutineStep {
  nodeId: string;
  recipeId?: string;
  recipeType?: string;
  label?: string;
  args?: unknown;
}

export function parseAwsJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeRoutineExecutionManifest(
  manifestValue: unknown,
): NormalizedRoutineStep[] {
  const manifest = parseAwsJson(manifestValue);
  if (!isRecord(manifest)) return [];

  const definitionSteps = stepsFromDefinition(manifest.definition);
  if (definitionSteps.length > 0) return definitionSteps;

  const stepsArray = stepsFromArray(manifest.steps);
  if (stepsArray.length > 0) return stepsArray;

  return Object.entries(manifest).flatMap(([nodeId, meta]) => {
    if (nodeId === "definition" || !isRecord(meta)) return [];
    return [stepFromRecord(nodeId, meta)];
  });
}

function stepsFromDefinition(value: unknown): NormalizedRoutineStep[] {
  if (!isRecord(value)) return [];
  return stepsFromArray(value.steps);
}

function stepsFromArray(value: unknown): NormalizedRoutineStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.nodeId !== "string") return null;
      return stepFromRecord(item.nodeId, item);
    })
    .filter((step): step is NormalizedRoutineStep => step != null);
}

function stepFromRecord(
  nodeId: string,
  value: Record<string, unknown>,
): NormalizedRoutineStep {
  const recipeId = stringValue(value.recipeId);
  const recipeType = stringValue(value.recipeType) ?? recipeId;
  return {
    nodeId,
    recipeId,
    recipeType,
    label:
      stringValue(value.label) ??
      stringValue(value.displayTitle) ??
      stringValue(value.name),
    args: value.args,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
