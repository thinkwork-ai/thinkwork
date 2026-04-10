export const DEFAULT_AGENT_MODEL = "kimi-k2.5";

const KNOWN_MODEL_LABELS: Record<string, string> = {
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-6": "Claude Opus 4.6",
  "kimi-k2.5": "Kimi K2.5",
};

export function modelLabel(modelId?: string | null) {
  const id = modelId || DEFAULT_AGENT_MODEL;
  return KNOWN_MODEL_LABELS[id] ?? id;
}
