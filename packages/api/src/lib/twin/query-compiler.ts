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
      nameContains?: string;
      path?: TwinPath;
      limit?: number;
    }
  | { kind: "system_edges"; canonicalId: string }
  | {
      kind: "subgraph";
      entityType: string;
      limit?: number;
      depth?: number;
    }
  | { kind: "raw"; query: string };

export interface CompiledTwinQuery {
  query: string;
  parameters: Record<string, unknown>;
}

// ── Raw operator console guards (THINK-327 U5 / KTD-5) ─────────────────
//
// The raw kind is the ONE caller-supplied query surface, operator-gated at
// the resolver and executed under a dedicated read-only Neptune grant (the
// IAM segment is the structural fence — this denylist is UX, catching
// mistakes before they burn a round-trip). Guard order: strip comments →
// collapse whitespace → word-boundary denylist → default LIMIT.

export const RAW_QUERY_MAX_LENGTH = 5000;
export const RAW_DEFAULT_LIMIT = 100;

/** Mutating/procedure clauses the console refuses (word-boundary). */
const RAW_DENYLIST_RE =
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|CALL|LOAD)\b/i;

/**
 * Strip openCypher comments (line comments to end-of-line, block comments
 * anywhere) and collapse whitespace, so keywords split by an inline block
 * comment reassemble
 * BEFORE the denylist runs and cannot slip past it.
 */
export function stripCypherComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate raw console text: bounded length, non-empty after stripping,
 * and no write/procedure clause survives comment normalization. Returns
 * the NORMALIZED query (comments stripped) with a default `LIMIT` appended
 * when the query has none — the cost bound on the pooled cluster.
 */
export function prepareRawCypher(text: string): string {
  if (typeof text !== "string" || !text.trim()) {
    throw new TwinCompileError("query text required");
  }
  if (text.length > RAW_QUERY_MAX_LENGTH) {
    throw new TwinCompileError(
      `query exceeds ${RAW_QUERY_MAX_LENGTH} characters`,
    );
  }
  const stripped = stripCypherComments(text);
  if (!stripped) {
    throw new TwinCompileError("query text required");
  }
  const denied = RAW_DENYLIST_RE.exec(stripped);
  if (denied) {
    throw new TwinCompileError(
      `write/procedure clause not allowed: ${denied[1]!.toUpperCase()}`,
    );
  }
  return /\bLIMIT\s+\d+\s*$/i.test(stripped)
    ? stripped
    : `${stripped} LIMIT ${RAW_DEFAULT_LIMIT}`;
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
        // external_identity is FENCED OUT of traversal (THINK-327 review):
        // system nodes are shared hubs — passing through one would pull in
        // every entity in the tenant. System identity renders in the detail
        // page's Systems panel instead; the graph is entity↔entity only.
        // Edge triples carry properties so the UI can show them in the
        // side sheet.
        query:
          "MATCH (n {`~id`: $nodeId}) WHERE n.tenantId = $tenantId " +
          `MATCH p = (n)-[r*1..${depth}]-(m) WHERE m.tenantId = $tenantId ` +
          "AND NONE(rel IN relationships(p) WHERE type(rel) = 'external_identity') " +
          "UNWIND relationships(p) AS rel " +
          "RETURN n AS node, collect(DISTINCT m)[0..50] AS neighbors, " +
          "collect(DISTINCT {rel: type(rel), sourceId: id(startNode(rel)), " +
          "targetId: id(endNode(rel)), props: properties(rel)})[0..200] AS edges",
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
      if (request.nameContains !== undefined) {
        if (
          typeof request.nameContains !== "string" ||
          request.nameContains.length < 1 ||
          request.nameContains.length > 100
        ) {
          throw new TwinCompileError(
            "nameContains must be a string of 1..100 characters",
          );
        }
        const key = `p${Object.keys(parameters).length}`;
        parameters[key] = request.nameContains;
        conditions.push(`toLower(n.displayName) CONTAINS toLower($${key})`);
      }
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
    case "subgraph": {
      // Type-level overview graph (THINK-327 Explorer graph view): a
      // bounded sample of the type's instances plus their neighborhoods.
      // All bounds are validated literals; caps keep the pooled cluster
      // safe (roots<=25, depth<=2, neighbors/edges collect-capped).
      const label = slug(request.entityType, "entity type slug");
      const limit = Math.min(Math.max(1, Math.trunc(request.limit ?? 25)), 25);
      const depth = request.depth ?? 2;
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_NEIGHBOR_DEPTH) {
        throw new TwinCompileError(
          `depth must be an integer 1..${MAX_NEIGHBOR_DEPTH}`,
        );
      }
      return {
        // OPTIONAL MATCH: roots with no entity relationships still render
        // (isolated nodes), and external_identity is fenced out of
        // traversal — the graph is entity↔entity only (system identity
        // lives in the detail page's Systems panel).
        query:
          `MATCH (n:${label}) WHERE n.tenantId = $tenantId ` +
          `WITH n LIMIT ${limit} ` +
          `OPTIONAL MATCH p = (n)-[r*1..${depth}]-(m) ` +
          "WHERE m.tenantId = $tenantId " +
          "AND NONE(rel IN relationships(p) WHERE type(rel) = 'external_identity') " +
          `RETURN collect(DISTINCT n)[0..${limit}] AS roots, ` +
          "collect(DISTINCT m)[0..150] AS neighbors, " +
          "collect(DISTINCT p)[0..300] AS paths",
        parameters,
      };
    }
    case "raw": {
      // Operator console passthrough (THINK-327 U5): guarded text, with the
      // server-derived tenant id as the ONLY bound parameter — operators
      // self-scope with `$tenantId`; a client-supplied binding never exists.
      return { query: prepareRawCypher(request.query), parameters };
    }
    default: {
      const kind = (request as { kind?: unknown }).kind;
      throw new TwinCompileError(`unknown request kind: ${String(kind)}`);
    }
  }
}
