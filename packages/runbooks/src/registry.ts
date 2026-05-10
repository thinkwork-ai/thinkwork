import { loadRunbooks } from "./loader.js";
import { RunbookValidationError, type RunbookDefinition } from "./schema.js";

export type RunbookRegistry = {
  all: RunbookDefinition[];
  bySlug: Map<string, RunbookDefinition>;
  get(slug: string): RunbookDefinition | undefined;
  require(slug: string): RunbookDefinition;
};

export function createRunbookRegistry(
  definitions: RunbookDefinition[],
): RunbookRegistry {
  const bySlug = new Map<string, RunbookDefinition>();
  const issues: string[] = [];
  for (const definition of definitions) {
    if (bySlug.has(definition.slug)) {
      issues.push(`duplicate runbook slug "${definition.slug}"`);
      continue;
    }
    bySlug.set(definition.slug, definition);
  }
  if (issues.length > 0) {
    throw new RunbookValidationError("Invalid runbook registry", issues);
  }

  const all = [...definitions].sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    all,
    bySlug,
    get(slug) {
      return bySlug.get(slug);
    },
    require(slug) {
      const runbook = bySlug.get(slug);
      if (!runbook) throw new Error(`Runbook not found: ${slug}`);
      return runbook;
    },
  };
}

export const runbookRegistry = createRunbookRegistry(loadRunbooks());
