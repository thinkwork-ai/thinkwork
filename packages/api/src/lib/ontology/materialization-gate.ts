import type { OntologyCompileSnapshot } from "./compile-snapshot.js";
import {
  facetTemplateKey,
  relationshipAllowsEndpoints,
} from "./compile-snapshot.js";
import type {
  PlannedNewPage,
  PlannedPageLink,
  PlannedPageUpdate,
  PlannedPromotion,
  PlannedUnresolvedMention,
  PlannerResult,
} from "../wiki/planner.js";
import type { WikiPageType } from "../wiki/repository.js";

export interface OntologyGateMetrics {
  ontology_gate_approved_pages: number;
  ontology_gate_approved_facets: number;
  ontology_gate_approved_relationships: number;
  ontology_gate_rejected_pages: number;
  ontology_gate_rejected_facets: number;
  ontology_gate_rejected_relationships: number;
  ontology_gate_unresolved_observations: number;
  ontology_gate_suggestion_candidates: number;
}

export interface ApplyOntologyGateArgs {
  plan: PlannerResult;
  snapshot: OntologyCompileSnapshot;
  candidatePageEntityTypes?: Map<string, string>;
}

export interface OntologyGateResult {
  plan: PlannerResult;
  metrics: OntologyGateMetrics;
}

export function applyOntologyMaterializationGate(
  args: ApplyOntologyGateArgs,
): OntologyGateResult {
  validateSnapshot(args.snapshot);

  const metrics = emptyGateMetrics();
  const unresolvedMentions = [...(args.plan.unresolvedMentions ?? [])];
  const entityTypesByPageKey = new Map(args.candidatePageEntityTypes ?? []);

  const pageUpdates = (args.plan.pageUpdates ?? [])
    .map((update) =>
      filterPageUpdate({
        update,
        snapshot: args.snapshot,
        metrics,
      }),
    )
    .filter((update): update is PlannedPageUpdate => update !== null);

  const newPages = (args.plan.newPages ?? [])
    .map((page) =>
      filterNewPage({
        page,
        snapshot: args.snapshot,
        metrics,
        unresolvedMentions,
      }),
    )
    .filter((page): page is PlannedNewPage => {
      if (!page) return false;
      rememberPageEntityType(
        entityTypesByPageKey,
        page.type,
        page.slug,
        page.entityTypeSlug,
      );
      return true;
    });

  const promotions = (args.plan.promotions ?? [])
    .map((promotion) =>
      filterPromotion({
        promotion,
        snapshot: args.snapshot,
        metrics,
        unresolvedMentions,
      }),
    )
    .filter((promotion): promotion is PlannedPromotion => {
      if (!promotion) return false;
      rememberPageEntityType(
        entityTypesByPageKey,
        promotion.type,
        promotion.slug,
        promotion.entityTypeSlug,
      );
      return true;
    });

  const pageLinks = (args.plan.pageLinks ?? []).filter((link) =>
    allowRelationship({
      link,
      snapshot: args.snapshot,
      entityTypesByPageKey,
      metrics,
      unresolvedMentions,
    }),
  );

  return {
    plan: {
      ...args.plan,
      pageUpdates,
      newPages,
      unresolvedMentions,
      promotions,
      pageLinks,
    },
    metrics,
  };
}

export function emptyGateMetrics(): OntologyGateMetrics {
  return {
    ontology_gate_approved_pages: 0,
    ontology_gate_approved_facets: 0,
    ontology_gate_approved_relationships: 0,
    ontology_gate_rejected_pages: 0,
    ontology_gate_rejected_facets: 0,
    ontology_gate_rejected_relationships: 0,
    ontology_gate_unresolved_observations: 0,
    ontology_gate_suggestion_candidates: 0,
  };
}

function filterPageUpdate(args: {
  update: PlannedPageUpdate;
  snapshot: OntologyCompileSnapshot;
  metrics: OntologyGateMetrics;
}): PlannedPageUpdate | null {
  if (!hasStructuredPageSignal(args.update)) return args.update;
  if (!isApprovedEntityType(args.snapshot, args.update.entityTypeSlug)) {
    args.metrics.ontology_gate_rejected_pages += 1;
    args.metrics.ontology_gate_suggestion_candidates += 1;
    return null;
  }

  const sections = args.update.sections.filter((section) => {
    if (!section.facetSlug) return true;
    if (
      isApprovedFacet(args.snapshot, {
        entityTypeSlug: args.update.entityTypeSlug!,
        facetSlug: section.facetSlug,
      })
    ) {
      args.metrics.ontology_gate_approved_facets += 1;
      return true;
    }
    args.metrics.ontology_gate_rejected_facets += 1;
    args.metrics.ontology_gate_suggestion_candidates += 1;
    return false;
  });

  return sections.length > 0 ? { ...args.update, sections } : null;
}

