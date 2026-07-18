import { describe, expect, it } from "vitest";
import { enforceGovernedActionGrounding } from "./governed-action-grounding.js";

describe("enforceGovernedActionGrounding", () => {
  it("replaces an ungrounded email success claim", () => {
    const response = {
      content:
        "Email sent (pending approval). It has been submitted to policy.",
      diagnostics: {},
    };

    enforceGovernedActionGrounding(response, []);

    expect(response.content).toBe(
      "I could not submit that email. No governed email action was recorded, so nothing was sent or queued for approval.",
    );
    expect(response.diagnostics).toMatchObject({
      governed_action_grounding: {
        corrected: true,
        operation: "email.send",
        evidence_status: "missing",
      },
    });
  });

  it("turns contradictory sent prose into a canonical pending-review status", () => {
    const response = {
      content: "Email sent. It is pending approval.",
      diagnostics: {},
    };

    enforceGovernedActionGrounding(response, [
      {
        operation: "email.send",
        status: "completed",
        output_preview: JSON.stringify({
          status: "pending_review",
          inboxItemId: "approval-1",
          approvalUrl: "/approvals/approval-1",
        }),
      },
    ]);

    expect(response.content).toContain("Nothing has been sent yet");
    expect(response.content).toContain("/approvals/approval-1");
  });

  it("preserves a grounded pending-review claim", () => {
    const response = {
      content: "The email draft is awaiting approval.",
      diagnostics: {},
    };

    enforceGovernedActionGrounding(response, [
      {
        operation: "email.send",
        status: "completed",
        output_preview: JSON.stringify({ status: "pending_review" }),
      },
    ]);

    expect(response.content).toBe("The email draft is awaiting approval.");
    expect(response.diagnostics).toEqual({});
  });

  it("preserves an explicit failure statement without evidence", () => {
    const response = {
      content: "The email was not sent because no connector was available.",
      diagnostics: {},
    };

    enforceGovernedActionGrounding(response, []);

    expect(response.content).toContain("was not sent");
    expect(response.diagnostics).toEqual({});
  });
});
