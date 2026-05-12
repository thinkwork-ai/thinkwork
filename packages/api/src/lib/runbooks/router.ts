import type { RunbookDefinition } from "@thinkwork/runbooks";

export type RunbookRouteMatch =
  | {
      kind: "explicit";
      runbook: RunbookDefinition;
      confidence: 1;
      matchedAlias: string;
    }
  | {
      kind: "auto";
      runbook: RunbookDefinition;
      confidence: number;
      matchedKeywords: string[];
    }
  | {
      kind: "ambiguous";
      candidates: Array<{
        runbook: RunbookDefinition;
        confidence: number;
        matchedKeywords: string[];
      }>;
    }
  | { kind: "no_match" };

const EXPLICIT_VERBS = /\b(run|start|execute|use)\b/i;
const HIGH_CONFIDENCE = 0.62;
const AMBIGUOUS_DELTA = 0.08;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "based",
  "be",
  "build",
  "create",
  "for",
  "from",
  "i",
  "into",
  "it",
  "me",
  "of",
  "on",
  "or",
  "please",
  "show",
  "that",
  "the",
  "these",
  "this",
  "to",
  "turn",
  "with",
]);

export function routeRunbookPrompt(input: {
  prompt: string;
  runbooks: RunbookDefinition[];
}): RunbookRouteMatch {
  const normalizedPrompt = normalizeText(input.prompt);
  if (!normalizedPrompt) return { kind: "no_match" };

  const explicit = findExplicitRunbook({
    normalizedPrompt,
    prompt: input.prompt,
    runbooks: input.runbooks,
  });
  if (explicit) return explicit;

  const candidates = scoreRunbooks(normalizedPrompt, input.runbooks)
    .filter((candidate) => candidate.confidence >= HIGH_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  if (candidates.length === 0) return { kind: "no_match" };
  if (
    candidates.length > 1 &&
    candidates[0].confidence - candidates[1].confidence <= AMBIGUOUS_DELTA
  ) {
    return { kind: "ambiguous", candidates: candidates.slice(0, 3) };
  }

  return {
    kind: "auto",
    runbook: candidates[0].runbook,
    confidence: candidates[0].confidence,
    matchedKeywords: candidates[0].matchedKeywords,
  };
}

function findExplicitRunbook(input: {
  prompt: string;
  normalizedPrompt: string;
  runbooks: RunbookDefinition[];
}): Extract<RunbookRouteMatch, { kind: "explicit" }> | null {
  const asksForRunbook = input.normalizedPrompt.includes("runbook");
  const commandLike = EXPLICIT_VERBS.test(input.prompt);
  if (!asksForRunbook && !commandLike) return null;

  for (const runbook of input.runbooks) {
    const aliases = [
      runbook.slug,
      runbook.slug.replace(/-/g, " "),
      runbook.catalog.displayName,
      ...runbook.routing.explicitAliases,
    ].map(normalizeText);
    const matchedAlias = aliases.find((alias) =>
      input.normalizedPrompt.includes(alias),
    );
    if (matchedAlias) {
      return {
        kind: "explicit",
        runbook,
        confidence: 1,
        matchedAlias,
      };
    }
  }

  return null;
}

function scoreRunbooks(
  normalizedPrompt: string,
  runbooks: RunbookDefinition[],
): Array<{
  runbook: RunbookDefinition;
  confidence: number;
  matchedKeywords: string[];
}> {
  const promptTokens = new Set(tokenize(normalizedPrompt));
  return runbooks.map((runbook) => {
    const weighted = buildWeightedKeywords(runbook);
    const matchedKeywords = [...weighted.keys()]
      .filter((keyword) => promptTokens.has(keyword))
      .sort();
    const matchedWeight = matchedKeywords.reduce(
      (sum, keyword) => sum + (weighted.get(keyword) ?? 0),
      0,
    );
    const maxUsefulWeight = Math.min(
      10,
      [...weighted.values()].reduce((sum, weight) => sum + weight, 0),
    );
    return {
      runbook,
      confidence:
        maxUsefulWeight === 0
          ? 0
          : Math.min(matchedWeight / maxUsefulWeight, 1),
      matchedKeywords,
    };
  });
}

function buildWeightedKeywords(runbook: RunbookDefinition) {
  const weighted = new Map<string, number>();
  addWeightedText(weighted, runbook.slug.replace(/-/g, " "), 3);
  addWeightedText(weighted, runbook.catalog.displayName, 3);
  addWeightedText(weighted, runbook.catalog.description, 1);
  for (const alias of runbook.routing.explicitAliases) {
    addWeightedText(weighted, alias, 3);
  }
  for (const example of runbook.routing.triggerExamples) {
    addWeightedText(weighted, example, 2);
  }
  for (const hint of runbook.routing.confidenceHints) {
    addWeightedText(weighted, hint, 1);
  }
  return weighted;
}

function addWeightedText(
  weighted: Map<string, number>,
  text: string,
  weight: number,
) {
  for (const token of tokenize(normalizeText(text))) {
    weighted.set(token, Math.min((weighted.get(token) ?? 0) + weight, 5));
  }
}

function tokenize(value: string) {
  return value
    .split(" ")
    .map((token) => singularize(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(value: string) {
  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && value.length > 4) {
    return value.slice(0, -1);
  }
  return value;
}
