import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEvidenceExamples,
  ontologySuggestionScanJobs,
  tenantEntityExternalRefs,
  tenantEntityPageSections,
  tenantEntityPages,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { invokeClaudeJson, parseJsonResponse } from "../wiki/bedrock.js";
import {
  listOntologyDefinitions,
  loadOntologySuggestionScanJob,
} from "./repository.js";
import { toOntologySuggestionScanJob } from "./mappers.js";
import {
  dedupeEvidence,
  evidenceFromText,
  type OntologyEvidenceInput,
} from "./evidence.js";
import { standardsMappingsForTypeSlug } from "./standards-mappings.js";

type DbLike = typeof defaultDb;

const OPEN_CHANGE_SET_STATUSES = ["draft", "pending_review"] as const;
const ONTOLOGY_SCAN_BUCKET_SECONDS = 300;
const SUPPORT_CASE_SOURCE_RE =
  /(support|case|ticket|zendesk|intercom|helpdesk)/i;
const COMMITMENT_TEXT_RE =
  /\b(commitment|committed|promise|promised|due|follow[-\s]?up|owner|deliver by|by \d{1,2}\/\d{1,2}|by (mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december))/i;

export interface OntologyScanProviderStatus {
  provider: "brain" | "external_refs" | "hindsight" | "llm";
  state: "ok" | "degraded" | "unavailable" | "skipped" | "error";
  detail?: string;
  count?: number;
}

export interface OntologySuggestionObservation extends OntologyEvidenceInput {
  text: string;
}

export interface OntologySuggestionFeature {
  kind: "customer_commitment" | "support_case_refs";
  title: string;
  evidence: OntologyEvidenceInput[];
  frequency: number;
  metadata?: Record<string, unknown>;
}

export interface OntologySuggestionItemProposal {
  itemType:
    | "entity_type"
    | "relationship_type"
    | "facet_template"
    | "external_mapping";
  action: "create" | "update" | "deprecate" | "reject";
  targetKind: string;
  targetSlug: string;
  title: string;
  description: string;
  proposedValue: Record<string, unknown>;
  confidence: number;
  evidence: OntologyEvidenceInput[];
}

export interface OntologyChangeSetProposal {
  key: string;
  title: string;
  summary: string;
  confidence: number;
  observedFrequency: number;
  expectedImpact: Record<string, unknown>;
  items: OntologySuggestionItemProposal[];
}

export interface OntologyScanResult {
  jobId: string;
  tenantId: string;
  status: "succeeded" | "failed";
  createdChangeSetIds: string[];
  updatedChangeSetIds: string[];
  noOp: boolean;
  degraded: boolean;
  metrics: Record<string, unknown>;
  providerStatuses: OntologyScanProviderStatus[];
}

export interface ActiveOntologySnapshot {
  entityTypeSlugs: Set<string>;
  relationshipTypeSlugs: Set<string>;
  facetTemplateSlugs: Set<string>;
  mappingKeys: Set<string>;
}

export function buildOntologyScanDedupeKey(args: {
  tenantId: string;
  trigger?: string | null;
  now?: Date;
}): string {
  const bucket = Math.floor(
    (args.now ?? new Date()).valueOf() / 1000 / ONTOLOGY_SCAN_BUCKET_SECONDS,
  );
  return `ontology-scan:${args.tenantId}:${args.trigger || "manual"}:${bucket}`;
}

