import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCodexOneTaskPrompt,
  parseArgs,
  runOpenEngineOneTask,
} from "../open-engine-one-task-runner.mjs";

describe("open-engine-one-task-runner", () => {
  it("parses env and command-line overrides without requiring secrets in args", () => {
    const config = parseArgs(
      [
        "--mode",
        "prepare",
        "--agent",
        "claude",
        "--queue",
        "Claude",
        "--label",
        "Open Engine,Dogfood",
        "--max-docs",
        "2",
        "--standing-context-document",
        "standing-doc-1,standing-doc-2",
        "--routing-map-document",
        "routing-doc",
        "--skill-directory-document",
        "skills-doc",
        "--max-standing-context-docs",
        "3",
      ],
      {
        OPEN_ENGINE_MCP_URL: "https://api.example.com/mcp/open-engine",
        OPEN_ENGINE_BEARER: "secret",
        THINKWORK_TENANT_ID: "tenant-1",
      },
    );

    assert.equal(config.mode, "prepare");
    assert.equal(config.agentId, "claude");
    assert.equal(config.queueKey, "Claude");
    assert.deepEqual(config.labelSlugs, ["Open Engine", "Dogfood"]);
    assert.equal(config.maxDocs, 2);
    assert.deepEqual(config.standingContextDocumentIds, [
      "standing-doc-1",
      "standing-doc-2",
    ]);
    assert.equal(config.routingMapDocumentId, "routing-doc");
    assert.equal(config.skillDirectoryDocumentId, "skills-doc");
    assert.equal(config.maxStandingContextDocs, 3);
  });

  it("verifies the connection without claiming work in verify mode", async () => {
    const client = fakeClient({
      tools: [
        { name: "open_engine_verify_connection" },
        { name: "open_engine_claim_next" },
      ],
      responses: {
        open_engine_verify_connection: {
          ok: true,
          agentResolution: "resolved",
          agent: { id: "agent-1", slug: "codex" },
          queue: { key: "codex" },
        },
      },
    });

    const result = await runOpenEngineOneTask({
      client,
      config: baseConfig({ mode: "verify" }),
      now: new Date("2026-06-28T10:00:00Z"),
    });

    assert.equal(result.status, "verified");
    assert.deepEqual(
      client.calls.map((call) => call.name),
      ["open_engine_verify_connection"],
    );
  });

  it("prepares exactly one claimed Work Item and writes a status ledger", async () => {
    const client = fakeClient({
      tools: [
        { name: "open_engine_verify_connection" },
        { name: "open_engine_queue_snapshot" },
        { name: "open_engine_list_work_items" },
        { name: "open_engine_claim_next" },
        { name: "open_engine_get_context" },
        { name: "open_engine_list_documents" },
        { name: "open_engine_fetch_document" },
        { name: "open_engine_update_status_ledger" },
      ],
      responses: {
        open_engine_verify_connection: {
          ok: true,
          agentResolution: "resolved",
          agent: { id: "agent-1", slug: "codex" },
          queue: { key: "codex" },
        },
        open_engine_queue_snapshot: { snapshot: { counts: { eligible: 1 } } },
        open_engine_list_work_items: {
          workItems: [{ id: "wi-1", title: "Ship runner" }],
        },
        open_engine_claim_next: {
          claimed: {
            id: "wi-1",
            title: "Ship runner",
            openEngine: {
              queueKey: "codex",
              claimExpiresAt: "2026-06-28T10:30:00.000Z",
            },
          },
          receipt: { id: "receipt-1" },
        },
        open_engine_get_context: (args) =>
          args.workItemId === "standing-wi"
            ? {
                ok: true,
                workItem: {
                  id: "standing-wi",
                  title: "OpenEngine standing context",
                },
                labels: [{ slug: "open-engine" }],
                queue: { queueKey: "codex" },
              }
            : {
                ok: true,
                workItem: { id: "wi-1", title: "Ship runner" },
                queue: { queueKey: "codex" },
                labels: [{ slug: "open-engine" }],
                receipts: [],
              },
        open_engine_list_documents: (args) =>
          args.workItemId === "standing-wi"
            ? {
                documents: [
                  {
                    id: "standing-doc",
                    title: "Standing context",
                    previewAvailable: true,
                    binary: false,
                  },
                ],
              }
            : {
                documents: [
                  {
                    id: "doc-1",
                    title: "Handoff",
                    previewAvailable: true,
                    binary: false,
                  },
                  {
                    id: "doc-2",
                    title: "Proof.pdf",
                    previewAvailable: false,
                    binary: true,
                  },
                ],
              },
        open_engine_fetch_document: (args) => ({
          document:
            {
              "standing-doc": {
                id: "standing-doc",
                title: "Standing context",
                content: "Load private setup context before task work.",
              },
              "routing-doc": {
                id: "routing-doc",
                title: "Routing map",
                content: "codex -> Codex queue; claude -> Claude queue.",
              },
              "skills-doc": {
                id: "skills-doc",
                title: "Optional skills",
                content: "Do not install optional skills unless subscribed.",
              },
              "doc-1": {
                id: "doc-1",
                title: "Handoff",
                content: "Do the runner work.",
              },
            }[args.documentId],
        }),
        open_engine_update_status_ledger: {
          status: "checking",
          document: { id: "ledger-1" },
        },
      },
    });

    const result = await runOpenEngineOneTask({
      client,
      config: baseConfig({
        mode: "prepare",
        maxDocs: 5,
        standingContextWorkItemId: "standing-wi",
        routingMapDocumentId: "routing-doc",
        skillDirectoryDocumentId: "skills-doc",
      }),
      now: new Date("2026-06-28T10:00:00Z"),
    });

    assert.equal(result.status, "claimed");
    assert.equal(result.claim.claimed.id, "wi-1");
    assert.match(result.prompt, /Do not use Linear as the runtime queue/);
    assert.match(result.prompt, /Claimed Work Item: wi-1/);
    assert.match(result.prompt, /Standing context/);
    assert.match(result.prompt, /Load private setup context before task work/);
    assert.match(result.prompt, /codex -> Codex queue/);
    assert.match(result.prompt, /Do not install optional skills unless subscribed/);
    assert.deepEqual(
      client.calls.map((call) => call.name),
      [
        "open_engine_verify_connection",
        "open_engine_get_context",
        "open_engine_list_documents",
        "open_engine_fetch_document",
        "open_engine_fetch_document",
        "open_engine_fetch_document",
        "open_engine_queue_snapshot",
        "open_engine_list_work_items",
        "open_engine_claim_next",
        "open_engine_get_context",
        "open_engine_list_documents",
        "open_engine_fetch_document",
        "open_engine_update_status_ledger",
      ],
    );
    const claimCall = client.calls.find(
      (call) => call.name === "open_engine_claim_next",
    );
    assert.equal(claimCall.args.leaseSeconds, 1800);
    assert.ok(
      client.calls.findIndex((call) => call.name === "open_engine_claim_next") >
        client.calls.findIndex(
          (call) =>
            call.name === "open_engine_fetch_document" &&
            call.args.documentId === "skills-doc",
        ),
    );
    const ledgerCall = client.calls.find(
      (call) => call.name === "open_engine_update_status_ledger",
    );
    assert.equal(ledgerCall.args.status, "checking");
    assert.equal(ledgerCall.args.queueResult.promptReady, true);
    assert.equal(ledgerCall.args.queueResult.standingContext.configured, true);
    assert.equal(ledgerCall.args.queueResult.standingContext.documentCount, 3);
  });

  it("does not claim when no eligible work is visible", async () => {
    const client = fakeClient({
      tools: [
        { name: "open_engine_verify_connection" },
        { name: "open_engine_queue_snapshot" },
        { name: "open_engine_list_work_items" },
        { name: "open_engine_claim_next" },
        { name: "open_engine_get_context" },
        { name: "open_engine_list_documents" },
        { name: "open_engine_fetch_document" },
        { name: "open_engine_update_status_ledger" },
      ],
      responses: {
        open_engine_verify_connection: {
          ok: true,
          agentResolution: "resolved",
          agent: { id: "agent-1", slug: "codex" },
          queue: { key: "codex" },
        },
        open_engine_queue_snapshot: { snapshot: { counts: { eligible: 0 } } },
        open_engine_list_work_items: { workItems: [] },
      },
    });

    const result = await runOpenEngineOneTask({
      client,
      config: baseConfig({ mode: "prepare" }),
    });

    assert.equal(result.status, "no_work");
    assert.equal(
      client.calls.some((call) => call.name === "open_engine_claim_next"),
      false,
    );
  });

  it("renders a one-item Codex prompt with final state instructions", () => {
    const prompt = buildCodexOneTaskPrompt({
      config: baseConfig(),
      now: new Date("2026-06-28T10:00:00Z"),
      claim: {
        claimed: {
          id: "wi-1",
          title: "Dogfood the runner",
          openEngine: { claimExpiresAt: "2026-06-28T10:30:00.000Z" },
        },
      },
      context: {
        workItem: { id: "wi-1", title: "Dogfood the runner" },
        queue: { claimExpiresAt: "2026-06-28T10:30:00.000Z" },
        labels: [],
        receipts: [],
      },
      documents: [{ id: "doc-1", title: "Plan", content: "# Plan" }],
      standingContext: {
        configured: true,
        workItemId: "standing-wi",
        context: {
          workItem: { id: "standing-wi", title: "Standing context" },
          labels: [],
          queue: {},
        },
        documents: [
          {
            id: "routing-doc",
            title: "Routing map",
            standingContextRole: "routing_map",
            content: "codex -> Codex queue",
          },
        ],
      },
    });

    assert.match(prompt, /Do not claim another Work Item/);
    assert.match(prompt, /open_engine_update_state/);
    assert.match(prompt, /state `done`/);
    assert.match(prompt, /state `blocked`/);
    assert.match(prompt, /Stop after this one Work Item/);
    assert.match(prompt, /Standing context contract/);
    assert.match(prompt, /skill_subscribed/);
    assert.match(prompt, /routing_map/);
  });
});

function baseConfig(overrides = {}) {
  return {
    mode: "prepare",
    endpoint: "https://api.example.com/mcp/open-engine",
    bearer: "secret",
    tenantId: "tenant-1",
    agentId: "codex",
    queueKey: "codex",
    labelSlugs: [],
    standingContextWorkItemId: undefined,
    standingContextDocumentIds: [],
    routingMapDocumentId: undefined,
    skillDirectoryDocumentId: undefined,
    leaseSeconds: 1800,
    maxDocs: 5,
    maxStandingContextDocs: 5,
    receiptLimit: 25,
    ...overrides,
  };
}

function fakeClient({ tools, responses }) {
  return {
    calls: [],
    async listTools() {
      return tools;
    },
    async callTool(name, args = {}) {
      this.calls.push({ name, args });
      const response = responses[name];
      if (response === undefined) {
        throw new Error(`Unexpected tool call: ${name}`);
      }
      return typeof response === "function" ? response(args) : response;
    },
  };
}
