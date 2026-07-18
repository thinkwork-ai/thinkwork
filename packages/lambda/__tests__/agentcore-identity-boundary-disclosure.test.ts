import { describe, expect, it } from "vitest";
import {
  projectIdentityBoundaryResult,
  projectMixedIdentityBoundaryResult,
} from "../lib/agentcore-identity-boundary/disclosure.js";

describe("AgentCore identity boundary disclosure", () => {
  it("returns only allowlisted harmless fields", () => {
    const result = projectIdentityBoundaryResult(
      {
        owner_alias: "alice",
        harmless_value: "fixture-alice",
        private_note: "never expose this",
        secret_sentinel: "SECRET_SENTINEL_ALICE",
      },
      "alice",
    );
    expect(result).toEqual({
      ownerAlias: "alice",
      harmlessValue: "fixture-alice",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|SECRET_SENTINEL/);
  });

  it("fails closed when the returned owner differs", () => {
    expect(() =>
      projectIdentityBoundaryResult(
        { owner_alias: "bob", harmless_value: "fixture-bob" },
        "alice",
      ),
    ).toThrow(/owner/);
  });

  it("publishes the task field and a non-resumable withholding decision only", () => {
    const result = projectMixedIdentityBoundaryResult(
      {
        owner_alias: "alice",
        harmless_value: "fixture-alice",
        task_field: "approved-summary-alice",
        private_note: "never expose this",
        secret_sentinel: "SECRET_SENTINEL_ALICE",
      },
      "alice",
      "4d3219e8-a9be-4a61-b89b-2ec68145711d",
    );
    expect(result).toEqual({
      ownerAlias: "alice",
      taskField: "approved-summary-alice",
      disclosure: {
        decisionId: "4d3219e8-a9be-4a61-b89b-2ec68145711d",
        status: "confirmation_required",
        reasonCode: "unrelated_sensitive_fields_withheld",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|SECRET_SENTINEL/);
  });
});
