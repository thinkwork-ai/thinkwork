import {
  CUSTOMER_OVERLAY_EVAL_SOURCE,
  type SeedAssertion,
  type SeedTestCase,
} from "./eval-seeds.js";

export { CUSTOMER_OVERLAY_EVAL_SOURCE };

export interface CustomerOverlayEvalRow {
  tenant_id: string;
  name: string;
  category: string;
  query: string;
  system_prompt: string | null;
  assertions: SeedAssertion[];
  source: typeof CUSTOMER_OVERLAY_EVAL_SOURCE;
  tags: string[];
  agentcore_evaluator_ids: string[];
  enabled: boolean;
}

export interface ExistingCustomerOverlayEval {
  id: string;
  name: string;
  tags: string[];
  source: string;
}

export interface CustomerOverlayEvalPlan {
  insert: CustomerOverlayEvalRow[];
  update: Array<{ id: string; row: CustomerOverlayEvalRow }>;
  skip: CustomerOverlayEvalRow[];
}

export function parseCustomerOverlayEvalPack(
  raw: unknown,
  packName: string,
): SeedTestCase[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Customer eval pack ${packName} must be a JSON array`);
  }
  return raw.map((value, index) =>
    normalizeSeed(value, `${packName}[${index}]`),
  );
}

export function buildCustomerOverlayEvalRows(args: {
  tenantId: string;
  packName: string;
  seeds: SeedTestCase[];
}): CustomerOverlayEvalRow[] {
  return args.seeds.map((seed) => ({
    tenant_id: args.tenantId,
    name: seed.name,
    category: seed.category,
    query: seed.query,
    system_prompt: seed.prompt ?? null,
    assertions: seed.assertions,
    source: CUSTOMER_OVERLAY_EVAL_SOURCE,
    tags: overlayTags(args.packName, seed),
    agentcore_evaluator_ids:
      seed.agentcore_evaluator_ids && seed.agentcore_evaluator_ids.length > 0
        ? seed.agentcore_evaluator_ids
        : ["Builtin.Helpfulness"],
    enabled: true,
  }));
}

export function planCustomerOverlayEvalApply(args: {
  rows: CustomerOverlayEvalRow[];
  existing: ExistingCustomerOverlayEval[];
}): CustomerOverlayEvalPlan {
  const existingByKey = new Map(
    args.existing.flatMap((row) =>
      row.tags
        .filter((tag) => tag.startsWith("customer-overlay:key:"))
        .map((tag) => [tag, row] as const),
    ),
  );
  const plan: CustomerOverlayEvalPlan = { insert: [], update: [], skip: [] };
  for (const row of args.rows) {
    const key = row.tags.find((tag) => tag.startsWith("customer-overlay:key:"));
    const existing = key ? existingByKey.get(key) : undefined;
    if (!existing) {
      plan.insert.push(row);
    } else if (existing.source === CUSTOMER_OVERLAY_EVAL_SOURCE) {
      plan.update.push({ id: existing.id, row });
    } else {
      plan.insert.push(row);
    }
  }
  return plan;
}

function normalizeSeed(value: unknown, label: string): SeedTestCase {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!isNonEmptyString(value.name))
    throw new Error(`${label}.name is required`);
  if (!isNonEmptyString(value.category))
    throw new Error(`${label}.category is required`);
  if (!isNonEmptyString(value.query))
    throw new Error(`${label}.query is required`);
  if (!Array.isArray(value.assertions)) {
    throw new Error(`${label}.assertions must be an array`);
  }
  return {
    name: value.name,
    category: value.category,
    query: value.query,
    prompt: typeof value.prompt === "string" ? value.prompt : undefined,
    assertions: value.assertions.map((assertion, index) =>
      normalizeAssertion(assertion, `${label}.assertions[${index}]`),
    ),
    agentcore_evaluator_ids: Array.isArray(value.agentcore_evaluator_ids)
      ? value.agentcore_evaluator_ids.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
      : undefined,
  };
}

function normalizeAssertion(value: unknown, label: string): SeedAssertion {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!isNonEmptyString(value.type))
    throw new Error(`${label}.type is required`);
  return {
    type: value.type,
    value:
      typeof value.value === "string" || value.value === null
        ? value.value
        : null,
  };
}

function overlayTags(packName: string, seed: SeedTestCase): string[] {
  return [
    "source:customer-overlay",
    `customer-overlay:pack:${packName}`,
    `customer-overlay:key:${packName}/${slugify(seed.name)}`,
    seed.target_surface ? `surface:${seed.target_surface}` : null,
    seed.target_skill ? `skill:${seed.target_skill}` : null,
    typeof seed.threshold === "number" ? `threshold:${seed.threshold}` : null,
  ].filter((tag): tag is string => Boolean(tag));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
