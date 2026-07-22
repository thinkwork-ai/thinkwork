import { Plus, X } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";

/**
 * Compiler op list, hard-coded web-side (apps/web cannot import
 * packages/api) — keep in lockstep with `TwinPredicateOp` in
 * packages/api/src/lib/twin/query-compiler.ts.
 */
export const TWIN_PREDICATE_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "contains",
] as const;
export type TwinPredicateOpValue = (typeof TWIN_PREDICATE_OPS)[number];

const OP_LABELS: Record<TwinPredicateOpValue, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  exists: "exists",
  contains: "contains",
};

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

export interface ExplorerPredicateRow {
  facet: string;
  attribute: string;
  op: TwinPredicateOpValue;
  /** Raw input text; typed at filter-build time from the declaration. */
  value: string;
}

export interface TypedPredicate {
  facet: string;
  attribute: string;
  op: TwinPredicateOpValue;
  value?: string | number | boolean;
}

/**
 * Coerce one row into the typed predicate the compiler expects (R2): the
 * declaration's filterType decides the JSON type, so a number attribute
 * never leaves as a string.
 */
export function buildTypedPredicate(
  row: ExplorerPredicateRow,
  facets: ExplorerFacet[],
): { ok: true; predicate: TypedPredicate } | { ok: false; error: string } {
  const facet = facets.find((f) => f.slug === row.facet);
  const attribute = facet?.attributes.find(
    (a) => a.attribute === row.attribute,
  );
  if (!facet || !attribute) {
    return { ok: false, error: "Pick a facet and attribute" };
  }
  if (row.op === "exists") {
    return {
      ok: true,
      predicate: { facet: row.facet, attribute: row.attribute, op: "exists" },
    };
  }
  const raw = row.value.trim();
  if (!raw) return { ok: false, error: "Enter a value" };
  if (attribute.filterType === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return { ok: false, error: `"${raw}" is not a number` };
    }
    return {
      ok: true,
      predicate: {
        facet: row.facet,
        attribute: row.attribute,
        op: row.op,
        value,
      },
    };
  }
  if (attribute.filterType === "boolean") {
    if (raw !== "true" && raw !== "false") {
      return { ok: false, error: "Pick true or false" };
    }
    return {
      ok: true,
      predicate: {
        facet: row.facet,
        attribute: row.attribute,
        op: row.op,
        value: raw === "true",
      },
    };
  }
  return {
    ok: true,
    predicate: {
      facet: row.facet,
      attribute: row.attribute,
      op: row.op,
      value: raw,
    },
  };
}

export function emptyPredicateRow(): ExplorerPredicateRow {
  return { facet: "", attribute: "", op: "eq", value: "" };
}

/**
 * Stacked AND-only predicate rows (U4): "+ Add predicate" appends, each row
 * has its own remove control. No OR — matches the compiler's WHERE
 * semantics exactly, so the UI can't express a query the server refuses.
 */
export function PredicateBuilder({
  facets,
  rows,
  onChange,
  idPrefix = "predicate",
}: {
  facets: ExplorerFacet[];
  rows: ExplorerPredicateRow[];
  onChange: (rows: ExplorerPredicateRow[]) => void;
  idPrefix?: string;
}) {
  const update = (index: number, patch: Partial<ExplorerPredicateRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2" data-testid={`${idPrefix}-builder`}>
      {rows.map((row, index) => {
        const facet = facets.find((f) => f.slug === row.facet);
        const attribute = facet?.attributes.find(
          (a) => a.attribute === row.attribute,
        );
        const needsValue = row.op !== "exists";
        return (
          <div
            key={index}
            className="flex flex-wrap items-center gap-2"
            data-testid={`${idPrefix}-row`}
          >
            {index > 0 ? (
              <span className="text-xs uppercase text-muted-foreground">
                and
              </span>
            ) : null}
            <Select
              value={row.facet || undefined}
              onValueChange={(facetSlug) =>
                update(index, { facet: facetSlug, attribute: "", value: "" })
              }
            >
              <SelectTrigger
                className="h-8 w-36 text-xs"
                aria-label="Facet"
                data-testid={`${idPrefix}-facet`}
              >
                <SelectValue placeholder="Facet" />
              </SelectTrigger>
              <SelectContent>
                {facets.map((f) => (
                  <SelectItem key={f.slug} value={f.slug}>
                    {f.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={row.attribute || undefined}
              onValueChange={(attributeName) =>
                update(index, { attribute: attributeName, value: "" })
              }
              disabled={!facet}
            >
              <SelectTrigger
                className="h-8 w-40 text-xs"
                aria-label="Attribute"
                data-testid={`${idPrefix}-attribute`}
              >
                <SelectValue placeholder="Attribute" />
              </SelectTrigger>
              <SelectContent>
                {(facet?.attributes ?? []).map((a) => (
                  <SelectItem key={a.attribute} value={a.attribute}>
                    {a.attribute}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={row.op}
              onValueChange={(op) =>
                update(index, { op: op as TwinPredicateOpValue })
              }
            >
              <SelectTrigger
                className="h-8 w-28 text-xs"
                aria-label="Operator"
                data-testid={`${idPrefix}-op`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TWIN_PREDICATE_OPS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {OP_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsValue ? (
              attribute?.filterType === "boolean" ? (
                <Select
                  value={row.value || undefined}
                  onValueChange={(value) => update(index, { value })}
                >
                  <SelectTrigger
                    className="h-8 w-24 text-xs"
                    aria-label="Value"
                    data-testid={`${idPrefix}-value`}
                  >
                    <SelectValue placeholder="Value" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">true</SelectItem>
                    <SelectItem value="false">false</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8 w-36 text-xs"
                  type={attribute?.filterType === "number" ? "number" : "text"}
                  placeholder="Value"
                  aria-label="Value"
                  data-testid={`${idPrefix}-value`}
                  value={row.value}
                  onChange={(event) =>
                    update(index, { value: event.target.value })
                  }
                />
              )
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Remove predicate"
              data-testid={`${idPrefix}-remove`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        data-testid={`${idPrefix}-add`}
        onClick={() => onChange([...rows, emptyPredicateRow()])}
      >
        <Plus className="size-3.5" /> Add predicate
      </Button>
    </div>
  );
}
