/**
 * Idempotent Twenty schema preparation (plan U3, R1–R3).
 *
 * Creates only missing custom fields via `createOneField` on `/metadata`, and
 * merges the migration's stage options into the opportunity `stage` SELECT.
 * U1 confirmed `updateOneField` FULL-REPLACES the options array, so the merge
 * always writes existing options + additions; existing options (including
 * CUSTOMER, which the ThinkWork workflow triggers on) are preserved verbatim.
 */

import { MIGRATION_STAGE_OPTIONS } from "./mappers";
import type { TwentyClient } from "./twenty-client";

/** The whole schema delta in one reviewable place (plan U3 approach note). */
/**
 * Opportunities carry MULTIPLE product lines (LastMile keeps them in
 * `task.entity_data->'items'`: 816 opportunities, 82 with 2-5 lines each), so
 * product/quantity/amount belong on a child object, not on the opportunity
 * row. This custom object holds one row per line, related many-to-one back to
 * the opportunity. The opportunity's own `product` (category) and native
 * `amount` (deal total) stay where they are.
 */
export const OPPORTUNITY_PRODUCT_OBJECT = {
  nameSingular: "opportunityProduct",
  namePlural: "opportunityProducts",
  labelSingular: "Opportunity Product",
  labelPlural: "Opportunity Products",
  icon: "IconPackage",
  /** Field created on `opportunity` pointing back at the lines. */
  targetFieldLabel: "Products",
} as const;

/**
 * LastMile branches ("Golden West Oil Co..San Antonio (300)", displayed as
 * "GWO 300"). Opportunities belong to exactly one, so it is a related object
 * rather than a free-text field: 38 of them, filterable and roll-up-able.
 */
export const ORGANIZATION_OBJECT = {
  nameSingular: "organization",
  namePlural: "organizations",
  labelSingular: "Organization",
  labelPlural: "Organizations",
  icon: "IconBuildingCommunity",
  targetFieldLabel: "Opportunities",
} as const;

/**
 * TEI's product catalog: exactly the seven lines LastMile's "Product Line"
 * picker offers. Opportunity product lines point at these, so a product is one
 * record you can filter and report on rather than 19 free-text spellings.
 */
export const PRODUCT_OBJECT = {
  nameSingular: "product",
  namePlural: "products",
  labelSingular: "Product",
  labelPlural: "Products",
  icon: "IconBox",
  targetFieldLabel: "Lines",
} as const;

/** Legacy fields from the first import, superseded by the product lines.
 * `amount` on the opportunity is Twenty's native deal total and stays. */
export const LEGACY_OPPORTUNITY_FIELDS: readonly string[] = [
  "product",
  "quantity",
];

