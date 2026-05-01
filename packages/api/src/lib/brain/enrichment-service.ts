import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GraphQLError } from "graphql";
import {
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  and,
  agents,
  db as defaultDb,
  eq,
  messages,
  sql,
  tenants,
  threadTurns,
  threads,
} from "../../graphql/utils.js";
import { tenantEntityPages, wikiPages } from "@thinkwork/database-pg/schema";
import { getContextEngineService } from "../context-engine/service.js";
import { sourceFamilyForProvider } from "../context-engine/source-families.js";
import { synthesizeBrainEnrichmentCandidates } from "./enrichment-candidate-synthesis.js";
import { enqueueEnrichmentDraftCompileJob } from "../wiki/repository.js";
import { invokeWikiCompile } from "../wiki/enqueue.js";
import type { ContextEngineService } from "../context-engine/service.js";
import type {
  ContextEngineCaller,
  ContextHit,
  ContextProviderDescriptor,
  ContextProviderFamily,
  ContextProviderStatus,
  ContextSourceFamily,
} from "../context-engine/types.js";

export type BrainEnrichmentSourceFamily = "BRAIN" | "WEB" | "KNOWLEDGE_BASE";

export interface RunBrainPageEnrichmentInput {
  tenantId: string;
  pageTable: "wiki_pages" | "tenant_entity_pages";
  pageId: string;
  query?: string | null;
  sourceFamilies?: BrainEnrichmentSourceFamily[] | null;
  limit?: number | null;
}

