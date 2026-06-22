import corpusJson from "./okf-wiki-navigator-corpus.json";

export const OKF_WIKI_NAVIGATOR_PROVIDER_IDS = [
  "db_wiki",
  "okf_navigator",
  "hybrid_db_okf",
  "raw_memory",
  "knowledge_graph",
] as const;

export type OkfWikiNavigatorProviderId =
  (typeof OKF_WIKI_NAVIGATOR_PROVIDER_IDS)[number];

export const OKF_WIKI_NAVIGATOR_CRITERION_IDS = [
  "relevance",
  "citation_correctness",
  "freshness",
  "latency",
  "trace_completeness",
  "prompt_injection_isolation",
  "failure_posture",
] as const;

export type OkfWikiNavigatorCriterionId =
  (typeof OKF_WIKI_NAVIGATOR_CRITERION_IDS)[number];

export type OkfWikiNavigatorProviderStatus =
  | "ok"
  | "empty"
  | "skipped"
  | "degraded"
  | "failed";

export type OkfWikiNavigatorCriterionVerdict = "pass" | "fail" | "unknown";

export interface OkfWikiNavigatorCorpusProvider {
  id: OkfWikiNavigatorProviderId;
  label: string;
  description: string;
  hardRequired: boolean;
}

export interface OkfWikiNavigatorCorpusCriterion {
  id: OkfWikiNavigatorCriterionId;
  label: string;
  description: string;
}

export interface OkfWikiNavigatorCorpusCase {
  id: string;
  title: string;
  question: string;
  focus: string[];
  requiredEvidence: string[];
  mustExerciseProviders: OkfWikiNavigatorProviderId[];
  expectedSignals: string[];
  promptInjectionFixture?: string;
  tags: string[];
}

export interface OkfWikiNavigatorCorpus {
  schemaVersion: 1;
  slug: string;
  name: string;
  description: string;
  providers: OkfWikiNavigatorCorpusProvider[];
  criteria: OkfWikiNavigatorCorpusCriterion[];
  cases: OkfWikiNavigatorCorpusCase[];
}

export interface OkfWikiNavigatorProviderObservation {
  providerId: OkfWikiNavigatorProviderId;
  status: OkfWikiNavigatorProviderStatus;
  latencyMs?: number;
  hitCount?: number;
  reason?: string;
  evidence?: Record<string, unknown>;
}

export interface OkfWikiNavigatorCaseComparison {
  caseId: string;
  query: string;
  providerResults: OkfWikiNavigatorProviderObservation[];
  criteria: Record<
    OkfWikiNavigatorCriterionId,
    OkfWikiNavigatorCriterionVerdict
  >;
  hybridEvidenceSources?: OkfWikiNavigatorProviderId[];
  notes?: string[];
}

export interface OkfWikiNavigatorComparisonReport {
  schemaVersion: 1;
  corpusSlug: string;
  generatedAt: string;
  environment?: Record<string, string | null>;
  providerMatrix: OkfWikiNavigatorCorpusProvider[];
  criteria: OkfWikiNavigatorCorpusCriterion[];
  cases: OkfWikiNavigatorCaseComparison[];
  summary: {
    caseCount: number;
    providerRows: number;
    hardRequiredProviderFailures: number;
    skippedOrDegradedOptionalProviders: number;
  };
}

const providerIdSet = new Set<string>(OKF_WIKI_NAVIGATOR_PROVIDER_IDS);
const criterionIdSet = new Set<string>(OKF_WIKI_NAVIGATOR_CRITERION_IDS);

export function isOkfWikiNavigatorProviderId(
  value: unknown,
): value is OkfWikiNavigatorProviderId {
  return typeof value === "string" && providerIdSet.has(value);
}

export function isOkfWikiNavigatorCriterionId(
  value: unknown,
): value is OkfWikiNavigatorCriterionId {
  return typeof value === "string" && criterionIdSet.has(value);
}

