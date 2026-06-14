import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  buildSchema,
} from "graphql";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCHEMA_DIR = join(REPO_ROOT, "packages/database-pg/graphql");
const TYPES_DIR = join(SCHEMA_DIR, "types");

const APPSYNC_DIRECTIVES = `
directive @aws_subscribe(mutations: [String!]!) on FIELD_DEFINITION
directive @aws_auth(cognito_groups: [String!]!) on FIELD_DEFINITION
directive @aws_api_key on FIELD_DEFINITION | OBJECT
directive @aws_iam on FIELD_DEFINITION | OBJECT
directive @aws_cognito_user_pools(cognito_groups: [String!]) on FIELD_DEFINITION | OBJECT
`;

function loadFullSchema(): string {
  const base = readFileSync(join(SCHEMA_DIR, "schema.graphql"), "utf-8");
  const typeFiles = readdirSync(TYPES_DIR)
    .filter((file) => file.endsWith(".graphql"))
    .sort();
  const types = typeFiles.map((file) =>
    readFileSync(join(TYPES_DIR, file), "utf-8"),
  );
  return [APPSYNC_DIRECTIVES, base, ...types].join("\n\n");
}

describe("Knowledge Graph GraphQL contract", () => {
  const schema = buildSchema(loadFullSchema());
  const queryFields = schema.getQueryType()?.getFields() ?? {};
  const mutationFields = schema.getMutationType()?.getFields() ?? {};

  it("exposes Knowledge Graph enum values for run, grounding, and provenance states", () => {
    expect(enumValues("KnowledgeGraphIngestStatus")).toEqual([
      "QUEUED",
      "RUNNING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "STALE_NOOP",
    ]);
    expect(enumValues("KnowledgeGraphSourceKind")).toEqual([
      "THREAD",
      "WIKI",
      "BRAIN",
      "OBSERVATIONS",
    ]);
    expect(enumValues("KnowledgeGraphArtifactManifestKind")).toEqual([
      "SOURCE_ARTIFACT",
      "INGESTION_MANIFEST",
      "MIGRATION_SNAPSHOT",
      "VAULT_PROJECTION",
      "EXPORT",
    ]);
    expect(enumValues("KnowledgeGraphGroundingStatus")).toEqual([
      "GROUNDED",
      "UNAPPROVED_TYPE",
      "UNGROUNDED",
      "CONFLICT",
      "UNKNOWN",
    ]);
    expect(enumValues("KnowledgeGraphProvenanceStatus")).toEqual([
      "STRONG",
      "WEAK",
      "MISSING",
    ]);
  });

  it("exposes normalized run, entity, relationship, evidence, and graph payload types", () => {
    expect(typeFields("KnowledgeGraphIngestRun")).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "threadId",
        "requestedByUserId",
        "status",
        "cogneeDatasetName",
        "entityCount",
        "relationshipCount",
        "evidenceCount",
        "diagnosticCount",
        "messageCount",
        "artifactManifests",
      ]),
    );
    expect(typeFields("KnowledgeGraphArtifactManifestSummary")).toEqual(
      expect.arrayContaining([
        "id",
        "artifactKind",
        "status",
        "sourceKind",
        "sourceType",
        "objectRef",
        "checksumSha256",
        "objectCount",
        "sourceCount",
        "contentType",
        "contentEncoding",
        "byteLength",
        "embeddingModel",
        "vectorDimension",
        "ontologyVersion",
        "ontologyMechanism",
      ]),
    );
    expect(typeFields("KnowledgeGraphArtifactManifestSummary")).not.toEqual(
      expect.arrayContaining([
        "manifestUri",
        "artifactRootUri",
        "vaultProjectionRootUri",
        "sourceIds",
      ]),
    );
    expect(typeFields("KnowledgeGraphEntity")).toEqual(
      expect.arrayContaining([
        "id",
        "label",
        "normalizedLabel",
        "ontologyTypeSlug",
        "groundingStatus",
        "provenanceStatus",
        "relationships",
        "evidence",
      ]),
    );
    expect(typeFields("KnowledgeGraphGraph")).toEqual(["nodes", "edges"]);
    expect(typeFields("KnowledgeGraphThreadCandidate")).toEqual(
      expect.arrayContaining([
        "threadId",
        "title",
        "number",
        "requesterUserId",
        "messageCount",
        "lastIngestRun",
      ]),
    );
  });

  it("adds read queries for candidates, runs, entities, graph, and entity detail", () => {
    for (const fieldName of [
      "knowledgeGraphThreadCandidates",
      "knowledgeGraphIngestRuns",
      "knowledgeGraphEntities",
      "knowledgeGraphGraph",
      "knowledgeGraphEntity",
    ]) {
      expect(queryFields[fieldName]).toBeTruthy();
    }

    const entitiesArgs = queryFields.knowledgeGraphEntities.args.map(
      (arg) => arg.name,
    );
    expect(entitiesArgs).toEqual(
      expect.arrayContaining([
        "tenantId",
        "threadId",
        "runId",
        "search",
        "ontologyType",
        "groundingStatus",
        "provenanceStatus",
        "limit",
      ]),
    );
    expect(queryFields.knowledgeGraphGraph.type).toBeInstanceOf(GraphQLNonNull);
  });

  it("adds the manual thread ingest mutation input contract", () => {
    const mutation = mutationFields.startKnowledgeGraphThreadIngest;
    expect(mutation).toBeTruthy();
    expect(mutation.type).toBeInstanceOf(GraphQLNonNull);

    const inputType = schema.getType("StartKnowledgeGraphThreadIngestInput");
    expect(inputType).toBeInstanceOf(GraphQLInputObjectType);
    const inputFields = (inputType as GraphQLInputObjectType).getFields();
    expect(Object.keys(inputFields)).toEqual([
      "tenantId",
      "threadId",
      "force",
      "metadata",
    ]);
    expect(inputFields.threadId.type).toBeInstanceOf(GraphQLNonNull);
  });

  it("returns list shapes where the Explorer will page table and graph data", () => {
    expect(
      unwrapNonNull(queryFields.knowledgeGraphEntities.type),
    ).toBeInstanceOf(GraphQLList);
    expect(
      unwrapNonNull(queryFields.knowledgeGraphThreadCandidates.type),
    ).toBeInstanceOf(GraphQLList);
    expect(
      unwrapNonNull(queryFields.knowledgeGraphIngestRuns.type),
    ).toBeInstanceOf(GraphQLList);
  });

  function enumValues(name: string): string[] {
    const type = schema.getType(name);
    expect(type).toBeInstanceOf(GraphQLEnumType);
    return (type as GraphQLEnumType).getValues().map((value) => value.name);
  }

  function typeFields(name: string): string[] {
    const type = schema.getType(name);
    expect(type).toBeInstanceOf(GraphQLObjectType);
    return Object.keys((type as GraphQLObjectType).getFields());
  }

  function unwrapNonNull(type: unknown): unknown {
    return type instanceof GraphQLNonNull ? type.ofType : type;
  }
});
