/**
 * Entity-page projection (Company Brain U8 / KTD-8 — R10, R11, R14, F4).
 *
 * Renders an entity's page as its operator-declared sections, each
 * resolving INDEPENDENTLY (Promise.allSettled + per-section timeout — the
 * search broker's per-leg pattern) to OK / STALE / TIMEOUT / ERROR with
 * age. One failed source never blanks a page.
 *
 *   facet_backed  cloned twin values + the R15 freshness stamps (age shown)
 *   live_routed   fetched on view through the per-connector registry;
 *                 VPC-egress-only systems render facet-backed/STALE
 *   knowledge     the conversation-derived soft layer (compiled wiki body),
 *                 joined by canonical id — visibly distinct provenance
 *
 * Sections render only within their declared visibility scope (R14):
 * operators_only sections are absent — not redacted — for member viewers.
 */

import { and, eq } from "drizzle-orm";
import { ontologyEntityTypes, wikiPages } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import type { PageSectionDeclaration } from "../ontology/twin-declarations.js";
import { resolveFacetFreshness } from "./freshness.js";
import { executeTwinQuery, type TwinQueryResult } from "./client.js";
import { fetchLive } from "./live-fetch-registry.js";
import { resolveTwinPageGate, type TwinPageGate } from "./dual-read-gate.js";

type DbLike = typeof defaultDb;

const SECTION_TIMEOUT_MS = 5_000;

export type TwinSectionState = "OK" | "STALE" | "TIMEOUT" | "ERROR";

export interface ProjectedSection {
  slug: string;
  heading: string;
  kind: PageSectionDeclaration["kind"];
  visibility: PageSectionDeclaration["visibility"];
  state: TwinSectionState;
  /** Cache age of the backing facet, when facet-backed. */
  ageSeconds: number | null;
  /** Soft-layer sections flag their provenance (R11). */
  provenance: "source_backed" | "live" | "knowledge";
  data: Record<string, unknown> | null;
  detail: string | null;
}

export interface ProjectedEntityPage {
  projected: true;
  canonicalId: string;
  entityTypeSlug: string;
  sections: ProjectedSection[];
}

export interface CompiledFallback {
  projected: false;
  reason: TwinPageGate["reason"];
}

export type EntityPageProjection = ProjectedEntityPage | CompiledFallback;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("section_timeout")), ms).unref?.(),
    ),
  ]) as Promise<T>;
}

async function resolveFacetSection(args: {
  section: PageSectionDeclaration;
  tenantId: string;
  canonicalId: string;
  facets: unknown;
  nodeProperties: Record<string, unknown>;
  now?: Date;
}): Promise<Partial<ProjectedSection>> {
  const freshness = resolveFacetFreshness({
    facets: args.facets,
    nodeProperties: args.nodeProperties,
    now: args.now,
  }).find((facet) => facet.facet === args.section.facetSlug);
  if (!freshness) {
    return { state: "ERROR", detail: "facet_not_declared", data: null };
  }
  const state: TwinSectionState =
    freshness.state === "synced" || freshness.state === "synced_empty"
      ? "OK"
      : "STALE";
  return {
    state,
    ageSeconds: freshness.ageSeconds,
    data: {
      facetState: freshness.state,
      values: freshness.values,
      syncedAt: freshness.syncedAt,
      batchId: freshness.batchId,
    },
    detail: freshness.state,
  };
}

async function resolveLiveSection(args: {
  section: PageSectionDeclaration;
  tenantId: string;
  canonicalId: string;
  viewerUserId?: string;
  systems: Array<{ systemSlug?: string; externalId?: string }>;
}): Promise<Partial<ProjectedSection>> {
  const edge = args.systems.find(
    (system) => system.systemSlug === args.section.sourceSystem,
  );
  if (!edge?.externalId) {
    return { state: "STALE", detail: "no_system_edge", data: null };
  }
  const result = await fetchLive({
    tenantId: args.tenantId,
    systemSlug: args.section.sourceSystem ?? "",
    externalId: edge.externalId,
    viewerUserId: args.viewerUserId,
  });
  if (result.state === "OK") {
    return {
      state: "OK",
      provenance: "live",
      data: { record: result.data, fetchedAt: result.fetchedAt },
      detail: "live",
    };
  }
  if (result.state === "STALE") {
    // Not live-routable (e.g. lastmile, VPC-egress-only): facet-backed
    // rendering is the caller's fallback — surface the reason.
    return { state: "STALE", detail: result.reason, data: null };
  }
  return { state: "ERROR", detail: result.reason, data: null };
}

async function resolveKnowledgeSection(args: {
  tenantId: string;
  canonicalId: string;
  db: DbLike;
}): Promise<Partial<ProjectedSection>> {
  const [page] = await args.db
    .select({
      title: wikiPages.title,
      summary: wikiPages.summary,
      body_md: wikiPages.body_md,
    })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, args.tenantId),
        eq(wikiPages.canonical_entity_id, args.canonicalId),
      ),
    )
    .limit(1);
  if (!page) {
    return { state: "OK", data: { empty: true }, detail: "no_knowledge_yet" };
  }
  return {
    state: "OK",
    data: {
      title: page.title,
      summary: page.summary,
      bodyMd: page.body_md,
    },
    detail: "distilled_memories",
  };
}

