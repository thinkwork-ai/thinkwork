import { describe, expect, it } from "vitest";

import {
  applyPreflightBlock,
  evaluatePreflight,
  preflightMarker,
} from "../src/linear/preflight.js";
import { FakeGateway, makeIssue } from "./fake-gateway.js";

describe("evaluatePreflight", () => {
  it("blocks issues whose text touches .github/workflows (AE3)", () => {
    const decision = evaluatePreflight({
      title: "Fix deploy pipeline",
      description:
        "Update .github/workflows/deploy.yml to add a migration gate step.",
    });
    expect(decision.blocked).toBe(true);
    expect(decision.label).toBe("Needs Credentials");
    expect(decision.reason).toContain(".github/workflows");
  });

  it("blocks on workflow phrasing even without the literal path", () => {
    const decision = evaluatePreflight({
      title: "Add caching to the GitHub Actions workflow",
      description: "Speed up CI.",
    });
    expect(decision.blocked).toBe(true);
  });

  it("blocks credential-needing work", () => {
    for (const text of [
      "Rotate the Slack bot token before the demo",
      "Create a new OAuth app for Google Workspace",
      "Store the customer's API key in Secrets Manager",
      "Provision a service account for BigQuery access",
    ]) {
      const decision = evaluatePreflight({ title: text, description: "" });
      expect(decision.blocked, text).toBe(true);
      expect(decision.label, text).toBe("Needs Credentials");
    }
  });

  it("passes ordinary feature work", () => {
    const decision = evaluatePreflight({
      title: "Add sort order to the artifacts list",
      description: "Table should sort by updated_at descending by default.",
    });
    expect(decision).toEqual({ blocked: false, label: null, reason: null });
  });
});

describe("applyPreflightBlock", () => {
  it("applies blocker label + ONE comment before any launch, idempotent across repeated polls", async () => {
    const issue = makeIssue({
      identifier: "T-3",
      state: "Ready to Work",
      labels: ["Claude"],
      description: "edit .github/workflows/ci.yml",
    });
    const gateway = new FakeGateway([issue]);
    const decision = evaluatePreflight(issue);
    expect(decision.blocked).toBe(true);

    // First poll applies both writes.
    const wrote = await applyPreflightBlock(
      gateway,
      issue,
      issue.comments,
      decision,
    );
    expect(wrote).toBe(true);
    expect(issue.labels).toContain("Needs Credentials");
    const marked = issue.comments.filter((c) =>
      c.body.includes(preflightMarker("T-3")),
    );
    expect(marked).toHaveLength(1);
    expect(marked[0].body).toContain("No worker was launched");

    // Repeated polls: label + comment already present → nothing written.
    const again = await applyPreflightBlock(
      gateway,
      issue,
      issue.comments,
      decision,
    );
    expect(again).toBe(false);
    expect(gateway.writesOf("addLabel")).toHaveLength(1);
    expect(gateway.writesOf("createComment")).toHaveLength(1);
    expect(
      issue.comments.filter((c) => c.body.includes(preflightMarker("T-3"))),
    ).toHaveLength(1);
  });

  it("re-adds only the missing half (comment exists, label was removed)", async () => {
    const issue = makeIssue({
      identifier: "T-4",
      state: "Ready to Work",
      labels: ["Claude"],
      comments: [
        { id: "c-1", body: `${preflightMarker("T-4")}\n\nolder block comment` },
      ],
    });
    const gateway = new FakeGateway([issue]);
    const decision = evaluatePreflight({
      title: "touch .github/workflows",
      description: "",
    });

    const wrote = await applyPreflightBlock(
      gateway,
      issue,
      issue.comments,
      decision,
    );
    expect(wrote).toBe(true);
    expect(gateway.writesOf("addLabel")).toHaveLength(1);
    expect(gateway.writesOf("createComment")).toHaveLength(0); // no second comment
  });

  it("does nothing for an unblocked decision", async () => {
    const issue = makeIssue({
      identifier: "T-5",
      state: "Ready to Work",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const wrote = await applyPreflightBlock(gateway, issue, issue.comments, {
      blocked: false,
      label: null,
      reason: null,
    });
    expect(wrote).toBe(false);
    expect(gateway.writes).toEqual([]);
  });
});