export const FIELD_SPECS: Array<{
  object: string;
  name: string;
  label: string;
  type: "TEXT" | "NUMBER" | "BOOLEAN" | "CURRENCY";
  isUnique?: boolean;
}> = [
  {
    object: "company",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  { object: "company", name: "sourceHash", label: "Source Hash", type: "TEXT" },
  {
    object: "person",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  { object: "person", name: "sourceHash", label: "Source Hash", type: "TEXT" },
  {
    object: "opportunity",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  {
    object: "opportunity",
    name: "sourceHash",
    label: "Source Hash",
    type: "TEXT",
  },
  // product + quantity live on the opportunityProduct lines, not here — an
  // opportunity can carry several. isMobil stays as a roll-up: true when any
  // line is a Mobil product, so the pipeline can be filtered on it.
  {
    object: "opportunity",
    name: "isMobil",
    label: "Mobil Product",
    type: "BOOLEAN",
  },
  {
    object: "note",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  { object: "note", name: "sourceHash", label: "Source Hash", type: "TEXT" },
  // Twenty's createdBy actor is not settable through the API, so the LastMile
  // author rides on the note itself.
  { object: "note", name: "author", label: "Author", type: "TEXT" },
  {
    object: "attachment",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  // Product-line object (created first when missing; see ensureOpportunityProductObject).
  {
    object: "opportunityProduct",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  {
    object: "opportunityProduct",
    name: "sourceHash",
    label: "Source Hash",
    type: "TEXT",
  },
  {
    object: "opportunityProduct",
    name: "quantity",
    label: "Quantity",
    type: "NUMBER",
  },
  {
    object: "opportunityProduct",
    name: "amount",
    label: "Amount",
    type: "CURRENCY",
  },
  {
    object: "opportunityProduct",
    name: "isMobil",
    label: "Mobil Product",
    type: "BOOLEAN",
  },
  {
    object: "opportunityProduct",
    name: "lineNumber",
    label: "Line",
    type: "NUMBER",
  },
  {
    object: "organization",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
  {
    object: "organization",
    name: "sourceHash",
    label: "Source Hash",
    type: "TEXT",
  },
  {
    object: "organization",
    name: "fullName",
    label: "Full Name",
    type: "TEXT",
  },
];

/** Placeholder id used only in dry-run plans, never sent to Twenty. */
export const PENDING_OBJECT_ID = "<pending-object-creation>";

interface ObjectMetadata {
  id: string;
  nameSingular: string;
  fields: Map<
    string,
    { id: string; name: string; type: string; options: StageOption[] | null }
  >;
}

export interface StageOption {
  id?: string;
  label: string;
  value: string;
  color: string;
  position: number;
}

const OBJECTS_QUERY = `
  query MigrationObjects {
    objects(paging: { first: 1000 }) {
      edges {
        node {
          id
          nameSingular
          fields(paging: { first: 1000 }) {
            edges { node { id name type options } }
          }
        }
      }
    }
  }
`;

const CREATE_FIELD_MUTATION = `
  mutation MigrationCreateField($input: CreateOneFieldMetadataInput!) {
    createOneField(input: $input) { id name }
  }
`;

const UPDATE_FIELD_MUTATION = `
  mutation MigrationUpdateField($input: UpdateOneFieldMetadataInput!) {
    updateOneField(input: $input) { id name options }
  }
`;

const CREATE_OBJECT_MUTATION = `
  mutation MigrationCreateObject($input: CreateOneObjectInput!) {
    createOneObject(input: $input) { id nameSingular }
  }
`;

/**
 * Create the opportunityProduct object and its many-to-one relation to
 * opportunity, if absent. Idempotent: returns the existing object's id when it
 * is already there. Must run before the field pass, which addresses the object
 * by name. Verified live: the workspace API key may create objects and
 * RELATION fields via `relationCreationPayload`, and Twenty exposes the FK to
 * the data API as `opportunityId` on the line's create input.
 */
async function ensureCustomObjectWithOpportunityRelation(
  client: TwentyClient,
  objects: Map<string, ObjectMetadata>,
  dryRun: boolean,
  spec: {
    nameSingular: string;
    namePlural: string;
    labelSingular: string;
    labelPlural: string;
    icon: string;
    targetFieldLabel: string;
  },
  /** Which side owns the FK. "child" = many spec-rows -> one opportunity;
   * "parent" = many opportunities -> one spec-row. */
  direction: "child" | "parent",
): Promise<{ created: boolean; relationCreated: boolean }> {
  const existing = objects.get(spec.nameSingular);
  const opportunity = objects.get("opportunity");
  if (!opportunity) throw new Error('Twenty object "opportunity" not found.');

  const relationLives =
    direction === "child"
      ? existing?.fields.has("opportunity")
      : opportunity.fields.has(spec.nameSingular);
  if (existing && relationLives) {
    return { created: false, relationCreated: false };
  }
  if (dryRun) return { created: !existing, relationCreated: true };

  let objectId = existing?.id;
  if (!objectId) {
    const created = await client.requestOnce<{
      createOneObject: { id: string };
    }>("/metadata", CREATE_OBJECT_MUTATION, {
      input: {
        object: {
          nameSingular: spec.nameSingular,
          namePlural: spec.namePlural,
          labelSingular: spec.labelSingular,
          labelPlural: spec.labelPlural,
          icon: spec.icon,
        },
      },
    });
    objectId = created.createOneObject.id;
  }

  // MANY_TO_ONE always reads "many <owner> -> one <target>". For the child
  // direction the line owns the FK; for the parent direction the opportunity
  // does, so the field is created on opportunity pointing at spec's object.
  const [ownerObjectId, targetObjectId, fieldName, fieldLabel] =
    direction === "child"
      ? [objectId, opportunity.id, "opportunity", "Opportunity"]
      : [opportunity.id, objectId, spec.nameSingular, spec.labelSingular];

  await client.requestOnce("/metadata", CREATE_FIELD_MUTATION, {
    input: {
      field: {
        objectMetadataId: ownerObjectId,
        name: fieldName,
        label: fieldLabel,
        type: "RELATION",
        relationCreationPayload: {
          targetObjectMetadataId: targetObjectId,
          targetFieldLabel: spec.targetFieldLabel,
          targetFieldIcon: spec.icon,
          type: "MANY_TO_ONE",
        },
      },
    },
  });

  return { created: !existing, relationCreated: true };
}

export async function ensureOpportunityProductObject(
  client: TwentyClient,
  objects: Map<string, ObjectMetadata>,
  dryRun: boolean,
): Promise<{ created: boolean; relationCreated: boolean }> {
  return ensureCustomObjectWithOpportunityRelation(
    client,
    objects,
    dryRun,
    OPPORTUNITY_PRODUCT_OBJECT,
    "child",
  );
}

/** Many opportunities belong to one organization, so the FK lives on
 * opportunity as `organizationId`. */
export async function ensureOrganizationObject(
  client: TwentyClient,
  objects: Map<string, ObjectMetadata>,
  dryRun: boolean,
): Promise<{ created: boolean; relationCreated: boolean }> {
  return ensureCustomObjectWithOpportunityRelation(
    client,
    objects,
    dryRun,
    ORGANIZATION_OBJECT,
    "parent",
  );
}

export async function fetchObjectMetadata(
  client: TwentyClient,
): Promise<Map<string, ObjectMetadata>> {
  const data = await client.requestWithRetry<{
    objects: {
      edges: Array<{
        node: {
          id: string;
          nameSingular: string;
          fields: {
            edges: Array<{
              node: {
                id: string;
                name: string;
                type: string;
                options: StageOption[] | null;
              };
            }>;
          };
        };
      }>;
    };
  }>("/metadata", OBJECTS_QUERY);

  const byName = new Map<string, ObjectMetadata>();
  for (const { node } of data.objects.edges) {
    byName.set(node.nameSingular, {
      id: node.id,
      nameSingular: node.nameSingular,
      fields: new Map(
        node.fields.edges.map(({ node: field }) => [field.name, field]),
      ),
    });
  }
  return byName;
}

export interface SchemaEnsurePlan {
  createFields: Array<{
    object: string;
    objectMetadataId: string;
    name: string;
  }>;
  stageOptionsToAdd: string[];
  /** Full merged array to write when stageOptionsToAdd is non-empty. */
  mergedStageOptions: StageOption[] | null;
  stageFieldId: string | null;
}

export function planSchemaEnsure(
  objects: Map<string, ObjectMetadata>,
): SchemaEnsurePlan {
  const createFields: SchemaEnsurePlan["createFields"] = [];
  for (const spec of FIELD_SPECS) {
    const object = objects.get(spec.object);
    if (!object) {
      // ensureOpportunityProductObject creates this object earlier in the same
      // run; in a dry-run against a workspace that lacks it, its fields are
      // planned rather than an error.
      if (
        spec.object === OPPORTUNITY_PRODUCT_OBJECT.nameSingular ||
        spec.object === ORGANIZATION_OBJECT.nameSingular ||
        spec.object === PRODUCT_OBJECT.nameSingular
      ) {
        createFields.push({
          object: spec.object,
          objectMetadataId: PENDING_OBJECT_ID,
          name: spec.name,
        });
        continue;
      }
      throw new Error(
        `Twenty object "${spec.object}" not found in metadata; aborting.`,
      );
    }
    if (!object.fields.has(spec.name)) {
      createFields.push({
        object: spec.object,
        objectMetadataId: object.id,
        name: spec.name,
      });
    }
  }

  const opportunity = objects.get("opportunity");
  const stageField = opportunity?.fields.get("stage");
  if (!stageField || !stageField.options) {
    throw new Error(
      "Opportunity stage field (SELECT with options) not found; aborting.",
    );
  }
  const existingValues = new Set(
    stageField.options.map((option) => option.value),
  );
  const additions = MIGRATION_STAGE_OPTIONS.filter(
    (option) => !existingValues.has(option.value),
  );
  let mergedStageOptions: StageOption[] | null = null;
  if (additions.length > 0) {
    const preserved = stageField.options.map((option, index) => ({
      ...(option.id ? { id: option.id } : {}),
      label: option.label,
      value: option.value,
      color: option.color,
      position: index,
    }));
    const appended = additions.map((option, index) => ({
      label: option.label,
      value: option.value,
      color: option.color,
      position: preserved.length + index,
    }));
    mergedStageOptions = [...preserved, ...appended];
  }
  return {
    createFields,
    stageOptionsToAdd: additions.map((option) => option.value),
    mergedStageOptions,
    stageFieldId: stageField.id,
  };
}

export interface SchemaEnsureResult {
  createdFields: string[];
  addedStageOptions: string[];
}

export async function applySchemaEnsure(
  client: TwentyClient,
  plan: SchemaEnsurePlan,
): Promise<SchemaEnsureResult> {
  const createdFields: string[] = [];
  for (const create of plan.createFields) {
    const spec = FIELD_SPECS.find(
      (candidate) =>
        candidate.object === create.object && candidate.name === create.name,
    );
    if (!spec)
      throw new Error(`No field spec for ${create.object}.${create.name}`);
    if (create.objectMetadataId === PENDING_OBJECT_ID) {
      throw new Error(
        `Field ${create.object}.${create.name} was planned against an uncreated object — ` +
          `re-plan after ensureOpportunityProductObject so the real object id is known.`,
      );
    }
    // Metadata mutation errors abort the run before any record loading (U3).
    await client.requestOnce("/metadata", CREATE_FIELD_MUTATION, {
      input: {
        field: {
          objectMetadataId: create.objectMetadataId,
          name: spec.name,
          label: spec.label,
          type: spec.type,
          ...(spec.isUnique ? { isUnique: true } : {}),
        },
      },
    });
    createdFields.push(`${create.object}.${create.name}`);
  }

  if (plan.mergedStageOptions && plan.stageFieldId) {
    await client.requestOnce("/metadata", UPDATE_FIELD_MUTATION, {
      input: {
        id: plan.stageFieldId,
        update: { options: plan.mergedStageOptions },
      },
    });
  }

  return { createdFields, addedStageOptions: plan.stageOptionsToAdd };
}
