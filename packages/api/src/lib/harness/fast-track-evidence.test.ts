import { describe, expect, it } from "vitest";
import {
  assertAllowedGatewayPolicyEvidence,
  collectGatewayPolicyDecisionsForTurn,
  parseGatewayApplicationLog,
} from "./fast-track-evidence.js";

const TURN_ID = "da0d8a87-2860-47b3-9ba0-eb60a83e09c7";
const TRACE_ID = "6a5ba9966e6c78b35b859c583c3b1794";

function requestRecord() {
  return {
    event_timestamp: 100,
    request_id: "request-start",
    trace_id: TRACE_ID,
    body: {
      log: "Started processing request",
      requestBody: `{_meta={harness.id=h-1,session.id=tw-harness-turn-${TURN_ID}}}`,
    },
  };
}

function decisionRecord(decision: "ALLOW" | "DENY" = "ALLOW") {
  return {
    event_timestamp: 110,
    request_id: "request-policy",
    trace_id: TRACE_ID,
    body: {
      id: "request-policy",
      log: "Policy evaluation completed",
      policy: {
        decision,
        policyEngineArn: "arn:aws:bedrock-agentcore:region:account:policy-engine/e-1",
        determiningPolicies: ["ThinkworkDevOwnerIsolation-p-1"],
        principal: {
          entityType: "AgentCore::OAuthUser",
          entityId: "user-1",
        },
        latencyMs: 74,
      },
    },
  };
}

describe("fast-track Gateway evidence", () => {
  it("parses CloudWatch JSON and correlates session -> trace -> Cedar decision", () => {
    const records = [requestRecord(), decisionRecord()];
    expect(collectGatewayPolicyDecisionsForTurn(records, TURN_ID)).toEqual([
      expect.objectContaining({
        decisionId: "request-policy",
        requestId: "request-policy",
        traceId: TRACE_ID,
        decision: "ALLOW",
        determiningPolicies: ["ThinkworkDevOwnerIsolation-p-1"],
        principalType: "AgentCore::OAuthUser",
        principalId: "user-1",
        latencyMs: 74,
      }),
    ]);
    expect(
      parseGatewayApplicationLog(JSON.stringify(requestRecord())),
    ).toEqual(requestRecord());
  });

  it("does not correlate a policy event by time or target claims alone", () => {
    expect(collectGatewayPolicyDecisionsForTurn([decisionRecord()], TURN_ID)).toEqual(
      [],
    );
    expect(
      collectGatewayPolicyDecisionsForTurn(
        [
          {
            ...requestRecord(),
            body: {
              requestBody: "{session.id=tw-harness-turn-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}",
            },
          },
          decisionRecord(),
        ],
        TURN_ID,
      ),
    ).toEqual([]);
  });

  it("fails closed for missing, denied, or unexpected policy evidence", () => {
    expect(() =>
      assertAllowedGatewayPolicyEvidence({ records: [], turnId: TURN_ID }),
    ).toThrow(/No service-owned/);
    expect(() =>
      assertAllowedGatewayPolicyEvidence({
        records: [requestRecord(), decisionRecord("DENY")],
        turnId: TURN_ID,
      }),
    ).toThrow(/denied/);
    expect(() =>
      assertAllowedGatewayPolicyEvidence({
        records: [requestRecord(), decisionRecord()],
        turnId: TURN_ID,
        expectedPolicyArnOrId: "wrong-policy",
      }),
    ).toThrow(/did not name/);
  });

  it("rejects malformed evidence instead of weakening the assertion", () => {
    expect(() => parseGatewayApplicationLog("not-json")).toThrow(/valid JSON/);
    expect(() =>
      collectGatewayPolicyDecisionsForTurn(
        [requestRecord(), { ...decisionRecord(), request_id: null }],
        TURN_ID,
      ),
    ).toThrow(/request_id/);
  });
});
