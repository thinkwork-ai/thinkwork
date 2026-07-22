/**
 * Governed facet-declaration parsing for the Twin Explorer (THINK-327 U4).
 * The filter UI itself is the STANDARD DataTableTokenFilter — this module
 * only turns `twinFacets` AWSJSON into the picker model and carries the
 * typed-predicate shape the cohort compiler expects.
 */

export type TwinFilterType = "string" | "number" | "boolean" | "date";

export interface ExplorerFacetAttribute {
  attribute: string;
  filterType: TwinFilterType;
}

export interface ExplorerFacet {
  slug: string;
  attributes: ExplorerFacetAttribute[];
}

/**
 * The typed predicate the cohort compiler expects — keep the op union in
 * lockstep with `TwinPredicateOp` in
 * packages/api/src/lib/twin/query-compiler.ts (apps/web cannot import
 * packages/api).
 */
export interface TypedPredicate {
  facet: string;
  attribute: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "exists" | "contains";
  value?: string | number | boolean;
}

/**
 * Parse an entity type's `twinFacets` AWSJSON into the picker model. Only
 * declared facets/attributes are ever offered (R2) — attribute names come
 * from the governed declaration, so the camelCase footgun can't happen.
 */
export function parseExplorerFacets(raw: unknown): ExplorerFacet[] {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const facets: ExplorerFacet[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { slug, attributes } = entry as Record<string, unknown>;
    if (typeof slug !== "string" || !slug) continue;
    const parsedAttributes: ExplorerFacetAttribute[] = Array.isArray(attributes)
      ? attributes.flatMap((attr) => {
          if (!attr || typeof attr !== "object") return [];
          const a = attr as Record<string, unknown>;
          if (typeof a.attribute !== "string" || !a.attribute) return [];
          const filterType =
            a.filterType === "number" ||
            a.filterType === "boolean" ||
            a.filterType === "date"
              ? a.filterType
              : "string";
          return [{ attribute: a.attribute, filterType }];
        })
      : [];
    if (parsedAttributes.length > 0) {
      facets.push({ slug, attributes: parsedAttributes });
    }
  }
  return facets;
}
