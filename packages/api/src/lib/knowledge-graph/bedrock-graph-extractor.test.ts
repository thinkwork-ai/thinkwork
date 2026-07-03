import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractGraphFromPackets,
  KG_EXTRACTION_MAX_TOKENS,
  kgExtractionBatchSize,
  kgExtractionModelId,
} from "./bedrock-graph-extractor.js";
import { normalizeCogneeGraph } from "./normalizer.js";
import type { KnowledgeGraphOntologyExport } from "./ontology-export.js";
import type { ThreadTranscriptMessage } from "./thread-transcript.js";
import type { KnowledgeGraphSourcePacket } from "./source-adapters.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const ONTOLOGY: KnowledgeGraphOntologyExport = {
  mechanism: "custom_prompt",
  entityTypes: [
    { id: "t1", slug: "company", name: "Company", description: null, aliases: [] },
    { id: "t2", slug: "person", name: "Person", description: null, aliases: [] },
    { id: "t3", slug: "opportunity", name: "Opportunity", description: null, aliases: [] },
  ],
  relationshipTypes: [
    {
      id: "r1",
      slug: "works_at",
      name: "Works at",
      description: null,
      aliases: [],
      sourceTypeSlugs: ["person"],
      targetTypeSlugs: ["company"],
    },
  ],
  customPrompt: "",
  ontologyKey: null,
  ontologyOwlXml: null,
};

function packet(id: string, text: string): KnowledgeGraphSourcePacket {
  return {
    id,
    title: id,
    entityTypeSlug: null,
    trustedOntologyType: false,
    text,
    metadata: {},
  };
}

function observationEvidence(
  id: string,
  text: string,
  ordinal: number,
): ThreadTranscriptMessage {
  return {
    id,
    role: "source",
    senderType: "observation",
    senderId: null,
    speakerLabel: "Observation",
    text,
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    ordinal,
    evidenceSourceKind: "hindsight_observation",
    evidenceSourceRef: id,
    evidenceMetadata: {},
  };
}

