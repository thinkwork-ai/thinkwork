import { describe, expect, it } from "vitest";
import {
  guardTwinCypher,
  type GuardOptions,
  type GuardResult,
} from "./cypher-guard.js";

const TENANT = "tenant-1";

function guard(query: string, extra?: Partial<Omit<GuardOptions, "tenantId">>) {
  return guardTwinCypher(query, { tenantId: TENANT, ...extra });
}

function ok(result: GuardResult) {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.rule}: ${result.message}`);
  }
  return result;
}

function rejected(result: GuardResult) {
  if (result.ok) throw new Error(`expected rejection, got ok: ${result.query}`);
  return result;
}

/** Count occurrences of the injected tenant fence in guarded text. */
function fenceCount(query: string) {
  return (query.match(/tenantId: \$tenantId/g) ?? []).length;
}

describe("guardTwinCypher — happy path fencing", () => {
  it("simple MATCH gains the tenant predicate on every node pattern and a default LIMIT", () => {
    const r = ok(guard("MATCH (c:customer) RETURN c.displayName"));
    expect(fenceCount(r.query)).toBe(1);
    expect(r.query).toMatch(/LIMIT 100\s*$/);
    expect(r.parameters.tenantId).toBe(TENANT);
    expect(r.limited).toBe(false);
  });

  it("multi-hop pattern fences every node pattern including anonymous ones", () => {
    const r = ok(
      guard(
        "MATCH (c:customer)-[:has_invoice]->(i:invoice), ()-[:owns]->() RETURN c, i",
      ),
    );
    expect(fenceCount(r.query)).toBe(4);
  });

  it("existing WHERE clauses and caller parameters are preserved", () => {
    const r = ok(
      guard(
        "MATCH (i:invoice) WHERE i.f_aging__days_past_due > $days RETURN i LIMIT 20",
        { parameters: { days: 60 } },
      ),
    );
    expect(r.query).toContain("i.f_aging__days_past_due > $days");
    expect(r.query).toContain("LIMIT 20");
    expect(r.parameters).toEqual({ days: 60, tenantId: TENANT });
  });

  it("OPTIONAL MATCH, WITH aggregation, ORDER BY / SKIP / LIMIT all pass fenced", () => {
    const r = ok(
      guard(
        "MATCH (c:customer) OPTIONAL MATCH (c)-[:located_at]->(s:site) " +
          "WITH c, count(s) AS sites WHERE sites > 0 " +
          "RETURN c.displayName AS name, sites ORDER BY sites DESC SKIP 5 LIMIT 20",
      ),
    );
    expect(fenceCount(r.query)).toBe(3);
    expect(r.query).toContain("ORDER BY sites DESC SKIP 5 LIMIT 20");
  });

  it("bounded variable-length paths pass and fence their endpoint patterns", () => {
    const r = ok(guard("MATCH (c:customer)-[:owns*1..3]->(t:tank) RETURN c, t"));
    expect(r.query).toContain("*1..3");
    expect(fenceCount(r.query)).toBe(2);
  });

  it("the canonical cross-system query shape guards clean", () => {
    const r = ok(
      guard(
        "MATCH (c:customer)-[:has_invoice]->(i:invoice) " +
          "WHERE i.f_aging__days_past_due > 60 " +
          "MATCH (c)-[:ships_to]->(:site)-[:has_tank]->(:tank)-[:monitored_by]->(:tank_monitor) " +
          "RETURN DISTINCT c.displayName, c.`~id` LIMIT 50",
      ),
    );
    expect(fenceCount(r.query)).toBe(6);
    expect(r.limited).toBe(false);
  });

  it("expression surface: CASE, coalesce, list comprehension, map projection, UNWIND, path functions", () => {
    const r = ok(
      guard(
        "MATCH p = (c:customer)-[:owns]->(t:tank) " +
          "UNWIND t.readings AS reading " +
          "RETURN CASE WHEN reading > 1 THEN 'high' ELSE 'low' END AS bucket, " +
          "coalesce(c.name, 'unknown'), [x IN t.list WHERE x > 1 | x * 2], " +
          "c{.*, tanks: length(p)}, nodes(p)",
      ),
    );
    expect(fenceCount(r.query)).toBe(2);
  });
});

describe("guardTwinCypher — fence positions beyond MATCH (KTD-2)", () => {
  it("node patterns inside EXISTS subqueries are fenced", () => {
    const r = ok(
      guard(
        "MATCH (c:customer) WHERE EXISTS { MATCH (c)-[:owns]->(:tank)-[:monitored_by]->(:monitor) } RETURN c",
      ),
    );
    expect(fenceCount(r.query)).toBe(4);
  });

  it("node patterns inside COUNT subqueries are fenced", () => {
    const r = ok(
      guard("MATCH (c:customer) WHERE COUNT { (c)-[:has_invoice]->(:invoice) } > 3 RETURN c"),
    );
    expect(fenceCount(r.query)).toBe(3);
  });

  it("node patterns in pattern comprehensions are fenced", () => {
    const r = ok(
      guard("MATCH (c:customer) RETURN size([(c)-[:owns]->(t:tank) | t]) AS tanks"),
    );
    expect(fenceCount(r.query)).toBe(3);
  });

  it("node patterns in WHERE pattern predicates are fenced", () => {
    const r = ok(guard("MATCH (c:customer) WHERE (c)-[:owns]->(:tank) RETURN c"));
    expect(fenceCount(r.query)).toBe(3);
  });

  it("every UNION arm is fenced and clamped independently", () => {
    const r = ok(
      guard("MATCH (a:customer) RETURN a.name AS n UNION MATCH (b:site) RETURN b.name AS n"),
    );
    expect(fenceCount(r.query)).toBe(2);
    expect(r.query.match(/LIMIT 100/g)?.length).toBe(2);
  });
});

describe("guardTwinCypher — property-map merging", () => {
  it("node patterns with an existing property map get the tenant key merged, not duplicated", () => {
    const r = ok(guard("MATCH (c:customer {f_profile__code: 'C1'}) RETURN c"));
    expect(fenceCount(r.query)).toBe(1);
    expect(r.query).toContain("f_profile__code: 'C1'");
    expect(r.query).not.toMatch(/\{[^}]*\{/); // no nested map from a bad splice
  });

  it("a caller-supplied tenantId property key is overridden with the server value", () => {
    const r = ok(guard("MATCH (c:customer {tenantId: 'other-tenant'}) RETURN c"));
    expect(fenceCount(r.query)).toBe(1);
    expect(r.query).not.toContain("'other-tenant'");
  });

  it("a backtick-escaped tenantId key cannot smuggle a foreign value", () => {
    const r = ok(guard("MATCH (c:customer {`tenantId`: 'other-tenant'}) RETURN c"));
    expect(r.query).not.toContain("'other-tenant'");
    expect(r.query).toContain("$tenantId");
  });

  it("a node pattern with an inner WHERE still gets the fence", () => {
    const r = ok(guard("MATCH (c:customer WHERE c.f_profile__active) RETURN c"));
    expect(fenceCount(r.query)).toBe(1);
  });

  it("parameter property maps are rejected — they cannot be fenced statically", () => {
    const r = rejected(guard("MATCH (c:customer $props) RETURN c", { parameters: { props: {} } }));
    expect(r.rule).toBe("unsupported_construct");
  });
});

describe("guardTwinCypher — mutation and procedure rejection (AE3)", () => {
  const mutations: Array<[string, string]> = [
    ["CREATE (n:thing) RETURN n", "CREATE"],
    ["MATCH (n) CREATE (n)-[:x]->(:y) RETURN n", "CREATE"],
    ["MERGE (n:thing {a: 1}) RETURN n", "MERGE"],
    ["MATCH (n) SET n.x = 1 RETURN n", "SET"],
    ["MATCH (n) DELETE n", "DELETE"],
    ["MATCH (n) DETACH DELETE n", "DETACH DELETE"],
    ["MATCH (n) REMOVE n.x RETURN n", "REMOVE"],
    ["MATCH (n) FOREACH (x IN n.list | SET n.y = x)", "FOREACH"],
  ];
  for (const [query, label] of mutations) {
    it(`rejects ${label} with mutation_clause`, () => {
      const r = rejected(guard(query));
      expect(r.rule).toBe("mutation_clause");
      expect(r.message.length).toBeGreaterThan(10);
    });
  }

  it("rejects CALL procedures with procedure_call", () => {
    const r = rejected(guard("CALL db.labels() YIELD label RETURN label"));
    expect(r.rule).toBe("procedure_call");
  });

  it("rejects CALL {} subqueries with procedure_call", () => {
    const r = rejected(
      guard("MATCH (c:customer) CALL { WITH c MATCH (c)-[:owns]->(t) RETURN t } RETURN t"),
    );
    expect(r.rule).toBe("procedure_call");
  });

  it("rejects LOAD CSV and USING hints as unsupported constructs", () => {
    expect(
      rejected(guard("LOAD CSV FROM 'file:///x.csv' AS row RETURN row")).rule,
    ).toBe("unsupported_construct");
    expect(
      rejected(guard("MATCH (n:customer) USING INDEX n:customer(name) WHERE n.name = 'x' RETURN n")).rule,
    ).toBe("unsupported_construct");
  });

  it("rejects admin/schema commands as unsupported constructs", () => {
    for (const q of ["SHOW DATABASES", "CREATE INDEX FOR (n:x) ON (n.y)", "USE other MATCH (n) RETURN n"]) {
      const r = rejected(guard(q));
      expect(["unsupported_construct", "mutation_clause", "parse_error"]).toContain(r.rule);
    }
  });
});

describe("guardTwinCypher — adversarial shapes", () => {
  it("write keywords inside string literals are NOT rejected (AST guard, not a blocklist)", () => {
    const r = ok(
      guard("MATCH (n:customer) WHERE n.memo = 'please DELETE me and MERGE later' RETURN n"),
    );
    expect(r.query).toContain("'please DELETE me and MERGE later'");
  });

  it("write keywords inside comments do not poison an otherwise-clean query", () => {
    const r = ok(guard("MATCH (n:customer) /* CREATE SET DELETE */ RETURN n // DETACH DELETE"));
    expect(fenceCount(r.query)).toBe(1);
  });

  it("a mutation hidden after a line comment IS rejected", () => {
    const r = rejected(guard("MATCH (n) // just reading\nDETACH DELETE n"));
    expect(r.rule).toBe("mutation_clause");
  });

  it("multi-statement input is rejected", () => {
    const r = rejected(guard("MATCH (n) RETURN n; MATCH (m) DELETE m"));
    expect(r.rule).toBe("multi_statement");
  });

  it("a WHERE clause naming another tenant's id still gets the fence injected", () => {
    const r = ok(
      guard("MATCH (n:customer) WHERE n.tenantId = 'other-tenant' RETURN n"),
    );
    // The caller's predicate survives but the injected fence ANDs it down to nothing.
    expect(fenceCount(r.query)).toBe(1);
  });

  it("unicode/exotic obfuscation fails closed", () => {
    for (const q of ["MATCH (n) RЕTURN n", "MATCH (n)  DELETE n", " MATCH (n) RETURN n"]) {
      const r = guard(q);
      if (!r.ok) expect(["parse_error", "mutation_clause", "unsupported_construct"]).toContain(r.rule);
      else expect(fenceCount(r.query)).toBeGreaterThan(0);
    }
  });
});

describe("guardTwinCypher — reserved parameters", () => {
  it("a query referencing $tenantId is rejected", () => {
    const r = rejected(guard("MATCH (n:customer) WHERE n.x = $tenantId RETURN n"));
    expect(r.rule).toBe("reserved_parameter");
  });

  it("a caller parameter map containing tenantId is rejected", () => {
    const r = rejected(
      guard("MATCH (n:customer) RETURN n", { parameters: { tenantId: "other" } }),
    );
    expect(r.rule).toBe("reserved_parameter");
  });
});

describe("guardTwinCypher — clamps (AE4)", () => {
  it("LIMIT above the cap is rewritten down with limited: true", () => {
    const r = ok(guard("MATCH (n:customer) RETURN n LIMIT 10000"));
    expect(r.query).toContain("LIMIT 500");
    expect(r.query).not.toContain("10000");
    expect(r.limited).toBe(true);
  });

  it("LIMIT at or under the cap passes untouched", () => {
    const r = ok(guard("MATCH (n:customer) RETURN n LIMIT 500"));
    expect(r.query).toContain("LIMIT 500");
    expect(r.limited).toBe(false);
  });

  it("a non-literal LIMIT expression is rejected with limit_exceeded", () => {
    const r = rejected(guard("MATCH (n:customer) RETURN n LIMIT $n", { parameters: { n: 5 } }));
    expect(r.rule).toBe("limit_exceeded");
  });

  it("an intermediate WITH ... LIMIT is left alone; the final RETURN is still clamped", () => {
    const r = ok(
      guard("MATCH (n:customer) WITH n LIMIT 50 MATCH (n)-[:owns]->(t) RETURN t"),
    );
    expect(r.query).toContain("WITH n LIMIT 50");
    expect(r.query).toMatch(/RETURN t LIMIT 100\s*$/);
  });
});

describe("guardTwinCypher — variable-length bounds (KTD-6)", () => {
  const unbounded = [
    "MATCH (a)-[:r*]->(b) RETURN a",
    "MATCH (a)-[:r*2..]->(b) RETURN a",
    "MATCH (a)-[:r*..9]->(b) RETURN a",
    "MATCH (a)-[:r*1..6]->(b) RETURN a",
    "MATCH (a)-[:r*7]->(b) RETURN a",
  ];
  for (const q of unbounded) {
    it(`rejects ${q.slice(6, 22)}… with unbounded_var_length`, () => {
      expect(rejected(guard(q)).rule).toBe("unbounded_var_length");
    });
  }

  it("accepts explicit bounds within the hop cap", () => {
    for (const q of [
      "MATCH (a)-[:r*1..5]->(b) RETURN a",
      "MATCH (a)-[:r*3]->(b) RETURN a",
      "MATCH (a)-[:r*..4]->(b) RETURN a",
    ]) {
      ok(guard(q));
    }
  });
});

describe("guardTwinCypher — parse failures fail closed", () => {
  for (const q of ["", "   ", "MATCH (n RETURN n", "complete garbage ~~ ???", "RETURN"]) {
    it(`rejects ${JSON.stringify(q.slice(0, 20))} with parse_error`, () => {
      expect(rejected(guard(q)).rule).toBe("parse_error");
    });
  }

  it("missing tenantId is an invalid request", () => {
    const r = guardTwinCypher("MATCH (n) RETURN n", { tenantId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("invalid_request");
  });
});

describe("guardTwinCypher — aclPredicates seam (R10)", () => {
  it("acl predicates are applied to every node pattern alongside the tenant fence", () => {
    const r = ok(
      guard("MATCH (c:customer)-[:owns]->(t:tank) RETURN c, t", {
        aclPredicates: [{ property: "aclGroup", parameter: "aclGroup", value: "field-ops" }],
      }),
    );
    expect((r.query.match(/aclGroup: \$aclGroup/g) ?? []).length).toBe(2);
    expect(r.parameters.aclGroup).toBe("field-ops");
  });

  it("acl parameter names are reserved too", () => {
    const r = rejected(
      guard("MATCH (n) WHERE n.x = $aclGroup RETURN n", {
        aclPredicates: [{ property: "aclGroup", parameter: "aclGroup", value: "x" }],
      }),
    );
    expect(r.rule).toBe("reserved_parameter");
  });
});

describe("guardTwinCypher — guarded output executes conceptually", () => {
  it("guarded text remains parseable (round-trip through the guard)", () => {
    const first = ok(
      guard(
        "MATCH (c:customer {f_profile__code: 'C1'})-[:owns*1..2]->(t:tank) " +
          "WHERE EXISTS { MATCH (t)-[:monitored_by]->(:monitor) } RETURN c, t",
      ),
    );
    // Re-guarding the guarded output must at minimum re-parse cleanly; the
    // reserved-parameter rule will fire (it now contains $tenantId), which
    // itself proves the output parsed.
    const second = guardTwinCypher(first.query, { tenantId: TENANT });
    if (!second.ok) expect(second.rule).toBe("reserved_parameter");
  });
});
