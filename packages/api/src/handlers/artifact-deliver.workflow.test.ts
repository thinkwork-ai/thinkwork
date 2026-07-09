import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  inserts: [] as Record<string, unknown>[],
  sesSend: vi.fn(),
  getOrCreateArtifactShare: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        innerJoin: () => chain,
        limit: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
        then: (resolve: (rows: unknown[]) => void) =>
          resolve(mocks.selectQueue.shift() ?? []),
      };
      return chain;
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push(values);
        return Promise.resolve([]);
      },
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  artifacts: { id: "a.id", tenant_id: "a.tenant" },
  agents: {},
  agentCapabilities: { agent_id: "ac.agent_id" },
  agentLoops: { run_as_user_id: "al.run_as" },
  emailLedgerEvents: {
    id: "ele.id",
    tenant_id: "ele.tenant",
    event_type: "ele.type",
    metadata: "ele.metadata",
  },
  workflows: { id: "w.id" },
  workflowRuns: { id: "wr.id", tenant_id: "wr.tenant", workflow_id: "wr.wf" },
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getApiAuthSecret: () => "secret",
  getConfig: mocks.getConfig,
}));

vi.mock("../lib/artifacts/payload-storage.js", () => ({
  isArtifactPayloadS3Key: () => false,
  readArtifactPayloadFromS3: vi.fn(),
}));

vi.mock("../lib/artifacts/share-links.js", () => ({
  getOrCreateArtifactShare: mocks.getOrCreateArtifactShare,
}));

vi.mock("../lib/artifacts/share-tokens.js", () => ({
  signShareToken: (id: string) => `signed-${id}`,
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mocks.sesSend;
  },
  SendRawEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

// eslint-disable-next-line import/first
import { handler } from "./artifact-deliver.js";

const ARTIFACT_ROW = {
  id: "art-42",
  tenant_id: "tenant-1",
  title: "Weekly Pipeline Report",
  type: "report",
  status: "final",
  content: "# Pipeline\n\nAll good.",
  summary: "Weekly summary",
  metadata: { kind: "document" },
  s3_key: null,
  agent_id: null,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    workflowDelivery: {
      tenantId: "tenant-1",
      artifactId: "art-42",
      recipients: ["ops@example.com", "ceo@example.com"],
      subjectTemplate: null,
      idempotencyKey: "workflow-run:run-1",
      workflowRunId: "run-1",
      ...overrides,
    },
  } as never;
}

beforeEach(() => {
  mocks.selectQueue.length = 0;
  mocks.inserts.length = 0;
  mocks.sesSend.mockReset().mockResolvedValue({ MessageId: "ses-123" });
  mocks.getOrCreateArtifactShare
    .mockReset()
    .mockResolvedValue({ shareId: "share-1", created: true });
  mocks.getConfig
    .mockReset()
    .mockImplementation((key: string) =>
      key === "THINKWORK_API_URL" ? "https://api.example.com/" : null,
    );
});

describe("artifact-deliver workflow-delivery mode (THINK-227 U5)", () => {
  it("sends inline HTML + share link and records attempted/succeeded ledger events", async () => {
    mocks.selectQueue.push(
      [], // no prior send (idempotency)
      [ARTIFACT_ROW],
      [{ run_as_user_id: "user-9" }], // acting user chain
    );
    const result = (await handler(request())) as Record<string, unknown>;
    expect(result).toMatchObject({
      ok: true,
      delivery: "sent",
      recipients: ["ops@example.com", "ceo@example.com"],
      shareUrl: "https://api.example.com/share/signed-share-1",
    });
    expect(mocks.getOrCreateArtifactShare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        artifactId: "art-42",
        createdBy: "user-9",
      }),
    );
    expect(mocks.sesSend).toHaveBeenCalledTimes(1);
    const raw = new TextDecoder().decode(
      (
        mocks.sesSend.mock.calls[0][0] as {
          input: { RawMessage: { Data: Uint8Array } };
        }
      ).input.RawMessage.Data,
    );
    expect(raw).toContain("To: ops@example.com, ceo@example.com");
    expect(raw).toContain("https://api.example.com/share/signed-share-1");
    expect(raw).toContain("View the live report");

    const eventTypes = mocks.inserts.map((row) => row.event_type);
    expect(eventTypes).toEqual(["send_attempted", "send_succeeded"]);
    expect(mocks.inserts[1]).toMatchObject({
      provider_message_id: "ses-123",
      to_emails: ["ops@example.com", "ceo@example.com"],
      metadata: expect.objectContaining({
        idempotencyKey: "workflow-run:run-1",
        workflowRunId: "run-1",
        shareId: "share-1",
      }),
    });
  });

  it("skips as duplicate when the ledger already holds a send for the key (KTD8)", async () => {
    mocks.selectQueue.push([{ id: "prior-ledger-row" }]);
    const result = (await handler(request())) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, delivery: "skipped_duplicate" });
    expect(mocks.sesSend).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });

  it("records send_failed and returns the error when SES rejects (AE4 — honest failure)", async () => {
    mocks.selectQueue.push([], [ARTIFACT_ROW], [{ run_as_user_id: "user-9" }]);
    mocks.sesSend.mockRejectedValue(new Error("Email address is not verified"));
    const result = (await handler(request())) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false });
    expect(String(result.error)).toContain("not verified");
    const eventTypes = mocks.inserts.map((row) => row.event_type);
    expect(eventTypes).toEqual(["send_attempted", "send_failed"]);
    expect(mocks.inserts[1]).toMatchObject({ reason_code: "ses_send_failed" });
  });

  it("rejects malformed recipients and header-injection subjects before any send", async () => {
    const badRecipient = (await handler(
      request({ recipients: ["not-an-email"] }),
    )) as Record<string, unknown>;
    expect(badRecipient.ok).toBe(false);

    mocks.selectQueue.push([], [ARTIFACT_ROW], [{ run_as_user_id: "user-9" }]);
    const injected = (await handler(
      request({ subjectTemplate: "hi\r\nBcc: evil@example.com" }),
    )) as Record<string, unknown>;
    expect(injected.ok).toBe(false);
    expect(String(injected.error)).toContain("line breaks");
    expect(mocks.sesSend).not.toHaveBeenCalled();
  });

  it("fails with a configuration error when the automation has no run-as user", async () => {
    mocks.selectQueue.push([], [ARTIFACT_ROW], []); // no acting-user row
    const result = (await handler(request())) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("run-as user");
    expect(mocks.sesSend).not.toHaveBeenCalled();
  });
});