function filterNewPage(args: {
  page: PlannedNewPage;
  snapshot: OntologyCompileSnapshot;
  metrics: OntologyGateMetrics;
  unresolvedMentions: PlannedUnresolvedMention[];
}): PlannedNewPage | null {
  if (!hasStructuredPageSignal(args.page)) return args.page;
  if (!isApprovedEntityType(args.snapshot, args.page.entityTypeSlug)) {
    rejectPageCandidate(args);
    return null;
  }

  const sections = args.page.sections.filter((section) => {
    if (!section.facetSlug) return true;
    if (
      isApprovedFacet(args.snapshot, {
        entityTypeSlug: args.page.entityTypeSlug!,
        facetSlug: section.facetSlug,
      })
    ) {
      args.metrics.ontology_gate_approved_facets += 1;
      return true;
    }
    args.metrics.ontology_gate_rejected_facets += 1;
    args.metrics.ontology_gate_suggestion_candidates += 1;
    return false;
  });
  if (sections.length === 0) {
    rejectPageCandidate(args);
    return null;
  }

  args.metrics.ontology_gate_approved_pages += 1;
  return { ...args.page, sections };
}

function filterPromotion(args: {
  promotion: PlannedPromotion;
  snapshot: OntologyCompileSnapshot;
  metrics: OntologyGateMetrics;
  unresolvedMentions: PlannedUnresolvedMention[];
}): PlannedPromotion | null {
  if (!hasStructuredPageSignal(args.promotion)) return args.promotion;
  if (!isApprovedEntityType(args.snapshot, args.promotion.entityTypeSlug)) {
    args.metrics.ontology_gate_rejected_pages += 1;
    args.metrics.ontology_gate_suggestion_candidates += 1;
    args.unresolvedMentions.push({
      alias: args.promotion.title,
      suggestedType: args.promotion.type,
      entityTypeSlug: args.promotion.entityTypeSlug ?? null,
      context: `Rejected ontology promotion: ${args.promotion.reason}`,
      source_ref:
        firstSectionSourceRef(args.promotion.sections) ?? "ontology-gate",
    });
    args.metrics.ontology_gate_unresolved_observations += 1;
    return null;
  }

  const sections = args.promotion.sections.filter((section) => {
    if (!section.facetSlug) return true;
    if (
      isApprovedFacet(args.snapshot, {
        entityTypeSlug: args.promotion.entityTypeSlug!,
        facetSlug: section.facetSlug,
      })
    ) {
      args.metrics.ontology_gate_approved_facets += 1;
      return true;
    }
    args.metrics.ontology_gate_rejected_facets += 1;
    args.metrics.ontology_gate_suggestion_candidates += 1;
    return false;
  });

  if (sections.length === 0) {
    args.metrics.ontology_gate_rejected_pages += 1;
    args.metrics.ontology_gate_suggestion_candidates += 1;
    return null;
  }

  args.metrics.ontology_gate_approved_pages += 1;
  return { ...args.promotion, sections };
}

function allowRelationship(args: {
  link: PlannedPageLink;
  snapshot: OntologyCompileSnapshot;
  entityTypesByPageKey: Map<string, string>;
  metrics: OntologyGateMetrics;
  unresolvedMentions: PlannedUnresolvedMention[];
}): boolean {
  if (!args.link.relationshipTypeSlug) return true;

  const relationship = args.snapshot.relationshipTypesBySlug.get(
    args.link.relationshipTypeSlug,
  );
  const sourceTypeSlug = args.entityTypesByPageKey.get(
    pageKey(args.link.fromType, args.link.fromSlug),
  );
  const targetTypeSlug = args.entityTypesByPageKey.get(
    pageKey(args.link.toType, args.link.toSlug),
  );

  if (
    relationship &&
    sourceTypeSlug &&
    targetTypeSlug &&
    relationshipAllowsEndpoints(relationship, {
      sourceTypeSlug,
      targetTypeSlug,
    })
  ) {
    args.metrics.ontology_gate_approved_relationships += 1;
    return true;
  }

  args.metrics.ontology_gate_rejected_relationships += 1;
  args.metrics.ontology_gate_suggestion_candidates += 1;
  args.unresolvedMentions.push({
    alias: `${args.link.fromSlug} -> ${args.link.toSlug}`,
    suggestedType: "topic",
    context: `Rejected ontology relationship: ${args.link.relationshipTypeSlug}`,
    source_ref: "ontology-gate",
  });
  args.metrics.ontology_gate_unresolved_observations += 1;
  return false;
}

