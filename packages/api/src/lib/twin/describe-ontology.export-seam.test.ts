/**
 * U12 pre-extraction seam validation (Company Brain consolidation).
 *
 * Proves the two platform-bound twin read surfaces are derivable from the
 * published `twin-mapping/v1` export ALONE — no product-Postgres read:
 *
 * 1. `renderTwinOntology` (the MCP `twin_describe_ontology` text) built from
 *    a fixture TwinMappingExport JSON — exactly what the platform would read
 *    from `twin-mapping/<tenant>/latest.json` — is byte-identical to the
 *    Postgres-built path (`describeTwinOntology`, whose only DB touch is
 *    `compileTwinMappingExport`) over the same declarations.
 *
 * 2. `compileTwinQuery` consumes NOTHING from Postgres: it is a pure
 *    function of (TwinRequest, tenantId). Every declaration-shaped input it
 *    uses (entity type slugs as labels, facet/attribute slugs as
 *    `f_<facet>__<attribute>` properties, relationship slugs, filterType
 *    typing for predicate values) is present in the export. The
 *    characterization test below also PINS the current behavior that the
 *    compiler does not validate slugs against declarations at all — so a
 *    platform-side host needs no declaration source beyond the export even
 *    if it later adds that validation.
 *
 * 3. The cross-repo format gate is pinned: the platform projection
 *    (company-brain etl-platform/pipelines/projections/twin/_logic.py,
 *    parse_mapping_export) refuses any document whose `format` is not
 *    exactly "twin-mapping/v1" with UnsupportedExportFormatError — fail
 *    loud, not skew. The literal here is the product-side half of that pin;
 *    if TWIN_MAPPING_FORMAT ever revs, this test fails and forces the
 *    coordinated platform-side gate bump.
 */
import { describe, expect, it } from "vitest";
import {
  compileTwinMappingExport,
  TWIN_MAPPING_FORMAT,
  type TwinMappingExport,
} from "../ontology/twin-export.js";
import {
  describeTwinOntology,
  renderTwinOntology,
} from "./describe-ontology.js";
import { compileTwinQuery } from "./query-compiler.js";

/**
 * Fake drizzle db for the export compiler's three reads, in call order:
 * active version → entity rows → relationship rows. Mirrors the fixture
 * harness in ../ontology/twin-export.test.ts.
 */
class FakeExportDb {
  constructor(private queues: unknown[][]) {}

  select() {
    const rows = this.queues.shift() ?? [];
    const chain: {
      from: () => typeof chain;
      where: () => typeof chain;
      limit: () => Promise<unknown[]>;
      then: (
        resolve: (rows: unknown[]) => unknown,
        reject: (err: unknown) => unknown,
      ) => unknown;
    } = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }
}

/** Realistic declarations — same shapes the ontology jsonb columns hold. */
const entityRows = [
  {
    slug: "customer",
    name: "Customer",
    lifecycle_status: "approved",
    twin_facets: [
      {
        slug: "profile",
        clonePolicy: "deep_clone",
        sourceSystem: "twenty",
        attributes: [
          { sourceField: "name", attribute: "name", filterType: "string" },
        ],
      },
      {
        slug: "aging",
        clonePolicy: "deep_clone",
        cadence: "6h",
        sourceSystem: "lastmile",
        sourceDataset: "ar_aging",
        attributes: [
          {
            sourceField: "days_past_due",
            attribute: "days_past_due",
            filterType: "number",
          },
        ],
      },
    ],
    twin_facets_version: 2,
    page_sections: [
      {
        slug: "aging",
        heading: "Aging",
        kind: "facet_backed",
        facetSlug: "aging",
        visibility: "all_members",
        position: 0,
      },
    ],
    page_sections_version: 1,
  },
  {
    slug: "invoice",
    name: "Invoice",
    lifecycle_status: "approved",
    twin_facets: [
      {
        slug: "aging",
        clonePolicy: "deep_clone",
        sourceSystem: "lastmile",
        attributes: [
          {
            sourceField: "days_past_due",
            attribute: "days_past_due",
            filterType: "number",
          },
        ],
      },
    ],
    twin_facets_version: 1,
    page_sections: [],
    page_sections_version: 0,
  },
];

const relationshipRows = [
  {
    slug: "has_invoice",
    name: "Has invoice",
    lifecycle_status: "approved",
    source_type_slugs: ["customer"],
    target_type_slugs: ["invoice"],
    source_binding: {
      sourceSystem: "lastmile",
      sourceDataset: "invoices",
      sourceKeyFields: ["customer_id"],
      targetKeyFields: ["invoice_id"],
    },
    source_binding_version: 3,
  },
];