export interface BrainEnrichmentCandidate {
  id: string;
  title: string;
  summary: string;
  sourceFamily: BrainEnrichmentSourceFamily;
  providerId: string;
  score?: number | null;
  citation?: {
    label?: string | null;
    uri?: string | null;
    sourceId?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}

export interface BrainEnrichmentProposal {
  id: string;
  tenantId: string;
  targetPageTable: string;
  targetPageId: string;
  // Null in the QUEUED async-draft response (U6+); populated in the legacy
  // synchronous AWAITING_REVIEW path. The writeback creates these on
  // compile completion.
  threadId: string | null;
  reviewRunId: string | null;
  reviewObjectKey: string | null;
  status: string;
  title: string;
  candidates: BrainEnrichmentCandidate[];
  providerStatuses: ContextProviderStatus[];
  createdAt: string;
  updatedAt: string;
}

type DbLike = typeof defaultDb;

const DEFAULT_SOURCE_FAMILIES: BrainEnrichmentSourceFamily[] = [
  "BRAIN",
  "KNOWLEDGE_BASE",
];

export interface BrainEnrichmentSourceAvailability {
  family: BrainEnrichmentSourceFamily;
  label: string;
  available: boolean;
  selectedByDefault: boolean;
  reason?: string | null;
}

export async function runBrainPageEnrichment(args: {
  input: RunBrainPageEnrichmentInput;
  caller: ContextEngineCaller & { userId: string };
  db?: DbLike;
  contextEngine?: ContextEngineService;
  s3?: S3Client;
}): Promise<BrainEnrichmentProposal> {
  const db = args.db ?? defaultDb;
  const contextEngine = args.contextEngine ?? getContextEngineService();
  const target = await loadTargetPage({
    db,
    input: args.input,
    callerUserId: args.caller.userId,
  });
  const providers = await contextEngine.listProviders({ caller: args.caller });
  const sourceFamilies = args.input.sourceFamilies?.length
    ? normalizeSourceFamilies(args.input.sourceFamilies)
    : defaultSourceFamiliesForProviders(providers);
  const providerIds = selectProviderIdsForSourceFamilies(
    providers,
    sourceFamilies,
  );
  const requestedQuery = args.input.query?.trim();
  const query = requestedQuery || target.title;
  const limit = clampLimit(args.input.limit);
  const result =
    providerIds.length > 0
      ? await contextEngine.query({
          query,
          limit,
          mode: "results",
          scope: "auto",
          depth: "quick",
          providers: { ids: providerIds },
          caller: args.caller,
        })
      : {
          providers: [] as ContextProviderStatus[],
          hits: [] as ContextHit[],
        };
  const providerStatuses = withUnavailableStatuses({
    requested: sourceFamilies,
    providers,
    statuses: result.providers,
  });
  const candidates = buildEnrichmentCandidates({
    hits: result.hits,
    sourceFamilies,
    limit,
  });

  // U6 of plan 2026-05-01-002: enqueue an async draft-compile job instead of
  // creating the synchronous review thread. The compile dedupes candidates
  // against the existing page body and (via U5's writeback) creates the
  // thread + workspace_run + review event when it finishes. Mobile reads
  // status === 'QUEUED' and disengages the synchronous review surface (U7).
  //
  // Candidate synthesis stays in the resolver — the agentic compile receives
  // candidates as input rather than re-running the context engine. This
  // keeps the resolver's wall-time tight while the slow agentic step runs
  // async on the wiki-compile Lambda.
  const { inserted, job } = await enqueueEnrichmentDraftCompileJob(
    {
      tenantId: args.input.tenantId,
      ownerId: args.caller.userId,
      pageId: args.input.pageId,
      input: {
        pageId: args.input.pageId,
        pageTable: args.input.pageTable,
        pageTitle: target.title,
        currentBodyMd: target.bodyMd,
        candidates,
      },
    },
    db,
  );

  // Async-invoke the wiki-compile Lambda so the dedupe bucket gets work
  // immediately. If the invoke fails (function name unresolved in dev,
  // transient AWS error), the job row still exists and any compile worker
  // — scheduler-driven drainer, manual replay — picks it up. Don't fail
  // the resolver; the job is durable.
  if (inserted) {
    invokeWikiCompile(job.id).catch((err) => {
      console.warn(
        `[brain-enrichment] wiki-compile invoke failed for job ${job.id}: ${(err as Error)?.message ?? err}`,
      );
    });
  }

  const now = new Date();
  return {
    id: job.id,
    tenantId: args.input.tenantId,
    targetPageTable: args.input.pageTable,
    targetPageId: args.input.pageId,
    // No thread/run/object yet — the writeback creates them on compile
    // completion. Mobile must read `status` to discriminate.
    threadId: null,
    reviewRunId: null,
    reviewObjectKey: null,
    status: "QUEUED",
    title: `Enrich ${target.title}`,
    candidates,
    providerStatuses,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function listBrainEnrichmentSources(args: {
  tenantId: string;
  caller: ContextEngineCaller;
  contextEngine?: ContextEngineService;
}): Promise<BrainEnrichmentSourceAvailability[]> {
  const contextEngine = args.contextEngine ?? getContextEngineService();
  const providers = await contextEngine.listProviders({
    caller: { ...args.caller, tenantId: args.tenantId },
  });
  return availableSourceFamiliesForProviders(providers).map((family) => ({
    family,
    label: displayNameForSourceFamily(family),
    available: true,
    selectedByDefault:
      DEFAULT_SOURCE_FAMILIES.includes(family) && family !== "WEB",
    reason: null,
  }));
}

async function createReviewThread(args: {
  db: DbLike;
  s3?: S3Client;
  tenantId: string;
  userId: string;
  targetTitle: string;
  targetPageTable: "wiki_pages" | "tenant_entity_pages";
  targetPageId: string;
  query: string;
  sourceFamilies: BrainEnrichmentSourceFamily[];
  candidates: BrainEnrichmentCandidate[];
  providerStatuses: ContextProviderStatus[];
}): Promise<{ threadId: string; runId: string; reviewObjectKey: string }> {
  const bucket = process.env.WORKSPACE_BUCKET || "";
  if (!bucket) {
    throw new GraphQLError("WORKSPACE_BUCKET is not configured", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  const s3 = args.s3 ?? new S3Client({});
  const [tenantInfo] = await args.db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  if (!tenantInfo) throw notFound("Tenant not found");
  const reviewAgent = await resolveReviewAgent({
    db: args.db,
    tenantId: args.tenantId,
    userId: args.userId,
  });
  const reviewId = randomUUID();
  const agentSlug = reviewAgent.slug || reviewAgent.id;
  const reviewObjectKey = `tenants/${tenantInfo.slug}/agents/${agentSlug}/workspace/review/brain-enrichment-${reviewId}.md`;
  const payload = {
    kind: "brain_enrichment_review",
    targetPage: {
      pageTable: args.targetPageTable,
      id: args.targetPageId,
      title: args.targetTitle,
    },
    query: args.query,
    sourceFamilies: args.sourceFamilies,
    candidates: args.candidates,
    providerStatuses: args.providerStatuses,
    proposedChanges: args.candidates.map((candidate) => ({
      path: `${args.targetPageTable}:${args.targetPageId}#${candidate.id}`,
      kind: "brain_enrichment_candidate",
      summary: candidate.summary,
      after: `- **${candidate.title}** — ${candidate.summary}`,
    })),
  };
  const reviewBody = renderReviewMessage({
    targetTitle: args.targetTitle,
    candidates: args.candidates,
    providerStatuses: args.providerStatuses,
  });
  const put = await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: reviewObjectKey,
      Body: reviewBody,
      ContentType: "text/markdown; charset=utf-8",
      Metadata: { "thinkwork-review-kind": "brain_enrichment_review" },
    }),
  );
  const [tenant] = await args.db
    .update(tenants)
    .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
    .where(eq(tenants.id, args.tenantId))
    .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
  if (!tenant) throw notFound("Tenant not found");

  const identifier = `API-${tenant.nextNumber}`;
  const title = `Review Brain enrichment: ${args.targetTitle}`;
  const [thread] = await args.db
    .insert(threads)
    .values({
      tenant_id: args.tenantId,
      agent_id: reviewAgent.id,
      user_id: args.userId,
      number: tenant.nextNumber,
      identifier,
      title,
      status: "todo",
      priority: "medium",
      type: "task",
      channel: "api",
      assignee_type: "user",
      assignee_id: args.userId,
      reporter_id: args.userId,
      labels: ["brain", "enrichment", "review"],
      last_response_preview:
        args.candidates.length > 0
          ? `${args.candidates.length} enrichment suggestions need review.`
          : "No enrichment suggestions were found.",
      metadata: {
        kind: "brain_enrichment_review",
        targetPageTable: args.targetPageTable,
        targetPageId: args.targetPageId,
        candidateCount: args.candidates.length,
        sourceFamilies: args.sourceFamilies,
      },
      created_by_type: "user",
      created_by_id: args.userId,
    })
    .returning({ id: threads.id });
  const now = new Date();

  const [turn] = await args.db
    .insert(threadTurns)
    .values({
      tenant_id: args.tenantId,
      agent_id: reviewAgent.id,
      invocation_source: "brain_enrichment",
      trigger_detail: `brain_enrichment:${reviewId}`,
      thread_id: thread.id,
      status: "running",
      kind: "agent_turn",
      started_at: now,
      last_activity_at: now,
    })
    .returning({ id: threadTurns.id });

  const [run] = await args.db
    .insert(agentWorkspaceRuns)
    .values({
      tenant_id: args.tenantId,
      agent_id: reviewAgent.id,
      target_path: `brain/${args.targetPageTable}/${args.targetPageId}`,
      status: "awaiting_review",
      source_object_key: reviewObjectKey,
      request_object_key: reviewObjectKey,
      current_thread_turn_id: turn.id,
      last_event_at: now,
      updated_at: now,
    })
    .returning({ id: agentWorkspaceRuns.id });

  await args.db.insert(agentWorkspaceEvents).values({
    tenant_id: args.tenantId,
    agent_id: reviewAgent.id,
    run_id: run.id,
    event_type: "review.requested",
    idempotency_key: `brain-enrichment:${run.id}`,
    bucket,
    source_object_key: reviewObjectKey,
    object_etag: put.ETag ?? null,
    sequencer: reviewId,
    reason: "brain_enrichment_review",
    payload,
    actor_type: "user",
    actor_id: args.userId,
  });

  await args.db.insert(messages).values([
    {
      thread_id: thread.id,
      tenant_id: args.tenantId,
      role: "user",
      content: `Enrich the Brain page "${args.targetTitle}" using ${args.sourceFamilies.join(", ")} for query "${args.query}".`,
      sender_type: "user",
      sender_id: args.userId,
      metadata: {
        kind: "brain_enrichment_request",
        targetPageTable: args.targetPageTable,
        targetPageId: args.targetPageId,
      },
    },
    {
      thread_id: thread.id,
      tenant_id: args.tenantId,
      role: "assistant",
      content: renderReviewMessage({
        targetTitle: args.targetTitle,
        candidates: args.candidates,
        providerStatuses: args.providerStatuses,
      }),
      sender_type: "system",
      sender_id: args.userId,
      metadata: {
        kind: "brain_enrichment_suggestions",
        candidateCount: args.candidates.length,
        workspaceRunId: run.id,
      },
    },
  ]);

  return { threadId: thread.id, runId: run.id, reviewObjectKey };
}

function renderReviewMessage(args: {
  targetTitle: string;
  candidates: BrainEnrichmentCandidate[];
  providerStatuses: ContextProviderStatus[];
}): string {
  const lines = [
    `# Enrichment suggestions for ${args.targetTitle}`,
    "",
    "Review these candidate additions. Approving this review will add the selected suggestions to the Brain page.",
    "",
  ];

  if (args.candidates.length === 0) {
    lines.push(
      "No candidate additions were found for the selected sources.",
      "",
    );
  } else {
    for (const candidate of args.candidates) {
      const citation = candidate.citation?.label
        ? ` Source: ${candidate.citation.label}.`
        : "";
      lines.push(`- **${candidate.title}** — ${candidate.summary}${citation}`);
    }
    lines.push("");
  }

  const checked = args.providerStatuses.length;
  const errors = args.providerStatuses.filter((status) =>
    ["error", "timeout"].includes(status.state),
  ).length;
  lines.push(
    `Sources checked: ${checked}${errors ? ` (${errors} with errors)` : ""}.`,
  );
  return lines.join("\n");
}

async function resolveReviewAgent(args: {
  db: DbLike;
  tenantId: string;
  userId: string;
}): Promise<{ id: string; slug: string | null }> {
  const [paired] = await args.db
    .select({ id: agents.id, slug: agents.slug })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, args.tenantId),
        eq(agents.human_pair_id, args.userId),
      ),
    )
    .limit(1);
  if (paired) return paired;

  const [fallback] = await args.db
    .select({ id: agents.id, slug: agents.slug })
    .from(agents)
    .where(eq(agents.tenant_id, args.tenantId))
    .limit(1);
  if (!fallback) {
    throw new GraphQLError("No agent is available to host this review", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  return fallback;
}

export function selectProviderIdsForSourceFamilies(
  providers: ContextProviderDescriptor[],
  sourceFamilies: BrainEnrichmentSourceFamily[],
): string[] {
  const wanted = new Set(
    sourceFamilies.flatMap((family) => sourceFamiliesForGraphqlFamily(family)),
  );
  return providers
    .filter((provider) => wanted.has(sourceFamilyForProvider(provider)))
    .map((provider) => provider.id);
}

export function buildEnrichmentCandidates(args: {
  hits: ContextHit[];
  sourceFamilies: BrainEnrichmentSourceFamily[];
  limit: number;
}): BrainEnrichmentCandidate[] {
  return synthesizeBrainEnrichmentCandidates(args);
}

function withUnavailableStatuses(args: {
  requested: BrainEnrichmentSourceFamily[];
  providers: ContextProviderDescriptor[];
  statuses: ContextProviderStatus[];
}): ContextProviderStatus[] {
  const statuses = [...args.statuses];
  for (const requested of args.requested) {
    const sourceFamilies = sourceFamiliesForGraphqlFamily(requested);
    const available = args.providers.some((provider) =>
      sourceFamilies.includes(sourceFamilyForProvider(provider)),
    );
    const alreadyReported = statuses.some((status) =>
      sourceFamilies.includes(
        status.sourceFamily ?? fallbackStatusFamily(status),
      ),
    );
    if (!available && !alreadyReported) {
      statuses.push({
        providerId: `mobile-${requested.toLowerCase()}-unavailable`,
        family: fallbackProviderFamilyForGraphqlFamily(requested),
        sourceFamily: sourceFamilies[0],
        displayName: displayNameForSourceFamily(requested),
        state: "skipped",
        scope: "auto",
        reason: "No tenant-approved provider is available",
        hitCount: 0,
        durationMs: 0,
        defaultEnabled: false,
      });
    }
  }
  return statuses;
}

function normalizeSourceFamilies(
  input: BrainEnrichmentSourceFamily[] | null | undefined,
): BrainEnrichmentSourceFamily[] {
  const selected = input?.length ? input : DEFAULT_SOURCE_FAMILIES;
  const normalized = selected
    .map((family) => normalizeSourceFamily(family))
    .filter((family): family is BrainEnrichmentSourceFamily => family !== null);
  return [...new Set(normalized)];
}

function normalizeSourceFamily(
  family: string,
): BrainEnrichmentSourceFamily | null {
  const normalized = family.toUpperCase().replace(/[-\s]+/g, "_");
  if (normalized === "BRAIN") return "BRAIN";
  if (normalized === "WEB") return "WEB";
  if (normalized === "KNOWLEDGE_BASE") return "KNOWLEDGE_BASE";
  return null;
}

function defaultSourceFamiliesForProviders(
  providers: ContextProviderDescriptor[],
): BrainEnrichmentSourceFamily[] {
  const available = new Set(availableSourceFamiliesForProviders(providers));
  return DEFAULT_SOURCE_FAMILIES.filter((family) => available.has(family));
}

function availableSourceFamiliesForProviders(
  providers: ContextProviderDescriptor[],
): BrainEnrichmentSourceFamily[] {
  const available = new Set<BrainEnrichmentSourceFamily>();
  for (const provider of providers) {
    const family = graphqlFamilyForSourceFamily(
      sourceFamilyForProvider(provider),
    );
    if (family) available.add(family);
  }
  const ordered: BrainEnrichmentSourceFamily[] = [
    "BRAIN",
    "KNOWLEDGE_BASE",
    "WEB",
  ];
  return ordered.filter((family) => available.has(family));
}

function sourceFamiliesForGraphqlFamily(
  family: BrainEnrichmentSourceFamily,
): ContextSourceFamily[] {
  if (family === "BRAIN") return ["brain", "pages"];
  if (family === "KNOWLEDGE_BASE") return ["knowledge-base"];
  return ["web"];
}

function graphqlFamilyForSourceFamily(
  family: ContextSourceFamily,
): BrainEnrichmentSourceFamily | null {
  if (family === "brain" || family === "pages") return "BRAIN";
  if (family === "knowledge-base") return "KNOWLEDGE_BASE";
  if (family === "web") return "WEB";
  return null;
}

function fallbackStatusFamily(
  status: ContextProviderStatus,
): ContextSourceFamily {
  if (status.family === "memory") return "brain";
  if (status.family === "wiki") return "pages";
  if (status.family === "knowledge-base") return "knowledge-base";
  if (status.family === "workspace") return "workspace";
  return status.family === "mcp" ? "mcp" : "source-agent";
}

function fallbackProviderFamilyForGraphqlFamily(
  family: BrainEnrichmentSourceFamily,
): ContextProviderFamily {
  if (family === "KNOWLEDGE_BASE") return "knowledge-base";
  if (family === "WEB") return "mcp";
  return "memory";
}

function displayNameForSourceFamily(
  family: BrainEnrichmentSourceFamily,
): string {
  if (family === "KNOWLEDGE_BASE") return "Knowledge Base";
  if (family === "WEB") return "Web";
  return "Brain";
}

function clampLimit(limit: number | null | undefined): number {
  if (!Number.isFinite(limit ?? 12)) return 12;
  return Math.max(1, Math.min(20, Math.floor(limit ?? 12)));
}

async function loadTargetPage(args: {
  db: DbLike;
  input: RunBrainPageEnrichmentInput;
  callerUserId: string;
}): Promise<{
  pageTable: "wiki_pages" | "tenant_entity_pages";
  id: string;
  tenantId: string;
  title: string;
  summary: string | null;
  bodyMd: string;
}> {
  if (args.input.pageTable === "tenant_entity_pages") {
    const [page] = await args.db
      .select({
        id: tenantEntityPages.id,
        tenantId: tenantEntityPages.tenant_id,
        title: tenantEntityPages.title,
        summary: tenantEntityPages.summary,
        bodyMd: tenantEntityPages.body_md,
      })
      .from(tenantEntityPages)
      .where(
        and(
          eq(tenantEntityPages.id, args.input.pageId),
          eq(tenantEntityPages.tenant_id, args.input.tenantId),
        ),
      )
      .limit(1);
    if (!page) throw notFound("Brain page not found");
    return {
      pageTable: "tenant_entity_pages",
      ...page,
      bodyMd: page.bodyMd ?? "",
    };
  }

  if (args.input.pageTable === "wiki_pages") {
    const [page] = await args.db
      .select({
        id: wikiPages.id,
        tenantId: wikiPages.tenant_id,
        title: wikiPages.title,
        summary: wikiPages.summary,
        bodyMd: wikiPages.body_md,
      })
      .from(wikiPages)
      .where(
        and(
          eq(wikiPages.id, args.input.pageId),
          eq(wikiPages.tenant_id, args.input.tenantId),
          eq(wikiPages.owner_id, args.callerUserId),
        ),
      )
      .limit(1);
    if (!page) throw notFound("Brain page not found");
    return {
      pageTable: "wiki_pages",
      ...page,
      bodyMd: page.bodyMd ?? "",
    };
  }

  throw new GraphQLError("Unsupported Brain page table", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "NOT_FOUND" },
  });
}
