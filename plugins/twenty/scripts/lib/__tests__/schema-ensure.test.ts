import { describe, expect, it, vi } from "vitest";

import {
  applySchemaEnsure,
  FIELD_SPECS,
  PENDING_OBJECT_ID,
  planSchemaEnsure,
} from "../schema-ensure";
import { MIGRATION_STAGE_OPTIONS } from "../mappers";
import type { TwentyClient } from "../twenty-client";

const EXISTING_STAGE_OPTIONS = [
  { id: "id-new", label: "New", value: "NEW", color: "red", position: 0 },
  {
    id: "id-cust",
    label: "Customer",
    value: "CUSTOMER",
    color: "yellow",
    position: 1,
  },
];

interface FieldFixture {
  id: string;
  name: string;
  type: string;
  options: typeof EXISTING_STAGE_OPTIONS | null;
}

function objectsFixture(
  fieldsByObject: Record<string, FieldFixture[]>,
): Map<
  string,
  { id: string; nameSingular: string; fields: Map<string, FieldFixture> }
> {
  const map = new Map<
    string,
    { id: string; nameSingular: string; fields: Map<string, FieldFixture> }
  >();
  for (const [name, fields] of Object.entries(fieldsByObject)) {
    map.set(name, {
      id: `obj-${name}`,
      nameSingular: name,
      fields: new Map(fields.map((field) => [field.name, field])),
    });
  }
  return map;
}

const stageField: FieldFixture = {
  id: "field-stage",
  name: "stage",
  type: "SELECT",
  options: EXISTING_STAGE_OPTIONS,
};

function bareObjects() {
  return objectsFixture({
    company: [],
    person: [],
    opportunity: [stageField],
    note: [],
    attachment: [],
    // Custom objects exist (their ensure* ran) but have none of their fields.
    opportunityProduct: [],
    organization: [],
  });
}

/** A workspace that has never seen the product-line object at all. */
function objectsWithoutProductObject() {
  return objectsFixture({
    company: [],
    person: [],
    opportunity: [stageField],
    note: [],
    attachment: [],
  });
}

function provisionedObjects() {
  const withAll = (object: string): FieldFixture[] =>
    FIELD_SPECS.filter((spec) => spec.object === object).map((spec, index) => ({
      id: `f-${object}-${index}`,
      name: spec.name,
      type: spec.type,
      options: null,
    }));
  const opportunityFields = [
    ...withAll("opportunity"),
    {
      ...stageField,
      options: [
        ...EXISTING_STAGE_OPTIONS,
        ...MIGRATION_STAGE_OPTIONS.map((option, index) => ({
          id: `id-${option.value}`,
          ...option,
          position: EXISTING_STAGE_OPTIONS.length + index,
        })),
      ],
    },
  ];
  return objectsFixture({
    company: withAll("company"),
    person: withAll("person"),
    opportunity: opportunityFields,
    note: withAll("note"),
    attachment: withAll("attachment"),
    opportunityProduct: [
      ...withAll("opportunityProduct"),
      {
        id: "f-op-rel",
        name: "opportunity",
        type: "RELATION",
        options: null,
      },
    ],
    organization: withAll("organization"),
  });
}

describe("planSchemaEnsure", () => {
  it("plans every missing field and all stage options on an empty workspace", () => {
    const plan = planSchemaEnsure(bareObjects());
    expect(plan.createFields).toHaveLength(FIELD_SPECS.length);
    // NEW already exists on the workspace, so it is merged, not duplicated.
    expect(plan.stageOptionsToAdd).toEqual(
      MIGRATION_STAGE_OPTIONS.filter((option) => option.value !== "NEW").map(
        (option) => option.value,
      ),
    );
    // Full-replace semantics (U1): the merged array keeps existing options first.
    expect(
      plan.mergedStageOptions?.slice(0, 2).map((option) => option.value),
    ).toEqual(["NEW", "CUSTOMER"]);
    expect(plan.mergedStageOptions).toHaveLength(
      EXISTING_STAGE_OPTIONS.length + MIGRATION_STAGE_OPTIONS.length - 1,
    );
  });

  it("is a no-op against already-provisioned metadata (idempotent)", () => {
    const plan = planSchemaEnsure(provisionedObjects());
    expect(plan.createFields).toHaveLength(0);
    expect(plan.stageOptionsToAdd).toEqual([]);
    expect(plan.mergedStageOptions).toBeNull();
  });

  it("creates only the gap on partial presence", () => {
    const objects = bareObjects();
    objects.get("opportunityProduct")!.fields.set("product", {
      id: "f-product",
      name: "product",
      type: "TEXT",
      options: null,
    });
    const plan = planSchemaEnsure(objects);
    const names = plan.createFields.map(
      (field) => `${field.object}.${field.name}`,
    );
    expect(names).not.toContain("opportunityProduct.product");
    expect(names).toContain("opportunityProduct.quantity");
  });

  it("aborts when the stage field is missing", () => {
    const objects = objectsFixture({
      company: [],
      person: [],
      opportunity: [],
      note: [],
      attachment: [],
      opportunityProduct: [],
      organization: [],
    });
    expect(() => planSchemaEnsure(objects)).toThrow(/stage field/);
  });

  it("plans product-line fields against a pending object id when it does not exist yet", () => {
    const plan = planSchemaEnsure(objectsWithoutProductObject());
    const productFields = plan.createFields.filter(
      (field) => field.object === "opportunityProduct",
    );
    expect(productFields.length).toBeGreaterThan(0);
    expect(
      productFields.every(
        (field) => field.objectMetadataId === PENDING_OBJECT_ID,
      ),
    ).toBe(true);
  });
});

describe("applySchemaEnsure", () => {
  it("issues createOneField per missing field and one full-replace options write", async () => {
    const requestOnce = vi.fn(async () => ({}));
    const client = { requestOnce } as unknown as TwentyClient;
    const plan = planSchemaEnsure(bareObjects());
    const result = await applySchemaEnsure(client, plan);
    expect(result.createdFields).toHaveLength(FIELD_SPECS.length);
    // one createOneField call per field + one updateOneField for stage options
    expect(requestOnce).toHaveBeenCalledTimes(FIELD_SPECS.length + 1);
    const lastCall = requestOnce.mock.calls.at(-1) as unknown as [
      string,
      string,
      { input: { update: { options: Array<{ value: string }> } } },
    ];
    expect(
      lastCall[2].input.update.options.map((option) => option.value),
    ).toContain("CUSTOMER");
    expect(
      lastCall[2].input.update.options.map((option) => option.value),
    ).toContain("PROSPECT");
  });

  it("refuses to create a field against a pending object id", async () => {
    // Guards the ordering bug: fields must be planned only after
    // ensureOpportunityProductObject has created the object.
    const requestOnce = vi.fn(async () => ({}));
    const client = { requestOnce } as unknown as TwentyClient;
    const plan = planSchemaEnsure(objectsWithoutProductObject());
    await expect(applySchemaEnsure(client, plan)).rejects.toThrow(
      /planned against an uncreated object/,
    );
  });

  it("aborts on the first metadata mutation error", async () => {
    const requestOnce = vi.fn(async () => {
      throw new Error("metadata boom");
    });
    const client = { requestOnce } as unknown as TwentyClient;
    const plan = planSchemaEnsure(bareObjects());
    await expect(applySchemaEnsure(client, plan)).rejects.toThrow(
      /metadata boom/,
    );
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });
});