export async function startOntologySuggestionScanJob(args: {
  tenantId: string;
  trigger?: string | null;
  dedupeKey?: string | null;
  db?: DbLike;
  invoke?: boolean;
  lambdaClient?: Pick<LambdaClient, "send">;
}) {
  const db = args.db ?? defaultDb;
  const dedupeKey =
    args.dedupeKey ??
    buildOntologyScanDedupeKey({
      tenantId: args.tenantId,
      trigger: args.trigger,
    });
  const [existing] = await db
    .select()
    .from(ontologySuggestionScanJobs)
    .where(
      and(
        eq(ontologySuggestionScanJobs.tenant_id, args.tenantId),
        eq(ontologySuggestionScanJobs.dedupe_key, dedupeKey),
      ),
    )
    .limit(1);

  const created = existing
    ? { job: existing, deduped: true }
    : await insertOrLoadOntologyScanJob({
        tenantId: args.tenantId,
        trigger: args.trigger || "manual",
        dedupeKey,
        db,
      });
  const { job } = created;

  if (!job) {
    throw new Error("Ontology suggestion scan job could not be created");
  }

  const mapped = toOntologySuggestionScanJob(job);
  if (args.invoke !== false && shouldInvokeScan(job.status)) {
    try {
      const invokeResult = await invokeOntologySuggestionScan({
        tenantId: args.tenantId,
        jobId: job.id,
        lambdaClient: args.lambdaClient,
      });
      return {
        ...mapped,
        result: {
          ...(mapped.result ?? {}),
          invoke: invokeResult,
          deduped: created.deduped,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result = {
        ...(mapped.result ?? {}),
        invoke: { state: "error", error: message },
        deduped: created.deduped,
      };
      await updateScanJob(db, job.id, {
        status: "failed",
        finished_at: new Date(),
        error: message,
        result,
        metrics: { invokeFailure: true },
      });
      return (
        (await loadOntologySuggestionScanJob({
          tenantId: args.tenantId,
          jobId: job.id,
          db,
        })) ?? {
          ...mapped,
          status: "FAILED",
          error: message,
          result,
          metrics: { invokeFailure: true },
        }
      );
    }
  }

  return {
    ...mapped,
    result: {
      ...(mapped.result ?? {}),
      deduped: created.deduped,
      invoke: { state: "skipped" },
    },
  };
}

async function insertOrLoadOntologyScanJob(args: {
  tenantId: string;
  trigger: string;
  dedupeKey: string;
  db: DbLike;
}) {
  const [inserted] = await args.db
    .insert(ontologySuggestionScanJobs)
    .values({
      tenant_id: args.tenantId,
      trigger: args.trigger,
      dedupe_key: args.dedupeKey,
      status: "pending",
      result: {},
      metrics: {},
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return { job: inserted, deduped: false };

  const [existing] = await args.db
    .select()
    .from(ontologySuggestionScanJobs)
    .where(
      and(
        eq(ontologySuggestionScanJobs.tenant_id, args.tenantId),
        eq(ontologySuggestionScanJobs.dedupe_key, args.dedupeKey),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      `Ontology suggestion scan dedupe conflict but no existing job was found for key=${args.dedupeKey}`,
    );
  }
  return { job: existing, deduped: true };
}

function shouldInvokeScan(status: string) {
  return status === "pending" || status === "failed" || status === "canceled";
}

export async function invokeOntologySuggestionScan(args: {
  tenantId: string;
  jobId: string;
  lambdaClient?: Pick<LambdaClient, "send">;
}) {
  const functionName =
    process.env.ONTOLOGY_SCAN_FUNCTION_NAME ||
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-ontology-scan`
      : "");
  if (!functionName) {
    return { state: "skipped", reason: "ONTOLOGY_SCAN_FUNCTION_NAME unset" };
  }

  const client =
    args.lambdaClient ??
    new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({ tenantId: args.tenantId, jobId: args.jobId }),
      ),
    }),
  );
  return { state: "invoked", functionName };
}

export async function runOntologySuggestionScan(args: {
  tenantId: string;
  jobId: string;
  db?: DbLike;
  llmEnabled?: boolean;
  synthesisJson?: string;
}): Promise<OntologyScanResult> {
  const db = args.db ?? defaultDb;
  const [job] = await db
    .select()
    .from(ontologySuggestionScanJobs)
    .where(
      and(
        eq(ontologySuggestionScanJobs.id, args.jobId),
        eq(ontologySuggestionScanJobs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!job) throw new Error("Ontology suggestion scan job not found");

  await updateScanJob(db, args.jobId, {
    status: "running",
    started_at: new Date(),
    error: null,
  });

  try {
    const definitions = await listOntologyDefinitions({
      tenantId: args.tenantId,
      db,
    });
    const activeOntology = activeOntologySnapshot(definitions);
    const sourceBundle = await collectOntologySuggestionSources({
      tenantId: args.tenantId,
      db,
    });
    const features = extractOntologySuggestionFeatures({
      observations: sourceBundle.observations,
      activeOntology,
    });
    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: args.tenantId,
      features,
      activeOntology,
      llmEnabled:
        args.llmEnabled ??
        process.env.ONTOLOGY_SUGGESTIONS_LLM_DISABLED !== "1",
      synthesisJson: args.synthesisJson,
    });
    const persisted = await persistOntologyChangeSetProposals({
      tenantId: args.tenantId,
      jobId: args.jobId,
      proposals,
      db,
    });
    const result: OntologyScanResult = {
      tenantId: args.tenantId,
      jobId: args.jobId,
      status: "succeeded",
      createdChangeSetIds: persisted.createdChangeSetIds,
      updatedChangeSetIds: persisted.updatedChangeSetIds,
      noOp: proposals.length === 0,
      degraded: sourceBundle.providerStatuses.some((status) =>
        ["degraded", "unavailable", "error"].includes(status.state),
      ),
      metrics: {
        observations: sourceBundle.observations.length,
        features: features.length,
        proposals: proposals.length,
        createdChangeSets: persisted.createdChangeSetIds.length,
        updatedChangeSets: persisted.updatedChangeSetIds.length,
      },
      providerStatuses: sourceBundle.providerStatuses,
    };
    await updateScanJob(db, args.jobId, {
      status: "succeeded",
      finished_at: new Date(),
      result,
      metrics: result.metrics,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: OntologyScanResult = {
      tenantId: args.tenantId,
      jobId: args.jobId,
      status: "failed",
      createdChangeSetIds: [],
      updatedChangeSetIds: [],
      noOp: false,
      degraded: true,
      metrics: { failure: true },
      providerStatuses: [{ provider: "llm", state: "error", detail: message }],
    };
    await updateScanJob(db, args.jobId, {
      status: "failed",
      finished_at: new Date(),
      error: message,
      result,
      metrics: result.metrics,
    });
    return result;
  }
}

export async function collectOntologySuggestionSources(args: {
  tenantId: string;
  db?: DbLike;
}): Promise<{
  observations: OntologySuggestionObservation[];
  providerStatuses: OntologyScanProviderStatus[];
}> {
  const db = args.db ?? defaultDb;
  const observations: OntologySuggestionObservation[] = [];
  const providerStatuses: OntologyScanProviderStatus[] = [];

  const sectionRows = await db
    .select({
      pageId: tenantEntityPages.id,
      pageTitle: tenantEntityPages.title,
      pageSlug: tenantEntityPages.slug,
      entitySubtype: tenantEntityPages.entity_subtype,
      sectionId: tenantEntityPageSections.id,
      heading: tenantEntityPageSections.heading,
      bodyMd: tenantEntityPageSections.body_md,
      updatedAt: tenantEntityPageSections.updated_at,
    })
    .from(tenantEntityPageSections)
    .innerJoin(
      tenantEntityPages,
      eq(tenantEntityPageSections.page_id, tenantEntityPages.id),
    )
    .where(
      and(
        eq(tenantEntityPages.tenant_id, args.tenantId),
        eq(tenantEntityPages.status, "active"),
        eq(tenantEntityPageSections.status, "active"),
      ),
    )
    .orderBy(desc(tenantEntityPageSections.updated_at))
    .limit(300);

  for (const row of sectionRows) {
    const evidence = evidenceFromText({
      sourceKind: "brain_section",
      sourceRef: row.sectionId,
      sourceLabel: `${row.pageTitle} / ${row.heading}`,
      text: row.bodyMd,
      observedAt: row.updatedAt,
      metadata: {
        pageId: row.pageId,
        pageSlug: row.pageSlug,
        entitySubtype: row.entitySubtype,
        heading: row.heading,
      },
    });
    if (evidence) observations.push({ ...evidence, text: row.bodyMd });
  }
  providerStatuses.push({
    provider: "brain",
    state: "ok",
    count: sectionRows.length,
  });

  const externalRows = await db
    .select()
    .from(tenantEntityExternalRefs)
    .where(eq(tenantEntityExternalRefs.tenant_id, args.tenantId))
    .orderBy(desc(tenantEntityExternalRefs.updated_at))
    .limit(300);
  for (const row of externalRows) {
    const text = summarizeExternalPayload(row.source_payload);
    const evidence = evidenceFromText({
      sourceKind: row.source_kind,
      sourceRef: row.external_id ?? row.id,
      sourceLabel: row.external_id
        ? `${row.source_kind}:${row.external_id}`
        : row.source_kind,
      text,
      observedAt: row.as_of,
      metadata: {
        externalRefId: row.id,
        ttlSeconds: row.ttl_seconds,
      },
    });
    if (evidence) observations.push({ ...evidence, text });
  }
  providerStatuses.push({
    provider: "external_refs",
    state: "ok",
    count: externalRows.length,
  });

  providerStatuses.push({
    provider: "hindsight",
    state: process.env.HINDSIGHT_ENDPOINT ? "degraded" : "unavailable",
    detail: process.env.HINDSIGHT_ENDPOINT
      ? "Hindsight scan adapter not yet wired for ontology suggestions; using Brain and external refs."
      : "Hindsight endpoint unavailable; using Brain and external refs.",
  });

  return { observations, providerStatuses };
}

function summarizeExternalPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const parts = [
    stringValue(record.title),
    stringValue(record.name),
    stringValue(record.summary),
    stringValue(record.description),
    stringValue(record.status),
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" - ");
  return JSON.stringify(record).slice(0, 500);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractOntologySuggestionFeatures(args: {
  observations: OntologySuggestionObservation[];
  activeOntology: ActiveOntologySnapshot;
}): OntologySuggestionFeature[] {
  const features: OntologySuggestionFeature[] = [];
  const commitmentEvidence = dedupeEvidence(
    args.observations
      .filter((observation) => COMMITMENT_TEXT_RE.test(observation.text))
      .map((observation) => observation),
    8,
  );
  if (commitmentEvidence.length >= 2) {
    features.push({
      kind: "customer_commitment",
      title: "Customer commitment model",
      evidence: commitmentEvidence,
      frequency: commitmentEvidence.length,
      metadata: {
        existingCommitmentType:
          args.activeOntology.entityTypeSlugs.has("commitment"),
      },
    });
  }

  const supportCaseEvidence = dedupeEvidence(
    args.observations
      .filter((observation) =>
        SUPPORT_CASE_SOURCE_RE.test(observation.sourceKind),
      )
      .map((observation) => observation),
    8,
  );
  if (supportCaseEvidence.length >= 2) {
    features.push({
      kind: "support_case_refs",
      title: "Support case facets",
      evidence: supportCaseEvidence,
      frequency: supportCaseEvidence.length,
    });
  }

  return features;
}

export async function synthesizeOntologyChangeSetProposals(args: {
  tenantId: string;
  features: OntologySuggestionFeature[];
  activeOntology: ActiveOntologySnapshot;
  llmEnabled?: boolean;
  synthesisJson?: string;
}): Promise<OntologyChangeSetProposal[]> {
  if (args.features.length === 0) return [];
  if (args.synthesisJson !== undefined) {
    return parseOntologySynthesisResponse(args.synthesisJson, args.features);
  }
  if (args.llmEnabled) {
    const response = await invokeClaudeJson<{ proposals: unknown[] }>({
      system: ONTOLOGY_SYNTHESIS_SYSTEM,
      user: JSON.stringify({
        tenantId: args.tenantId,
        features: args.features.map((feature) => ({
          kind: feature.kind,
          title: feature.title,
          frequency: feature.frequency,
          evidence: feature.evidence.map((item) => ({
            sourceKind: item.sourceKind,
            sourceLabel: item.sourceLabel,
            quote: item.quote,
          })),
        })),
      }),
      maxTokens: 4096,
      temperature: 0,
    });
    return parseOntologySynthesisParsed(response.parsed, args.features);
  }
  return deterministicProposals(args.features, args.activeOntology);
}

const ONTOLOGY_SYNTHESIS_SYSTEM = `You group recurring ThinkWork business-memory observations into ontology change-set proposals.
Return JSON only: {"proposals":[{"key":"...","title":"...","summary":"...","confidence":0.75,"observedFrequency":2,"expectedImpact":{},"items":[{"itemType":"entity_type|relationship_type|facet_template|external_mapping","action":"create|update|deprecate|reject","targetKind":"...","targetSlug":"...","title":"...","description":"...","proposedValue":{},"confidence":0.75,"evidenceIndexes":[0,1]}]}]}.
Every item must cite at least one feature evidence index. External standards are metadata only and must not rename ThinkWork canonical types such as customer.`;

export function parseOntologySynthesisResponse(
  text: string,
  features: OntologySuggestionFeature[],
): OntologyChangeSetProposal[] {
  const parsed = parseJsonResponse<{ proposals?: unknown[] }>(text);
  return parseOntologySynthesisParsed(parsed, features);
}

function parseOntologySynthesisParsed(
  parsed: { proposals?: unknown[] },
  features: OntologySuggestionFeature[],
): OntologyChangeSetProposal[] {
  if (!Array.isArray(parsed.proposals)) {
    throw new Error("Ontology synthesis JSON must include proposals[]");
  }
  const allEvidence = features.flatMap((feature) => feature.evidence);
  return parsed.proposals.map((proposal, index) =>
    normalizeModelProposal(proposal, index, allEvidence),
  );
}

function normalizeModelProposal(
  proposal: unknown,
  index: number,
  allEvidence: OntologyEvidenceInput[],
): OntologyChangeSetProposal {
  if (!proposal || typeof proposal !== "object") {
    throw new Error(`Ontology synthesis proposal ${index} is not an object`);
  }
  const record = proposal as Record<string, unknown>;
  const items = arrayValue(record.items).map((item, itemIndex) =>
    normalizeModelItem(item, itemIndex, allEvidence),
  );
  if (items.length === 0) {
    throw new Error(`Ontology synthesis proposal ${index} has no items`);
  }
  return {
    key: stringValue(record.key) || `model-proposal-${index + 1}`,
    title: stringValue(record.title) || "Ontology suggestion",
    summary: stringValue(record.summary) || "Suggested ontology update.",
    confidence: clampConfidence(numberValue(record.confidence, 0.7)),
    observedFrequency: Math.max(
      1,
      numberValue(record.observedFrequency, items.length),
    ),
    expectedImpact:
      record.expectedImpact && typeof record.expectedImpact === "object"
        ? (record.expectedImpact as Record<string, unknown>)
        : {},
    items,
  };
}

function normalizeModelItem(
  item: unknown,
  index: number,
  allEvidence: OntologyEvidenceInput[],
): OntologySuggestionItemProposal {
  if (!item || typeof item !== "object") {
    throw new Error(`Ontology synthesis item ${index} is not an object`);
  }
  const record = item as Record<string, unknown>;
  const evidenceIndexes = arrayValue(record.evidenceIndexes)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
  const evidence = dedupeEvidence(
    evidenceIndexes
      .map((evidenceIndex) => allEvidence[evidenceIndex])
      .filter(Boolean),
    5,
  );
  if (evidence.length === 0) {
    throw new Error(`Ontology synthesis item ${index} has no evidence`);
  }
  return {
    itemType: ontologyItemType(record.itemType),
    action: ontologyAction(record.action),
    targetKind: stringValue(record.targetKind) || "ontology",
    targetSlug: slugValue(
      record.targetSlug || record.title || `item-${index + 1}`,
    ),
    title: stringValue(record.title) || "Ontology item",
    description: stringValue(record.description) || "Suggested ontology item.",
    proposedValue:
      record.proposedValue && typeof record.proposedValue === "object"
        ? (record.proposedValue as Record<string, unknown>)
        : {},
    confidence: clampConfidence(numberValue(record.confidence, 0.7)),
    evidence,
  };
}

function deterministicProposals(
  features: OntologySuggestionFeature[],
  activeOntology: ActiveOntologySnapshot,
): OntologyChangeSetProposal[] {
  const proposals: OntologyChangeSetProposal[] = [];
  const commitment = features.find(
    (feature) => feature.kind === "customer_commitment",
  );
  if (commitment) {
    const evidence = dedupeEvidence(commitment.evidence, 5);
    const items: OntologySuggestionItemProposal[] = [];
    if (!activeOntology.entityTypeSlugs.has("commitment")) {
      items.push({
        itemType: "entity_type",
        action: "create",
        targetKind: "entity_type",
        targetSlug: "commitment",
        title: "Add Commitment entity type",
        description:
          "Track customer promises, due dates, owners, and follow-up obligations as first-class business memory.",
        proposedValue: {
          slug: "commitment",
          name: "Commitment",
          broadType: "business_event",
          aliases: ["promise", "follow-up obligation", "customer commitment"],
          propertiesSchema: {
            type: "object",
            properties: {
              dueDate: { type: "string", format: "date" },
              owner: { type: "string" },
              status: { type: "string" },
            },
          },
          guidanceNotes:
            "Use for explicit customer-facing obligations with an owner, due date, or follow-up action.",
        },
        confidence: 0.82,
        evidence,
      });
    }
    if (!activeOntology.relationshipTypeSlugs.has("customer_has_commitment")) {
      items.push({
        itemType: "relationship_type",
        action: "create",
        targetKind: "relationship_type",
        targetSlug: "customer_has_commitment",
        title: "Relate customers to commitments",
        description:
          "Connect customer pages to the commitments made on their behalf.",
        proposedValue: {
          slug: "customer_has_commitment",
          name: "Customer has commitment",
          inverseName: "Commitment belongs to customer",
          sourceTypeSlugs: ["customer"],
          targetTypeSlugs: ["commitment"],
          aliases: ["promised", "owed", "follow-up for"],
        },
        confidence: 0.8,
        evidence,
      });
    }
    if (!activeOntology.relationshipTypeSlugs.has("commitment_owned_by")) {
      items.push({
        itemType: "relationship_type",
        action: "create",
        targetKind: "relationship_type",
        targetSlug: "commitment_owned_by",
        title: "Relate commitments to people",
        description:
          "Connect commitments to the person responsible for the follow-up.",
        proposedValue: {
          slug: "commitment_owned_by",
          name: "Commitment owned by",
          inverseName: "Owns commitment",
          sourceTypeSlugs: ["commitment"],
          targetTypeSlugs: ["person"],
          aliases: ["owner", "responsible party"],
        },
        confidence: 0.76,
        evidence,
      });
    }
    if (!activeOntology.facetTemplateSlugs.has("customer:open_commitments")) {
      items.push({
        itemType: "facet_template",
        action: "create",
        targetKind: "facet_template",
        targetSlug: "open_commitments",
        title: "Add customer open commitments facet",
        description:
          "Compile unresolved promises, owners, and due dates onto customer pages.",
        proposedValue: {
          entityTypeSlug: "customer",
          slug: "open_commitments",
          heading: "Open Commitments",
          facetType: "operational",
          sourcePriority: ["hindsight", "brain_section", "external_refs"],
          prompt:
            "Summarize outstanding customer commitments with owner, due date, status, and cited source.",
        },
        confidence: 0.84,
        evidence,
      });
    }
    for (const mapping of standardsMappingsForTypeSlug("commitment")) {
      const key = `${mapping.subjectKind}:${mapping.subjectSlug}:${mapping.vocabulary}:${mapping.externalUri}`;
      if (activeOntology.mappingKeys.has(key)) continue;
      items.push({
        itemType: "external_mapping",
        action: "create",
        targetKind: "external_mapping",
        targetSlug: `${mapping.subjectSlug}:${mapping.vocabulary}`,
        title: "Add commitment interoperability mapping",
        description: mapping.notes,
        proposedValue: { ...mapping },
        confidence: 0.68,
        evidence,
      });
    }
    if (items.length > 0) {
      proposals.push({
        key: "customer-commitment-model",
        title: "Customer commitment model",
        summary:
          "Recurring customer promises and follow-up obligations suggest modeling commitments explicitly.",
        confidence: 0.82,
        observedFrequency: commitment.frequency,
        expectedImpact: {
          facetTemplates: ["customer.open_commitments"],
          entityTypes: ["commitment"],
          relationshipTypes: ["customer_has_commitment", "commitment_owned_by"],
        },
        items,
      });
    }
  }

  const supportCases = features.find(
    (feature) => feature.kind === "support_case_refs",
  );
  if (
    supportCases &&
    !activeOntology.facetTemplateSlugs.has("customer:support_cases")
  ) {
    const evidence = dedupeEvidence(supportCases.evidence, 5);
    proposals.push({
      key: "support-case-facet",
      title: "Support case facets",
      summary:
        "Repeated support-case references suggest customers need a support-case-aware facet.",
      confidence: 0.72,
      observedFrequency: supportCases.frequency,
      expectedImpact: {
        facetTemplates: ["customer.support_cases"],
      },
      items: [
        {
          itemType: "facet_template",
          action: "create",
          targetKind: "facet_template",
          targetSlug: "support_cases",
          title: "Add customer support cases facet",
          description:
            "Expose active/recent support cases as a customer page facet without changing the canonical customer type.",
          proposedValue: {
            entityTypeSlug: "customer",
            slug: "support_cases",
            heading: "Support Cases",
            facetType: "external",
            sourcePriority: ["external_refs", "brain_section"],
            prompt:
              "Summarize recent support cases, current status, customer impact, and next action.",
          },
          confidence: 0.72,
          evidence,
        },
      ],
    });
  }

  return proposals;
}

async function persistOntologyChangeSetProposals(args: {
  tenantId: string;
  jobId: string;
  proposals: OntologyChangeSetProposal[];
  db: DbLike;
}) {
  const createdChangeSetIds: string[] = [];
  const updatedChangeSetIds: string[] = [];
  for (const proposal of args.proposals) {
    const items = proposal.items.filter((item) => item.evidence.length > 0);
    if (items.length === 0) continue;
    const [existing] = await args.db
      .select()
      .from(ontologyChangeSets)
      .where(
        and(
          eq(ontologyChangeSets.tenant_id, args.tenantId),
          eq(ontologyChangeSets.title, proposal.title),
          eq(ontologyChangeSets.proposed_by, "suggestion_engine"),
          inArray(ontologyChangeSets.status, [...OPEN_CHANGE_SET_STATUSES]),
        ),
      )
      .orderBy(desc(ontologyChangeSets.updated_at))
      .limit(1);

    const now = new Date();
    const changeSetId = existing?.id;
    const [changeSet] = changeSetId
      ? await args.db
          .update(ontologyChangeSets)
          .set({
            summary: proposal.summary,
            status: "pending_review",
            confidence: String(proposal.confidence),
            observed_frequency: proposal.observedFrequency,
            expected_impact: proposal.expectedImpact,
            updated_at: now,
          })
          .where(eq(ontologyChangeSets.id, changeSetId))
          .returning()
      : await args.db
          .insert(ontologyChangeSets)
          .values({
            tenant_id: args.tenantId,
            title: proposal.title,
            summary: proposal.summary,
            status: "pending_review",
            confidence: String(proposal.confidence),
            observed_frequency: proposal.observedFrequency,
            expected_impact: proposal.expectedImpact,
            proposed_by: "suggestion_engine",
          })
          .returning();

    if (!changeSet) continue;
    if (existing) updatedChangeSetIds.push(changeSet.id);
    else createdChangeSetIds.push(changeSet.id);

    if (existing) {
      await args.db
        .delete(ontologyEvidenceExamples)
        .where(eq(ontologyEvidenceExamples.change_set_id, changeSet.id));
      await args.db
        .delete(ontologyChangeSetItems)
        .where(eq(ontologyChangeSetItems.change_set_id, changeSet.id));
    }

    for (const [position, item] of items.entries()) {
      const [insertedItem] = await args.db
        .insert(ontologyChangeSetItems)
        .values({
          tenant_id: args.tenantId,
          change_set_id: changeSet.id,
          item_type: item.itemType,
          action: item.action,
          status: "pending_review",
          target_kind: item.targetKind,
          target_slug: item.targetSlug,
          title: item.title,
          description: item.description,
          proposed_value: item.proposedValue,
          confidence: String(item.confidence),
          position,
        })
        .returning({ id: ontologyChangeSetItems.id });
      if (!insertedItem) continue;
      await args.db.insert(ontologyEvidenceExamples).values(
        item.evidence.map((evidence) => ({
          tenant_id: args.tenantId,
          change_set_id: changeSet.id,
          item_id: insertedItem.id,
          source_kind: evidence.sourceKind,
          source_ref: evidence.sourceRef,
          source_label: evidence.sourceLabel,
          quote: evidence.quote,
          observed_at: toDateOrNull(evidence.observedAt),
          metadata: {
            ...(evidence.metadata ?? {}),
            scanJobId: args.jobId,
            proposalKey: proposal.key,
          },
        })),
      );
    }
  }
  return { createdChangeSetIds, updatedChangeSetIds };
}

function activeOntologySnapshot(
  definitions: Awaited<ReturnType<typeof listOntologyDefinitions>>,
): ActiveOntologySnapshot {
  return {
    entityTypeSlugs: new Set(
      definitions.entityTypes.map((type: any) => type.slug),
    ),
    relationshipTypeSlugs: new Set(
      definitions.relationshipTypes.map((type: any) => type.slug),
    ),
    facetTemplateSlugs: new Set([
      ...definitions.facetTemplates.map((template: any) => template.slug),
      ...definitions.entityTypes.flatMap((type: any) =>
        (type.facetTemplates ?? []).map(
          (template: any) => `${type.slug}:${template.slug}`,
        ),
      ),
    ]),
    mappingKeys: new Set(
      definitions.externalMappings.map(
        (mapping: any) =>
          `${mapping.subjectKind}:${mapping.subjectSlug ?? mapping.subjectId}:${mapping.vocabulary}:${mapping.externalUri}`,
      ),
    ),
  };
}

async function updateScanJob(
  db: DbLike,
  jobId: string,
  patch: Record<string, unknown>,
) {
  await db
    .update(ontologySuggestionScanJobs)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(ontologySuggestionScanJobs.id, jobId));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ontologyItemType(
  value: unknown,
): OntologySuggestionItemProposal["itemType"] {
  const itemType = stringValue(value);
  if (
    itemType === "entity_type" ||
    itemType === "relationship_type" ||
    itemType === "facet_template" ||
    itemType === "external_mapping"
  ) {
    return itemType;
  }
  throw new Error(`Unsupported ontology suggestion item type: ${itemType}`);
}

function ontologyAction(
  value: unknown,
): OntologySuggestionItemProposal["action"] {
  const action = stringValue(value);
  if (
    action === "create" ||
    action === "update" ||
    action === "deprecate" ||
    action === "reject"
  ) {
    return action;
  }
  throw new Error(`Unsupported ontology suggestion action: ${action}`);
}

function slugValue(value: unknown): string {
  return (
    stringValue(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "ontology_item"
  );
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export async function reloadOntologySuggestionScanJob(args: {
  tenantId: string;
  jobId: string;
  db?: DbLike;
}) {
  return loadOntologySuggestionScanJob(args);
}