/**
 * Project one entity's page. Returns the compiled-fallback marker when the
 * tenant/type hasn't flipped (AE8) — the caller renders the existing
 * compiled page unchanged.
 */
export async function projectEntityPage(args: {
  tenantId: string;
  entityTypeSlug: string;
  canonicalId: string;
  viewerIsOperator: boolean;
  viewerUserId?: string;
  facets?: unknown;
  db?: DbLike;
  now?: Date;
  gate?: TwinPageGate;
  twinQuery?: typeof executeTwinQuery;
}): Promise<EntityPageProjection> {
  const db = args.db ?? defaultDb;
  const gate =
    args.gate ??
    (await resolveTwinPageGate({
      tenantId: args.tenantId,
      entityTypeSlug: args.entityTypeSlug,
      db,
    }));
  if (!gate.projected) {
    return { projected: false, reason: gate.reason };
  }

  const visible = gate.sections.filter(
    (section) =>
      section.visibility !== "operators_only" || args.viewerIsOperator,
  );

  // The facet declarations back every facet_backed section's freshness
  // read. Callers may inject them (tests); the GraphQL resolver does not,
  // so load the type row's declarations here — leaving this to the `?? []`
  // default made EVERY live facet section resolve ERROR
  // "facet_not_declared" (dev AE2, 2026-07-22).
  let facets = args.facets;
  if (facets === undefined) {
    const [typeRow] = await db
      .select({ twin_facets: ontologyEntityTypes.twin_facets })
      .from(ontologyEntityTypes)
      .where(
        and(
          eq(ontologyEntityTypes.tenant_id, args.tenantId),
          eq(ontologyEntityTypes.slug, args.entityTypeSlug),
        ),
      )
      .limit(1);
    facets = typeRow?.twin_facets ?? [];
  }

  const twinQuery = args.twinQuery ?? executeTwinQuery;
  // One entity read + one system-edge read shared across sections.
  const [entityResult, systemsResult] = await Promise.all([
    twinQuery({
      tenantId: args.tenantId,
      request: { kind: "entity_get", canonicalId: args.canonicalId },
    }),
    twinQuery({
      tenantId: args.tenantId,
      request: { kind: "system_edges", canonicalId: args.canonicalId },
    }),
  ]);
  const nodeProperties = extractNodeProperties(entityResult);
  const systems = extractSystems(systemsResult);

  const settled = await Promise.allSettled(
    visible.map((section) =>
      withTimeout(
        (async (): Promise<Partial<ProjectedSection>> => {
          if (section.kind === "facet_backed") {
            return resolveFacetSection({
              section,
              tenantId: args.tenantId,
              canonicalId: args.canonicalId,
              facets,
              nodeProperties,
              now: args.now,
            });
          }
          if (section.kind === "live_routed") {
            return resolveLiveSection({
              section,
              tenantId: args.tenantId,
              canonicalId: args.canonicalId,
              viewerUserId: args.viewerUserId,
              systems,
            });
          }
          return resolveKnowledgeSection({
            tenantId: args.tenantId,
            canonicalId: args.canonicalId,
            db,
          });
        })(),
        SECTION_TIMEOUT_MS,
      ),
    ),
  );

  const sections: ProjectedSection[] = visible.map((section, index) => {
    const base: ProjectedSection = {
      slug: section.slug,
      heading: section.heading,
      kind: section.kind,
      visibility: section.visibility,
      state: "ERROR",
      ageSeconds: null,
      provenance:
        section.kind === "knowledge"
          ? "knowledge"
          : section.kind === "live_routed"
            ? "live"
            : "source_backed",
      data: null,
      detail: null,
    };
    const outcome = settled[index];
    if (outcome.status === "fulfilled") {
      return { ...base, ...outcome.value };
    }
    const message =
      outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
    return {
      ...base,
      state: message === "section_timeout" ? "TIMEOUT" : "ERROR",
      detail: message,
    };
  });

  return {
    projected: true,
    canonicalId: args.canonicalId,
    entityTypeSlug: args.entityTypeSlug,
    sections,
  };
}

function extractNodeProperties(
  result: TwinQueryResult,
): Record<string, unknown> {
  if (!result.ok) return {};
  const node = result.results[0]?.node;
  if (!node || typeof node !== "object") return {};
  const record = node as Record<string, unknown>;
  // neptunedata returns nodes as {~id, ~labels, ~properties}; tests and
  // future transports may hand flat property maps — accept both.
  const properties = record["~properties"];
  return properties && typeof properties === "object"
    ? (properties as Record<string, unknown>)
    : record;
}

function extractSystems(
  result: TwinQueryResult,
): Array<{ systemSlug?: string; externalId?: string }> {
  if (!result.ok) return [];
  const systems = result.results[0]?.systems;
  return Array.isArray(systems)
    ? (systems as Array<{ systemSlug?: string; externalId?: string }>)
    : [];
}