export function validateOkfWikiNavigatorCorpus(input: unknown): string[] {
  const errors: string[] = [];
  const corpus = record(input);
  if (corpus.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const field of ["slug", "name", "description"] as const) {
    if (!nonEmpty(corpus[field])) errors.push(`${field} is required`);
  }

  const providers = arrayOfRecords(corpus.providers);
  const providerIds = providers.map((provider) => provider.id);
  const missingProviders = OKF_WIKI_NAVIGATOR_PROVIDER_IDS.filter(
    (id) => !providerIds.includes(id),
  );
  if (missingProviders.length > 0) {
    errors.push(`missing providers: ${missingProviders.join(", ")}`);
  }
  if (new Set(providerIds).size !== providerIds.length) {
    errors.push("provider ids must be unique");
  }
  for (const provider of providers) {
    if (!isOkfWikiNavigatorProviderId(provider.id)) {
      errors.push(`unknown provider id: ${String(provider.id)}`);
    }
    if (!nonEmpty(provider.label)) {
      errors.push(`provider ${String(provider.id)} label is required`);
    }
    if (typeof provider.hardRequired !== "boolean") {
      errors.push(
        `provider ${String(provider.id)} hardRequired must be boolean`,
      );
    }
  }

  const criteria = arrayOfRecords(corpus.criteria);
  const criterionIds = criteria.map((criterion) => criterion.id);
  const missingCriteria = OKF_WIKI_NAVIGATOR_CRITERION_IDS.filter(
    (id) => !criterionIds.includes(id),
  );
  if (missingCriteria.length > 0) {
    errors.push(`missing criteria: ${missingCriteria.join(", ")}`);
  }
  if (new Set(criterionIds).size !== criterionIds.length) {
    errors.push("criterion ids must be unique");
  }
  for (const criterion of criteria) {
    if (!isOkfWikiNavigatorCriterionId(criterion.id)) {
      errors.push(`unknown criterion id: ${String(criterion.id)}`);
    }
    if (!nonEmpty(criterion.label)) {
      errors.push(`criterion ${String(criterion.id)} label is required`);
    }
  }

  const cases = arrayOfRecords(corpus.cases);
  if (cases.length === 0) errors.push("at least one case is required");
  const caseIds = cases.map((testCase) => testCase.id);
  if (new Set(caseIds).size !== caseIds.length) {
    errors.push("case ids must be unique");
  }
  for (const testCase of cases) {
    if (!nonEmpty(testCase.id)) errors.push("case id is required");
    if (!nonEmpty(testCase.title)) {
      errors.push(`case ${String(testCase.id)} title is required`);
    }
    if (!nonEmpty(testCase.question)) {
      errors.push(`case ${String(testCase.id)} question is required`);
    }
    for (const field of [
      "focus",
      "requiredEvidence",
      "mustExerciseProviders",
      "expectedSignals",
      "tags",
    ] as const) {
      const values = Array.isArray(testCase[field]) ? testCase[field] : [];
      if (values.length === 0) {
        errors.push(`case ${String(testCase.id)} ${field} must be non-empty`);
      }
    }
    const providersForCase = Array.isArray(testCase.mustExerciseProviders)
      ? testCase.mustExerciseProviders
      : [];
    for (const providerId of providersForCase) {
      if (!isOkfWikiNavigatorProviderId(providerId)) {
        errors.push(
          `case ${String(testCase.id)} references unknown provider ${String(providerId)}`,
        );
      }
    }
  }
  const injectionCase = cases.find((testCase) =>
    asString(testCase.tags).includes("prompt-injection"),
  );
  if (!injectionCase?.promptInjectionFixture) {
    errors.push("prompt-injection fixture case is required");
  }
  return errors;
}

