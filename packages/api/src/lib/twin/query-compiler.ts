/**
 * Twin typed query compiler (Company Brain U6 / KTD-5, KTD-6).
 *
 * The ONLY producer of openCypher on the product read path. Takes typed
 * requests — entity get, neighbors (bounded depth), cohort filter, system
 * edges — and emits parameterized openCypher with the tenant closure
 * injected from server-derived context. No caller-supplied query strings
 * exist anywhere in the API; slugs are validated before they touch query
 * text and every VALUE travels as a parameter, so adversarial filter values
 * cannot escape the tenant closure (KTD-7 applies outbound too).
 *
 * Grammar (KTD-5, declared alongside facets in the ontology — U3's
 * attribute `filterType` typing): equality/range/exists/contains predicates
 * over declared facet attributes, plus AT MOST ONE declared relationship
 * path with its own predicate set. Shapes Neptune's openCypher supports —
 * no APOC, no shortestPath, constant-only VLP bounds (depth is a validated
 * literal, never a parameter).
 */

export class TwinCompileError extends Error {}

const SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const MAX_COHORT_LIMIT = 100;
export const MAX_NEIGHBOR_DEPTH = 2;

export type TwinPredicateOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "contains";

export interface TwinPredicate {
  facet: string;
  attribute: string;
  op: TwinPredicateOp;
  value?: string | number | boolean;
}

export interface TwinPath {
  relationship: string;
  targetType: string;
  predicates: TwinPredicate[];
}

export type TwinRequest =
  | { kind: "entity_get"; canonicalId: string }
  | { kind: "neighbors"; canonicalId: string; depth?: number }
  | {
      kind: "cohort";
      entityType: string;
      predicates: TwinPredicate[];
      path?: TwinPath;
      limit?: number;
    }
  | { kind: "system_edges"; canonicalId: string };

export interface CompiledTwinQuery {
  query: string;
  parameters: Record<string, unknown>;
}

