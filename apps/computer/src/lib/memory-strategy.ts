/** Hindsight memory-strategy presentation helpers ported from admin. */

export const STRATEGY_COLORS: Record<string, string> = {
  semantic: "bg-blue-500/20 text-blue-400",
  preferences: "bg-purple-500/20 text-purple-400",
  summaries: "bg-yellow-500/20 text-yellow-400",
  episodes: "bg-green-500/20 text-green-400",
  reflections: "bg-orange-500/20 text-orange-400",
};

/**
 * Resolve a memory record's strategy from its strategyId / namespace when the
 * server didn't tag it directly. Mirror of admin's inferStrategy.
 */
export function inferStrategy(strategyId: string, namespace: string): string {
  if (strategyId.includes("semantic")) return "semantic";
  if (strategyId.includes("summary") || strategyId.includes("Summar")) return "summaries";
  if (strategyId.includes("Preference") || strategyId.includes("preference")) return "preferences";
  if (strategyId.includes("Episode") || strategyId.includes("episode")) return "episodes";
  if (namespace.startsWith("assistant_")) return "semantic";
  if (namespace.startsWith("preferences_")) return "preferences";
  if (namespace.startsWith("session_")) return "summaries";
  if (namespace.startsWith("episodes_")) return "episodes";
  return "semantic";
}

/**
 * Parse `<topic name="…">…</topic>` blocks (the format Hindsight's retain step
 * emits) into structured sections. Handles both closed and unclosed tags.
 */
export function parseMemoryTopics(text: string): { topic: string; content: string }[] {
  const regex = /<topic\s+name="([^"]*)">\s*([\s\S]*?)(?:<\/topic>|(?=<topic\s)|$)/g;
  const sections: { topic: string; content: string }[] = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) sections.push({ topic: "", content: before });
    sections.push({ topic: match[1], content: match[2].trim() });
    lastIndex = regex.lastIndex;
  }
  const after = text.slice(lastIndex).trim();
  if (after) sections.push({ topic: "", content: after });
  if (sections.length === 0) sections.push({ topic: "", content: text });
  return sections;
}

/** Strip topic XML tags for plain-text display in table rows. */
export function stripTopicTags(text: string): string {
  return text
    .replace(/<\/?topic[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function strategyLabel(strategy: string | null): string {
  if (!strategy) return "";
  return strategy.charAt(0).toUpperCase() + strategy.slice(1);
}