export function assertValidOkfWikiNavigatorCorpus(
  input: unknown,
): asserts input is OkfWikiNavigatorCorpus {
  const errors = validateOkfWikiNavigatorCorpus(input);
  if (errors.length > 0) {
    throw new Error(
      `Invalid OKF Wiki Navigator corpus:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
  }
}

export function parseOkfWikiNavigatorCorpus(
  input: unknown,
): OkfWikiNavigatorCorpus {
  assertValidOkfWikiNavigatorCorpus(input);
  return input;
}

export const OKF_WIKI_NAVIGATOR_CORPUS =
  parseOkfWikiNavigatorCorpus(corpusJson);

export function okfWikiNavigatorHardRequiredProviders(
  corpus: OkfWikiNavigatorCorpus = OKF_WIKI_NAVIGATOR_CORPUS,
): OkfWikiNavigatorProviderId[] {
  return corpus.providers
    .filter((provider) => provider.hardRequired)
    .map((provider) => provider.id);
}

export function buildOkfWikiNavigatorComparisonReport(args: {
  generatedAt: string;
  caseResults: OkfWikiNavigatorCaseComparison[];
  corpus?: OkfWikiNavigatorCorpus;
  environment?: Record<string, string | null>;
}): OkfWikiNavigatorComparisonReport {
  const corpus = args.corpus ?? OKF_WIKI_NAVIGATOR_CORPUS;
  assertValidOkfWikiNavigatorCorpus(corpus);
  validateCaseComparisons(corpus, args.caseResults);

  const hardRequiredProviders = new Set(
    okfWikiNavigatorHardRequiredProviders(corpus),
  );
  let hardRequiredProviderFailures = 0;
  let skippedOrDegradedOptionalProviders = 0;

  for (const result of args.caseResults) {
    for (const provider of result.providerResults) {
      if (
        hardRequiredProviders.has(provider.providerId) &&
        (provider.status === "failed" || provider.status === "skipped")
      ) {
        hardRequiredProviderFailures += 1;
      }
      if (
        !hardRequiredProviders.has(provider.providerId) &&
        (provider.status === "skipped" || provider.status === "degraded")
      ) {
        skippedOrDegradedOptionalProviders += 1;
      }
    }
  }

  return {
    schemaVersion: 1,
    corpusSlug: corpus.slug,
    generatedAt: args.generatedAt,
    ...(args.environment ? { environment: args.environment } : {}),
    providerMatrix: corpus.providers,
    criteria: corpus.criteria,
    cases: args.caseResults,
    summary: {
      caseCount: args.caseResults.length,
      providerRows: args.caseResults.reduce(
        (sum, result) => sum + result.providerResults.length,
        0,
      ),
      hardRequiredProviderFailures,
      skippedOrDegradedOptionalProviders,
    },
  };
}

function validateCaseComparisons(
  corpus: OkfWikiNavigatorCorpus,
  caseResults: OkfWikiNavigatorCaseComparison[],
): void {
  const knownCases = new Map(
    corpus.cases.map((testCase) => [testCase.id, testCase]),
  );
  if (caseResults.length === 0) {
    throw new Error("comparison report must include at least one case");
  }

  for (const result of caseResults) {
    const testCase = knownCases.get(result.caseId);
    if (!testCase) throw new Error(`unknown comparison case: ${result.caseId}`);
    const observedProviders = new Set(
      result.providerResults.map((provider) => provider.providerId),
    );
    const missing = corpus.providers
      .map((provider) => provider.id)
      .filter((providerId) => !observedProviders.has(providerId));
    if (missing.length > 0) {
      throw new Error(
        `case ${result.caseId} missing provider rows: ${missing.join(", ")}`,
      );
    }
    for (const criterionId of OKF_WIKI_NAVIGATOR_CRITERION_IDS) {
      if (!result.criteria[criterionId]) {
        throw new Error(
          `case ${result.caseId} missing criterion ${criterionId}`,
        );
      }
    }
    const hybrid = result.providerResults.find(
      (provider) => provider.providerId === "hybrid_db_okf",
    );
    if (hybrid?.status === "ok") {
      const sources = new Set(result.hybridEvidenceSources ?? []);
      if (!sources.has("db_wiki") || !sources.has("okf_navigator")) {
        throw new Error(
          `case ${result.caseId} hybrid result must cite db_wiki and okf_navigator sources`,
        );
      }
    }
    const extraProviders = [...observedProviders].filter(
      (providerId) => !testCase.mustExerciseProviders.includes(providerId),
    );
    if (extraProviders.length > 0) {
      throw new Error(
        `case ${result.caseId} has unexpected provider rows: ${extraProviders.join(", ")}`,
      );
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const itemRecord = record(item);
        return Object.keys(itemRecord).length > 0 ? [itemRecord] : [];
      })
    : [];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asString(value: unknown): string {
  return Array.isArray(value) ? value.join(" ") : String(value ?? "");
}