function slug(value: string, what: string): string {
  if (typeof value !== "string" || !SLUG_RE.test(value)) {
    throw new TwinCompileError(`invalid ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}

const OPS: Record<TwinPredicateOp, string> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  exists: "IS NOT NULL",
  contains: "CONTAINS",
};

/**
 * Compile one predicate against node alias `alias`. Property names are
 * built from validated slugs (`f_<facet>__<attribute>`); values land in
 * `parameters` under a fresh key — NEVER in the query text.
 */
function compilePredicate(
  alias: string,
  predicate: TwinPredicate,
  parameters: Record<string, unknown>,
): string {
  const facet = slug(predicate.facet, "facet slug");
  const attribute = slug(predicate.attribute, "attribute slug");
  const property = `${alias}.\`f_${facet}__${attribute}\``;
  const op = OPS[predicate.op];
  if (!op) {
    throw new TwinCompileError(`unknown predicate op: ${String(predicate.op)}`);
  }
  if (predicate.op === "exists") {
    return `${property} IS NOT NULL`;
  }
  if (predicate.value === undefined || predicate.value === null) {
    throw new TwinCompileError(`predicate ${predicate.op} requires a value`);
  }
  if (
    typeof predicate.value !== "string" &&
    typeof predicate.value !== "number" &&
    typeof predicate.value !== "boolean"
  ) {
    throw new TwinCompileError("predicate values must be scalars");
  }
  const key = `p${Object.keys(parameters).length}`;
  parameters[key] = predicate.value;
  return `${property} ${op} $${key}`;
}

/** Exclude rows tombstoned at source for every facet a predicate touches. */
function tombstoneGuards(alias: string, predicates: TwinPredicate[]): string[] {
  const facets = [
    ...new Set(predicates.map((p) => slug(p.facet, "facet slug"))),
  ];
  return facets.map(
    (facet) =>
      `(${alias}.\`f_${facet}__state\` IS NULL OR ${alias}.\`f_${facet}__state\` <> 'tombstoned')`,
  );
}

export function compileTwinQuery(
  request: TwinRequest,
  serverContext: { tenantId: string },
): CompiledTwinQuery {
  const tenantId = serverContext.tenantId;
  if (!tenantId) throw new TwinCompileError("tenantId required");
  const parameters: Record<string, unknown> = { tenantId };

  switch (request.kind) {
    case "entity_get": {
      parameters.nodeId = `t#${tenantId}#e#${request.canonicalId}`;
      return {
        query:
          "MATCH (n {`~id`: $nodeId}) WHERE n.tenantId = $tenantId " +
          "OPTIONAL MATCH (n)-[r]->(m) WHERE m.tenantId = $tenantId " +
          "RETURN n AS node, collect({rel: type(r), target: m}) AS edges",
        parameters,
      };
    }
    case "neighbors": {
      const depth = request.depth ?? 1;
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_NEIGHBOR_DEPTH) {
        throw new TwinCompileError(
          `depth must be an integer 1..${MAX_NEIGHBOR_DEPTH}`,
        );
      }
      parameters.nodeId = `t#${tenantId}#e#${request.canonicalId}`;
      return {
        // Depth is a VALIDATED LITERAL (Neptune VLP bounds are constant-only).
        // Edge triples ride along (THINK-327 U3) so graph consumers can draw
        // labeled relationships; additive — node/neighbors keys unchanged.
        query:
          "MATCH (n {`~id`: $nodeId}) WHERE n.tenantId = $tenantId " +
          `MATCH p = (n)-[r*1..${depth}]-(m) WHERE m.tenantId = $tenantId ` +
          "UNWIND relationships(p) AS rel " +
          "RETURN n AS node, collect(DISTINCT m)[0..50] AS neighbors, " +
          "collect(DISTINCT {rel: type(rel), sourceId: id(startNode(rel)), " +
          "targetId: id(endNode(rel))})[0..200] AS edges",
        parameters,
      };
    }
    case "system_edges": {
      parameters.nodeId = `t#${tenantId}#e#${request.canonicalId}`;
      return {
        query:
          "MATCH (n {`~id`: $nodeId}) WHERE n.tenantId = $tenantId " +
          "MATCH (n)-[x:external_identity]->(sys) " +
          "RETURN collect({externalId: x.externalId, namespace: x.namespace, " +
          "systemSlug: sys.systemSlug}) AS systems",
        parameters,
      };
    }
    case "cohort": {
      const label = slug(request.entityType, "entity type slug");
      const limit = Math.min(
        Math.max(1, Math.trunc(request.limit ?? 25)),
        MAX_COHORT_LIMIT,
      );
      const conditions: string[] = ["n.tenantId = $tenantId"];
      for (const predicate of request.predicates) {
        conditions.push(compilePredicate("n", predicate, parameters));
      }
      conditions.push(...tombstoneGuards("n", request.predicates));

      let pathMatch = "";
      let pathReturn = ", [] AS related";
      if (request.path) {
        const rel = slug(request.path.relationship, "relationship slug");
        const target = slug(request.path.targetType, "target type slug");
        const pathConditions: string[] = ["m.tenantId = $tenantId"];
        for (const predicate of request.path.predicates) {
          pathConditions.push(compilePredicate("m", predicate, parameters));
        }
        pathConditions.push(...tombstoneGuards("m", request.path.predicates));
        pathMatch = `MATCH (n)-[:${rel}]->(m:${target}) WHERE ${pathConditions.join(" AND ")} `;
        pathReturn = ", collect(DISTINCT m)[0..25] AS related";
      }

      return {
        // LIMIT is a bounded validated integer literal.
        query:
          `MATCH (n:${label}) WHERE ${conditions.join(" AND ")} ` +
          pathMatch +
          `RETURN n AS node${pathReturn} LIMIT ${limit}`,
        parameters,
      };
    }
    default: {
      const kind = (request as { kind?: unknown }).kind;
      throw new TwinCompileError(`unknown request kind: ${String(kind)}`);
    }
  }
}
