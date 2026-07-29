/**
 * THINK-404 — the namespace contract between AgentCore's managed
 * extraction strategies and this adapter's reads.
 *
 * The strategies provisioned in
 * `terraform/modules/app/agentcore-memory/scripts/create_or_find_memory.sh`
 * extract into `assistant_{actorId}`, `preferences_{actorId}`,
 * `session_{sessionId}` and `episodes_{actorId}/{sessionId}`. Before this
 * change the adapter read `user_{actorId}` and `preferences_user_{actorId}`
 * — the latter matches nothing at all, and the former only ever held
 * direct `remember` writes. These tests pin the corrected read set so the
 * mismatch can't come back silently.
 */

import {
  BedrockAgentCoreClient,
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentCoreAdapter, strategyForNamespace } from "./agentcore-adapter.js";

const ACClient = mockClient(BedrockAgentCoreClient);

const ACTOR = "user-uuid-1";
const OWNER = {
  tenantId: "tenant-1",
  ownerType: "user" as const,
  ownerId: ACTOR,
};

function adapter() {
  return new AgentCoreAdapter({ memoryId: "mem-123", region: "us-east-1" });
}

beforeEach(() => ACClient.reset());
afterEach(() => ACClient.reset());

describe("strategyForNamespace", () => {
  it("maps each provisioned namespace template to its strategy", () => {
    expect(strategyForNamespace(`assistant_${ACTOR}`)).toBe("semantic");
    expect(strategyForNamespace(`preferences_${ACTOR}`)).toBe("preferences");
    expect(strategyForNamespace("session_thread-9")).toBe("summaries");
    expect(strategyForNamespace(`episodes_${ACTOR}/thread-9`)).toBe("episodes");
    expect(strategyForNamespace(`user_${ACTOR}`)).toBe("semantic");
  });

  it("treats the session-less episodic namespace as reflections", () => {
    // `episodes_{actorId}/` is the reflectionConfiguration namespace — the
    // missing session segment is the only signal that distinguishes a
    // cross-session reflection from a per-session episode.
    expect(strategyForNamespace(`episodes_${ACTOR}/`)).toBe("reflections");
  });

  it("falls back for namespaces it doesn't recognise", () => {
    expect(strategyForNamespace("something_else", "custom")).toBe("custom");
  });
});

describe("recall", () => {
  it("fans out over the actor-scoped namespaces the strategies write to", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });

    await adapter().recall({ ...OWNER, query: "coffee" });

    const namespaces = ACClient.commandCalls(RetrieveMemoryRecordsCommand).map(
      (c) => c.args[0].input.namespace,
    );
    expect(namespaces.sort()).toEqual([
      `assistant_${ACTOR}`,
      `preferences_${ACTOR}`,
      `user_${ACTOR}`,
    ]);
    // The dead `preferences_user_*` namespace must never be queried again.
    expect(namespaces).not.toContain(`preferences_user_${ACTOR}`);
    // Session-scoped namespaces stay out of default recall.
    expect(namespaces.some((n) => n?.startsWith("session_"))).toBe(false);
    expect(namespaces.some((n) => n?.startsWith("episodes_"))).toBe(false);
  });

  it("derives each record's strategy from the namespace it came back under", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `assistant_${ACTOR}`,
    }).resolves({
      memoryRecordSummaries: [
        {
          memoryRecordId: "rec-1",
          content: { text: "Drinks oat milk" },
          namespaces: [`assistant_${ACTOR}`],
          score: 0.9,
        } as never,
      ],
    });
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `preferences_${ACTOR}`,
    }).resolves({
      memoryRecordSummaries: [
        {
          memoryRecordId: "rec-2",
          content: { text: "Prefers dark mode" },
          namespaces: [`preferences_${ACTOR}`],
          score: 0.5,
        } as never,
      ],
    });
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `user_${ACTOR}`,
    }).resolves({ memoryRecordSummaries: [] });

    const results = await adapter().recall({ ...OWNER, query: "x" });

    expect(results.map((r) => r.record.strategy)).toEqual([
      "semantic",
      "preferences",
    ]);
    // Highest score first.
    expect(results[0]!.record.content.text).toBe("Drinks oat milk");
  });

  it("dedupes records returned by more than one namespace, keeping the best score", async () => {
    const summary = (score: number) => ({
      memoryRecordId: "rec-dup",
      content: { text: "Same fact" },
      namespaces: [`assistant_${ACTOR}`],
      score,
    });
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `assistant_${ACTOR}`,
    }).resolves({ memoryRecordSummaries: [summary(0.4) as never] });
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `user_${ACTOR}`,
    }).resolves({ memoryRecordSummaries: [summary(0.8) as never] });
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `preferences_${ACTOR}`,
    }).resolves({ memoryRecordSummaries: [] });

    const results = await adapter().recall({ ...OWNER, query: "x" });

    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(0.8);
  });

  it("keeps namespaces failing independently", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `assistant_${ACTOR}`,
    }).rejects(new Error("ResourceNotFoundException"));
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `preferences_${ACTOR}`,
    }).resolves({
      memoryRecordSummaries: [
        {
          memoryRecordId: "rec-9",
          content: { text: "Survived" },
          namespaces: [`preferences_${ACTOR}`],
        } as never,
      ],
    });
    ACClient.on(RetrieveMemoryRecordsCommand, {
      namespace: `user_${ACTOR}`,
    }).rejects(new Error("boom"));

    const results = await adapter().recall({ ...OWNER, query: "x" });
    expect(results.map((r) => r.record.content.text)).toEqual(["Survived"]);
  });
});

describe("inspect", () => {
  it("lists the same actor-scoped namespaces and derives strategies", async () => {
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });
    ACClient.on(ListMemoryRecordsCommand, {
      namespace: `preferences_${ACTOR}`,
    }).resolves({
      memoryRecordSummaries: [
        {
          memoryRecordId: "rec-p",
          content: { text: "Likes terse answers" },
          namespaces: [`preferences_${ACTOR}`],
        } as never,
      ],
    });

    const records = await adapter().inspect(OWNER);

    const namespaces = ACClient.commandCalls(ListMemoryRecordsCommand).map(
      (c) => c.args[0].input.namespace,
    );
    expect(namespaces.sort()).toEqual([
      `assistant_${ACTOR}`,
      `preferences_${ACTOR}`,
      `user_${ACTOR}`,
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]!.strategy).toBe("preferences");
  });
});

describe("listEpisodicRecords", () => {
  it("prefix-lists the actor's episodic namespace and tags reflections", async () => {
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [
        {
          memoryRecordId: "ep-1",
          content: { text: "Debugged the deploy" },
          namespaces: [`episodes_${ACTOR}/thread-3`],
        } as never,
        {
          memoryRecordId: "ep-2",
          content: { text: "Tends to ship on Fridays" },
          namespaces: [`episodes_${ACTOR}/`],
        } as never,
      ],
    });

    const records = await adapter().listEpisodicRecords(OWNER);

    const input = ACClient.commandCalls(ListMemoryRecordsCommand)[0]!.args[0]
      .input;
    expect(input.namespacePath).toBe(`episodes_${ACTOR}/`);
    expect(input.namespace).toBeUndefined();
    expect(records.map((r) => r.strategy)).toEqual(["episodes", "reflections"]);
  });

  it("returns empty rather than throwing when the listing fails", async () => {
    ACClient.on(ListMemoryRecordsCommand).rejects(new Error("nope"));
    await expect(adapter().listEpisodicRecords(OWNER)).resolves.toEqual([]);
  });
});
