import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CapabilityRunEvidence } from "./CapabilityRunEvidence";

afterEach(cleanup);

describe("CapabilityRunEvidence", () => {
  it("renders nothing for an ordinary (non-capability) run", () => {
    const { container } = render(
      <CapabilityRunEvidence readinessOutcome={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("labels blocked/degraded/indeterminate with text, not color alone", () => {
    for (const [outcome, label] of [
      ["blocked", "Blocked"],
      ["degraded", "Degraded"],
      ["indeterminate", "Indeterminate"],
      ["ready", "Ready"],
    ] as const) {
      cleanup();
      render(
        <CapabilityRunEvidence
          readinessOutcome={outcome}
          brokerSessionId="s1"
        />,
      );
      // A text label (not merely a color) conveys the outcome — the plan's
      // non-color-only requirement.
      expect(screen.getByTestId("capability-readiness-label").textContent).toBe(
        label,
      );
    }
  });

  it("renders remediation adjacent to the outcome for a blocked run", () => {
    render(
      <CapabilityRunEvidence
        readinessOutcome="blocked"
        brokerSessionId="s1"
        remediation={{
          message: "Service binding revoked — re-verify the GitHub connection.",
        }}
      />,
    );
    expect(screen.getByTestId("capability-remediation").textContent).toMatch(
      /re-verify the GitHub connection/i,
    );
  });

  it("accepts AWSJSON as a stringified scalar", () => {
    render(
      <CapabilityRunEvidence
        readinessOutcome="degraded"
        executionPrincipal={JSON.stringify({
          mode: "service",
          subjectId: "sp-1",
        })}
        capabilityDependencies={JSON.stringify([
          {
            twcap: "twcap:acme/connection/github-rest@1#issues.list",
            contractHash: "abc123def456",
          },
        ])}
        remediation={JSON.stringify({ reason: "binding degraded" })}
        brokerSessionId="s1"
      />,
    );
    expect(screen.getByText(/principal: service/)).toBeTruthy();
    expect(screen.getByText(/issues\.list/)).toBeTruthy();
    expect(screen.getByTestId("capability-remediation").textContent).toMatch(
      /binding degraded/,
    );
  });

  it("lists broker calls with status and effect", () => {
    render(
      <CapabilityRunEvidence
        readinessOutcome="ready"
        brokerSessionId="s1"
        brokerCalls={[
          {
            id: "c1",
            clientRequestId: "r1",
            operationRef: "twcap:acme/connection/github-rest@1#issues.list",
            status: "completed",
            effect: "read",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Broker calls \(1\)/)).toBeTruthy();
    expect(screen.getByText(/completed/)).toBeTruthy();
  });
});
