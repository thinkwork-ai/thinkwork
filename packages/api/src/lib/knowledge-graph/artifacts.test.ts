import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  redactArtifactError,
  writeKnowledgeGraphIngestArtifacts,
  writeVaultProjectionArtifact,
} from "./artifacts.js";

const run = {
  id: "run-1",
  tenant_id: "tenant-1",
  thread_id: "thread-1",
  source_kind: "thread",
  source_ref: "thread-1",
  source_label: "Discovery thread",
  requested_by_user_id: "user-1",
  status: "running",
  trigger: "manual",
  cognee_dataset_name: "thinkwork:tenant-1:thread:thread-1",
  cognee_dataset_id: null,
  started_at: null,
  finished_at: null,
  duration_ms: null,
  error: null,
  entity_count: 0,
  relationship_count: 0,
  evidence_count: 0,
  diagnostic_count: 0,
  message_count: 1,
  input: {},
  metrics: {},
  metadata: {},
  created_at: new Date("2026-06-14T00:00:00.000Z"),
  updated_at: new Date("2026-06-14T00:00:00.000Z"),
};

const source = {
  sourceKind: "thread" as const,
  sourceRef: "thread-1",
  sourceLabel: "Discovery thread",
  document: "# Discovery\n\nAcme uses Delta.",
  evidence: [
    {
      id: "message-1",
      role: "user",
      senderType: "user",
      senderId: "user-1",
      speakerLabel: "User",
      text: "Acme uses Delta.",
      createdAt: new Date("2026-06-14T00:00:00.000Z"),
      ordinal: 0,
    },
  ],
  packets: [],
  relationships: [],
  packetCount: 1,
  skippedCount: 0,
  diagnostics: { apiToken: "real-token" },
};

const ontology = {
  mechanism: "cognee_owl_ontology" as const,
  entityTypes: [],
  relationshipTypes: [],
  customPrompt: "Extract",
  ontologyKey: "ontology-key-v1",
  ontologyOwlXml: "<rdf:RDF></rdf:RDF>",
};

function makeDb() {
  const records: unknown[] = [];
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn((record: unknown) => {
    records.push(record);
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as any, records, insert, values, onConflictDoUpdate };
}

function makeS3() {
  const sends: unknown[] = [];
  const send = vi.fn(async (command: unknown) => {
    sends.push(command);
    return { VersionId: `v${sends.length}` };
  });
  return { s3: { send } as any, sends, send };
}

function commandInput(command: unknown) {
  return (command as { input: Record<string, unknown> }).input;
}

beforeEach(() => {
  delete process.env.BRAIN_ARTIFACTS_BUCKET;
  delete process.env.BRAIN_EMBEDDING_MODEL;
  delete process.env.BRAIN_VECTOR_DIMENSION;
});

describe("Company Brain artifact helpers", () => {
  it("writes source artifacts and ingestion manifests with internal provenance", async () => {
    process.env.BRAIN_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0";
    process.env.BRAIN_VECTOR_DIMENSION = "1024";
    const { db, records } = makeDb();
    const { s3, sends } = makeS3();

    const result = await writeKnowledgeGraphIngestArtifacts({
      db,
      s3,
      bucket: "brain-artifacts-test",
      run,
      source,
      ontology,
    });

    expect(result.enabled).toBe(true);
    expect(sends).toHaveLength(2);
    expect(commandInput(sends[0]).Key).toBe(
      "source-artifacts/tenant-1/thread/run-1/source.md",
    );
    expect(commandInput(sends[1]).Key).toBe(
      "ingestion-manifests/tenant-1/thread/run-1/manifest.json",
    );

    const manifestBody = commandInput(sends[1]).Body as Buffer;
    const manifest = JSON.parse(manifestBody.toString("utf8"));
    expect(manifest.source.ids).toEqual(["message-1"]);
    expect(manifest.sourceMetrics.diagnostics.apiToken).toBe("[redacted]");
    expect(JSON.stringify(manifest)).not.toContain("real-token");

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        ingest_run_id: "run-1",
        manifest_kind: "source_artifact",
        source_kind: "thread",
        source_type: "thread_message",
        source_ids: ["message-1"],
        object_version_id: "v1",
        embedding_model: "amazon.titan-embed-text-v2:0",
        vector_dimension: 1024,
        ontology_version: "ontology-key-v1",
        ontology_mechanism: "cognee_owl_ontology",
      }),
    );
    expect(records[1]).toEqual(
      expect.objectContaining({
        manifest_kind: "ingestion_manifest",
        object_version_id: "v2",
        object_count: 2,
      }),
    );
  });

  it("does nothing when no canonical bucket is configured", async () => {
    const { db, insert } = makeDb();
    const { s3, send } = makeS3();

    const result = await writeKnowledgeGraphIngestArtifacts({
      db,
      s3,
      run,
      source,
      ontology,
    });

    expect(result).toEqual({ enabled: false });
    expect(send).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("redacts bucket names, object keys, and source identifiers from errors", () => {
    const redacted = redactArtifactError(
      new Error(
        "AccessDenied bucket thinkwork-dev-brain-artifacts key ingestion-manifests/tenant-1/source-id-secret/manifest.json sourceRef=connector-secret",
      ),
    );

    expect(redacted).toContain("[redacted-bucket]");
    expect(redacted).toContain("[redacted-s3-key]");
    expect(redacted).toContain("sourceRef=[redacted]");
    expect(redacted).not.toContain("thinkwork-dev-brain-artifacts");
    expect(redacted).not.toContain("source-id-secret");
    expect(redacted).not.toContain("connector-secret");
  });

  it("records wiki vault exports as canonical vault projections", async () => {
    const { db, records } = makeDb();
    const { s3, sends } = makeS3();

    const result = await writeVaultProjectionArtifact({
      db,
      s3,
      bucket: "brain-artifacts-test",
      tenantId: "tenant-1",
      sourceRef: "wiki:vault:tenant-1:_tenant:2026-06-14",
      sourceLabel: "Wiki vault projection",
      sourceIds: ["page-1", "page-2"],
      body: Buffer.from("compressed"),
      date: "2026-06-14",
    });

    expect(result.enabled).toBe(true);
    expect(commandInput(sends[0]).Key).toMatch(
      /^vault-projections\/tenant-1\/[a-f0-9]{64}\/2026-06-14\/vault\.md\.gz$/,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        manifest_kind: "vault_projection",
        source_kind: "wiki",
        source_type: "wiki_vault_projection",
        source_ids: ["page-1", "page-2"],
        source_count: 2,
        vault_projection_root_uri:
          "s3://brain-artifacts-test/vault-projections/tenant-1/",
      }),
    );
  });
});
