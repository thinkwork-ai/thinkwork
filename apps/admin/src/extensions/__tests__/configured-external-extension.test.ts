import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  filterRuns,
  graphQLError,
  stateBadgeClass,
} from "../configured-external-extension";

const extensionSource = readFileSync(
  resolve(__dirname, "../configured-external-extension.tsx"),
  "utf8",
);

const sampleRuns = [
  {
    id: "run_01",
    issueId: "issue_188",
    identifier: "GH-188",
    issueTitle: "Wire Slack approval webhook into deployment checklist",
    attempt: 1,
    rotationCounter: 0,
    currentState: "invoking_agent",
    outcome: null,
    errorClass: null,
    sessionStartedAt: null,
    lastUsageEventAt: null,
  },
  {
    id: "run_02",
    issueId: "issue_171",
    identifier: "GH-171",
    issueTitle: "Refresh agent skill catalog seed data",
    attempt: 1,
    rotationCounter: 0,
    currentState: "terminal",
    outcome: "merged",
    errorClass: null,
    sessionStartedAt: null,
    lastUsageEventAt: null,
  },
];

describe("ConfiguredExternalExtension", () => {
  it("ships a native Symphony dashboard instead of an embedded launcher", () => {
    expect(extensionSource).toContain(
      "VITE_ADMIN_EXTENSION_SAMPLE_GRAPHQL_URL",
    );
    expect(extensionSource).toContain("currentQueue");
    expect(extensionSource).toContain("dispatchState");
    expect(extensionSource).toContain("workflowVersions");
    expect(extensionSource).toContain("currentSpend");
    expect(extensionSource).toContain("pauseDispatch");
    expect(extensionSource).toContain("resumeDispatch");
    expect(extensionSource).not.toContain("<iframe");
    expect(extensionSource).not.toContain("embedMode");
    expect(extensionSource).not.toContain(
      "Symphony opens in its dedicated workspace",
    );
  });

  it("filters queue runs by issue, title, state, and outcome", () => {
    expect(filterRuns(sampleRuns, "slack")).toHaveLength(1);
    expect(filterRuns(sampleRuns, "GH-171")).toHaveLength(1);
    expect(filterRuns(sampleRuns, "terminal")).toHaveLength(1);
    expect(filterRuns(sampleRuns, "merged")).toHaveLength(1);
    expect(filterRuns(sampleRuns, "missing")).toHaveLength(0);
  });

  it("maps Symphony API auth errors to operator-facing copy", () => {
    expect(
      graphQLError(401, [{ extensions: { code: "UNAUTHENTICATED" } }]).message,
    ).toBe("Sign in again to access Symphony.");
    expect(
      graphQLError(403, [{ extensions: { code: "FORBIDDEN" } }]).message,
    ).toBe("Your account is not in the Symphony operators group.");
  });

  it("uses state-specific badge styling for active, terminal, and failed runs", () => {
    expect(stateBadgeClass("invoking_agent")).toContain("amber");
    expect(stateBadgeClass("terminal")).toContain("emerald");
    expect(stateBadgeClass("failed")).toContain("destructive");
  });
});