function rejectPageCandidate(args: {
  page: PlannedNewPage;
  metrics: OntologyGateMetrics;
  unresolvedMentions: PlannedUnresolvedMention[];
}): void {
  args.metrics.ontology_gate_rejected_pages += 1;
  args.metrics.ontology_gate_suggestion_candidates += 1;
  args.unresolvedMentions.push({
    alias: args.page.title,
    suggestedType: args.page.type,
    entityTypeSlug: args.page.entityTypeSlug ?? null,
    context: `Rejected ontology candidate: ${args.page.title}`,
    source_ref: firstPageSourceRef(args.page) ?? "ontology-gate",
  });
  args.metrics.ontology_gate_unresolved_observations += 1;
}

function isApprovedEntityType(
  snapshot: OntologyCompileSnapshot,
  entityTypeSlug: string | null | undefined,
): entityTypeSlug is string {
  return (
    typeof entityTypeSlug === "string" &&
    snapshot.entityTypeSlugs.has(entityTypeSlug)
  );
}

function isApprovedFacet(
  snapshot: OntologyCompileSnapshot,
  args: { entityTypeSlug: string; facetSlug: string },
): boolean {
  return snapshot.facetTemplateKeys.has(
    facetTemplateKey({
      entityTypeSlug: args.entityTypeSlug,
      facetSlug: args.facetSlug,
    }),
  );
}

function hasStructuredPageSignal(
  page: Pick<PlannedNewPage, "entityTypeSlug" | "sections">,
): boolean;
function hasStructuredPageSignal(
  page: Pick<PlannedPromotion, "entityTypeSlug" | "sections">,
): boolean;
function hasStructuredPageSignal(
  page: Pick<PlannedPageUpdate, "entityTypeSlug" | "sections">,
): boolean;
function hasStructuredPageSignal(page: {
  entityTypeSlug?: string | null;
  sections: Array<{ facetSlug?: string | null }>;
}): boolean {
  return Boolean(
    page.entityTypeSlug || page.sections.some((section) => section.facetSlug),
  );
}

function rememberPageEntityType(
  entityTypesByPageKey: Map<string, string>,
  type: WikiPageType,
  slug: string,
  entityTypeSlug: string | null | undefined,
): void {
  if (!entityTypeSlug) return;
  entityTypesByPageKey.set(pageKey(type, slug), entityTypeSlug);
}

function pageKey(type: WikiPageType, slug: string): string {
  return `${type}:${slug}`;
}

function firstPageSourceRef(page: PlannedNewPage): string | null {
  return (page.source_refs ?? [])[0] ?? firstSectionSourceRef(page.sections);
}

function firstSectionSourceRef(
  sections: Array<{ source_refs?: string[] }>,
): string | null {
  for (const section of sections) {
    const sourceRef = section.source_refs?.[0];
    if (sourceRef) return sourceRef;
  }
  return null;
}

function validateSnapshot(snapshot: OntologyCompileSnapshot): void {
  if (snapshot.conservative) return;
  if (!snapshot.activeVersionId) {
    throw new Error(
      "active ontology snapshot is not conservative but has no activeVersionId",
    );
  }
  for (const facet of snapshot.facetTemplatesByKey.values()) {
    if (!snapshot.entityTypeSlugs.has(facet.entityTypeSlug)) {
      throw new Error(
        `active ontology facet ${facet.key} references unknown entity type ${facet.entityTypeSlug}`,
      );
    }
  }
  for (const relationship of snapshot.relationshipTypesBySlug.values()) {
    const unknownSource = relationship.sourceTypeSlugs.find(
      (slug) => slug !== "*" && !snapshot.entityTypeSlugs.has(slug),
    );
    const unknownTarget = relationship.targetTypeSlugs.find(
      (slug) => slug !== "*" && !snapshot.entityTypeSlugs.has(slug),
    );
    if (unknownSource || unknownTarget) {
      throw new Error(
        `active ontology relationship ${relationship.slug} references unknown endpoint type ${unknownSource ?? unknownTarget}`,
      );
    }
  }
}