function invokeReturning(parsedSequence: unknown[], stopReason = "end_turn") {
  const mock = vi.fn();
  for (const parsed of parsedSequence) {
    if (parsed instanceof Error) {
      mock.mockRejectedValueOnce(parsed);
    } else {
      mock.mockResolvedValueOnce({
        parsed,
        text: "",
        inputTokens: 100,
        outputTokens: 200,
        modelId: "test-model",
        stopReason,
        retries: 0,
      });
    }
  }
  return mock;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractGraphFromPackets", () => {
  it("Covers AE1: extracts typed entities and a labeled relationship the real normalizer grounds", async () => {
    const text =
      "Acme Corp is our key manufacturing customer; Jane Doe leads the renewal.";
    const invoke = invokeReturning([
      {
        entities: [
          { id: "e1", label: "Acme Corp", type: "company" },
          { id: "e2", label: "Jane Doe", type: "person" },
        ],
        relationships: [
          { source: "e2", target: "e1", label: "works at", type: "works_at" },
        ],
      },
    ]);

    const result = await extractGraphFromPackets({
      packets: [packet("obs-1", text)],
      ontology: ONTOLOGY,
      invoke: invoke as never,
    });

    expect(result.batchesDropped).toBe(0);
    expect(result.payload.nodes).toHaveLength(2);
    expect(result.payload.edges).toHaveLength(1);

    // Round-trip through the REAL frozen normalizer: labels are verbatim
    // substrings of the observation text, so provenance grounds strong and
    // the evidence rows reference the observation id.
    const snapshot = normalizeCogneeGraph({
      graph: result.payload,
      transcript: [observationEvidence("obs-1", text, 0)],
      ontology: ONTOLOGY,
    });
    expect(snapshot.entities).toHaveLength(2);
    expect(
      snapshot.entities.every((entity) => entity.groundingStatus === "grounded"),
    ).toBe(true);
    expect(
      snapshot.entities.every(
        (entity) => entity.provenanceStatus === "strong",
      ),
    ).toBe(true);
    expect(snapshot.relationships).toHaveLength(1);
    expect(snapshot.relationships[0]?.groundingStatus).toBe("grounded");
    expect(
      snapshot.evidence.every(
        (evidence) =>
          evidence.sourceKind === "hindsight_observation" &&
          evidence.sourceRef === "obs-1",
      ),
    ).toBe(true);
  });

  it("Covers AE2: a malformed batch contributes nothing; other batches land; drops surface", async () => {
    vi.stubEnv("KG_EXTRACTION_BATCH_SIZE", "1");
    const invoke = invokeReturning([
      { entities: [{ id: "e1", label: "Acme Corp", type: "company" }], relationships: [] },
      "not-an-object",
      new Error("BedrockRetryExhausted"),
    ]);

    const result = await extractGraphFromPackets({
      packets: [packet("p1", "Acme Corp"), packet("p2", "x"), packet("p3", "y")],
      ontology: ONTOLOGY,
      invoke: invoke as never,
    });

    expect(result.batchesTotal).toBe(3);
    expect(result.batchesDropped).toBe(2);
    expect(result.batchesTruncated).toBe(0);
    expect(result.payload.nodes.map((node) => node.label)).toEqual(["Acme Corp"]);
  });

  it("treats max_tokens truncation as a distinct dropped outcome", async () => {
    const invoke = invokeReturning(
      [{ entities: [{ id: "e1", label: "Acme Corp", type: "company" }], relationships: [] }],
      "max_tokens",
    );
    const result = await extractGraphFromPackets({
      packets: [packet("p1", "Acme Corp")],
      ontology: ONTOLOGY,
      invoke: invoke as never,
    });
    expect(result.batchesDropped).toBe(1);
    expect(result.batchesTruncated).toBe(1);
    expect(result.payload.nodes).toHaveLength(0);
  });

  it("unapproved types pass the extractor but are dropped by the normalizer gate (second net)", async () => {
    const invoke = invokeReturning([
      {
        entities: [{ id: "e1", label: "Mystery Blob", type: "spaceship" }],
        relationships: [],
      },
    ]);
    const result = await extractGraphFromPackets({
      packets: [packet("p1", "Mystery Blob docked.")],
      ontology: ONTOLOGY,
      invoke: invoke as never,
    });
    expect(result.payload.nodes).toHaveLength(1);

    const snapshot = normalizeCogneeGraph({
      graph: result.payload,
      transcript: [observationEvidence("p1", "Mystery Blob docked.", 0)],
      ontology: ONTOLOGY,
    });
    expect(snapshot.entities).toHaveLength(0);
    expect(snapshot.metrics.unapprovedNodeCount).toBe(1);
  });

  it("dedupes cross-batch duplicate labels onto one node and remaps edges", async () => {
    vi.stubEnv("KG_EXTRACTION_BATCH_SIZE", "1");
    const invoke = invokeReturning([
      {
        entities: [{ id: "e1", label: "Acme Corp", type: "company" }],
        relationships: [],
      },
      {
        entities: [
          { id: "e1", label: "acme corp", type: "company" },
          { id: "e2", label: "Jane Doe", type: "person" },
        ],
        relationships: [
          { source: "e2", target: "e1", label: "works at", type: "works_at" },
        ],
      },
    ]);

    const result = await extractGraphFromPackets({
      packets: [packet("p1", "Acme Corp"), packet("p2", "acme corp and Jane Doe")],
      ontology: ONTOLOGY,
      invoke: invoke as never,
    });

    expect(result.payload.nodes).toHaveLength(2);
    const acmeId = result.payload.nodes.find(
      (node) => node.label === "Acme Corp",
    )!.id;
    expect(result.payload.edges[0]?.target).toBe(acmeId);
  });

  it("reads model id and batch size from the single config point with env override", async () => {
    expect(kgExtractionModelId()).toBe("openai.gpt-oss-120b-1:0");
    expect(kgExtractionBatchSize()).toBe(12);
    vi.stubEnv("KG_EXTRACTION_MODEL_ID", "moonshotai.kimi-k2.5");
    vi.stubEnv("KG_EXTRACTION_BATCH_SIZE", "5");
    expect(kgExtractionModelId()).toBe("moonshotai.kimi-k2.5");
    expect(kgExtractionBatchSize()).toBe(5);

    const invoke = invokeReturning([{ entities: [], relationships: [] }]);
    await extractGraphFromPackets({
      packets: [packet("p1", "x")],
      ontology: ONTOLOGY,
      invoke: invoke as never,
    });
    expect(invoke.mock.calls[0]![0]).toMatchObject({
      modelId: "moonshotai.kimi-k2.5",
      maxTokens: KG_EXTRACTION_MAX_TOKENS,
    });
  });

  it("golden set fixture is well-formed and labels are verbatim substrings of packet text", () => {
    const golden = JSON.parse(
      readFileSync(
        join(HERE, "golden-set", "brain-extraction-golden-set.json"),
        "utf-8",
      ),
    ) as {
      packets: Array<{ id: string; text: string }>;
      expected_entities: string[];
      junk_entities_must_not_appear: string[];
      expected_relationships: Array<{ source: string; target: string }>;
    };

    expect(golden.packets.length).toBeGreaterThanOrEqual(10);
    expect(golden.expected_entities.length).toBeGreaterThanOrEqual(8);
    const corpus = golden.packets.map((p) => p.text).join("\n");
    // Verbatim-label provenance rule: every expected entity must appear
    // verbatim in some packet, or the live gate would demand labels the
    // normalizer cannot ground.
    for (const label of golden.expected_entities) {
      expect(corpus).toContain(label);
    }
    for (const rel of golden.expected_relationships) {
      expect(golden.expected_entities).toContain(rel.source);
      expect(golden.expected_entities).toContain(rel.target);
    }
    // No expected entity is also listed as junk.
    for (const junk of golden.junk_entities_must_not_appear) {
      expect(
        golden.expected_entities.map((e) => e.toLowerCase()),
      ).not.toContain(junk.toLowerCase());
    }
  });
});