const freshDb = () =>
  new FakeExportDb([
    [{ version_number: 4 }],
    [...entityRows],
    [...relationshipRows],
  ]);

const NOW = new Date("2026-07-23T00:00:00Z");

describe("U12 seam: ontology description from twin-mapping export alone", () => {
  it("renders byte-identically from the published export JSON and from the Postgres path", async () => {
    // Postgres-built path: describeTwinOntology → compileTwinMappingExport
    // (the ONLY DB read on this surface) → renderTwinOntology.
    const fromPostgres = await describeTwinOntology({
      tenantId: "tenant-1",
      db: freshDb() as never,
    });

    // Platform path: parse the artifact exactly as uploaded to
    // twin-mapping/<tenant>/latest.json (JSON round-trip = S3 read) and
    // render with no DB in reach.
    const exported = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: freshDb() as never,
      now: NOW,
    });
    const artifact = JSON.parse(JSON.stringify(exported)) as TwinMappingExport;
    const fromArtifact = renderTwinOntology(artifact);

    expect(fromArtifact).toBe(fromPostgres);
    // Everything the renderer needs is in the artifact body.
    expect(fromArtifact).toContain("# Company Brain ontology (version 4)");
    expect(fromArtifact).toContain("### customer — Customer");
    expect(fromArtifact).toContain("f_aging__days_past_due (number)");
    expect(fromArtifact).toContain(
      "`has_invoice` (Has invoice): customer -> invoice",
    );
  });

  it("feeds the typed query compiler from export content alone (no Postgres input exists)", async () => {
    const exported = await compileTwinMappingExport({
      tenantId: "tenant-1",
      db: freshDb() as never,
      now: NOW,
    });
    const artifact = JSON.parse(JSON.stringify(exported)) as TwinMappingExport;

    // Build a cohort+path request using ONLY export-carried declarations:
    // entity type slug, facet/attribute slugs + filterType, relationship
    // slug, target type slug.
    const customer = artifact.entities.find((e) => e.slug === "customer")!;
    const agingAttr = artifact.entities
      .find((e) => e.slug === "invoice")!
      .facets.find((f) => f.slug === "aging")!.attributes[0]!;
    const rel = artifact.relationships[0]!;

    const compiled = compileTwinQuery(
      {
        kind: "cohort",
        entityType: customer.slug,
        predicates: [],
        path: {
          relationship: rel.slug,
          targetType: rel.targetTypeSlugs[0]!,
          predicates: [
            {
              facet: "aging",
              attribute: agingAttr.attribute,
              op: "gt",
              value: 60,
            },
          ],
        },
      },
      { tenantId: artifact.tenantId },
    );

    expect(compiled.query).toContain("MATCH (n:customer)");
    expect(compiled.query).toContain("[:has_invoice]->(m:invoice)");
    expect(compiled.query).toContain("m.`f_aging__days_past_due` > $p1");
    expect(compiled.parameters).toMatchObject({ tenantId: "tenant-1", p1: 60 });
  });

  it("characterization: the compiler consults NO declaration source — undeclared slugs still compile", () => {
    // Pins the current contract: compileTwinQuery validates slugs
    // syntactically (SLUG_RE) and parameterizes values, but never checks
    // them against ontology declarations; an undeclared facet/attribute
    // compiles fine and simply matches zero rows in Neptune. Therefore the
    // platform-side host needs no product-DB read to run the compiler —
    // and if declaration validation is ever added, the export already
    // carries the full vocabulary (entity slugs, facet slugs, attribute
    // names + filterType, relationship slugs + endpoint type slugs).
    const compiled = compileTwinQuery(
      {
        kind: "cohort",
        entityType: "not_a_declared_type",
        predicates: [
          {
            facet: "not_a_declared_facet",
            attribute: "nope",
            op: "eq",
            value: "x",
          },
        ],
      },
      { tenantId: "tenant-1" },
    );
    expect(compiled.query).toContain("MATCH (n:not_a_declared_type)");
    expect(compiled.query).toContain("n.`f_not_a_declared_facet__nope` = $p1");
  });

  it("pins the cross-repo fail-loud format gate literal", () => {
    // The platform projection refuses any other format string
    // (company-brain: etl-platform/pipelines/projections/twin/_logic.py,
    // parse_mapping_export — UnsupportedExportFormatError). This literal is
    // the product-side half of that pin; revving it here without revving
    // the platform gate makes every new artifact refuse loudly, never skew.
    expect(TWIN_MAPPING_FORMAT).toBe("twin-mapping/v1");
  });
});
