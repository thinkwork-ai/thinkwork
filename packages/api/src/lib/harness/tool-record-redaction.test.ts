import { describe, expect, it } from "vitest";
import {
  ToolRecordRedactionError,
  redactToolRecord,
} from "./tool-record-redaction.js";

describe("redactToolRecord", () => {
  it("projects only explicitly allowlisted scalar paths", () => {
    expect(
      redactToolRecord(
        {
          operation: "opportunity.list",
          query: { limit: 5, privateFilter: "do-not-persist" },
          records: [
            { id: "opp-1", name: "Renewal", internal: "omit" },
            { id: "opp-2", name: "Expansion", internal: "omit" },
          ],
          ignored: "omit",
        },
        {
          allowPaths: [
            "operation",
            "query.limit",
            "records[].id",
            "records[].name",
          ],
        },
      ),
    ).toEqual({
      operation: "opportunity.list",
      query: { limit: 5 },
      records: [
        { id: "opp-1", name: "Renewal" },
        { id: "opp-2", name: "Expansion" },
      ],
    });
  });

  it("redacts explicit canaries and common credential shapes before persistence", () => {
    const canary = "canary-refresh-token-123";
    const redacted = redactToolRecord(
      {
        summary: `provider failed with Bearer abc.def-123 and ${canary}`,
        jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue",
      },
      {
        allowPaths: ["summary", "jwt"],
        forbiddenValues: [canary],
      },
    );

    expect(JSON.stringify(redacted)).not.toContain(canary);
    expect(JSON.stringify(redacted)).not.toContain("abc.def-123");
    expect(JSON.stringify(redacted)).not.toContain("eyJhbGci");
    expect(redacted).toEqual({
      summary: "provider failed with [REDACTED] and [REDACTED]",
      jwt: "[REDACTED]",
    });
  });

  it("rejects allowlists that name credential-bearing fields", () => {
    for (const path of [
      "authorization",
      "headers.cookie",
      "result.access_token",
      "vaultHandle",
      "clientSecret",
    ]) {
      expect(() =>
        redactToolRecord({ result: {} }, { allowPaths: [path] }),
      ).toThrow(ToolRecordRedactionError);
    }
  });

  it("bounds preview strings and array cardinality", () => {
    expect(
      redactToolRecord(
        {
          summary: "abcdefghij",
          ids: ["1", "2", "3"],
        },
        {
          allowPaths: ["summary", "ids[]"],
          maxStringLength: 5,
          maxArrayLength: 2,
        },
      ),
    ).toEqual({ summary: "abcd…", ids: ["1", "2"] });
  });

  it("refuses object leaves so an allowlist cannot smuggle arbitrary fields", () => {
    expect(() =>
      redactToolRecord(
        { result: { safe: "ok", token: "secret" } },
        { allowPaths: ["result"] },
      ),
    ).toThrow(/scalar leaf/i);
  });
});
