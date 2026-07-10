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
export const FIELD_SPECS: Array<{
  object: string;
  name: string;
  label: string;
  type: "TEXT" | "NUMBER" | "BOOLEAN";
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
  { object: "opportunity", name: "product", label: "Product", type: "TEXT" },
  {
    object: "opportunity",
    name: "quantity",
    label: "Quantity",
    type: "NUMBER",
  },
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
  {
    object: "attachment",
    name: "sourceId",
    label: "Source ID",
    type: "TEXT",
    isUnique: true,
  },
];

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
