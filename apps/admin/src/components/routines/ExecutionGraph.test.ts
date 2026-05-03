import { describe, expect, it } from "vitest";
import { deriveNodes, type StepEventLite } from "./ExecutionGraph";

const manifest = {
  definition: {
    kind: "recipe_graph",
    steps: [
      {
        nodeId: "FetchAustinWeather",
        recipeId: "python",
        label: "Fetch Austin weather",
      },
      {
        nodeId: "EmailAustinWeather",
        recipeId: "email_send",
        label: "Email Austin weather",
      },
    ],
  },
};

function event(overrides: Partial<StepEventLite>): StepEventLite {
  return {
    id: "event-1",
    nodeId: "FetchAustinWeather",
    recipeType: "python",
    status: "succeeded",
    startedAt: "2026-05-03T01:00:00.000Z",
    finishedAt: "2026-05-03T01:00:01.000Z",
    retryCount: 0,
    ...overrides,
  };
}

describe("deriveNodes", () => {
  it("infers success for output-backed manifest steps on succeeded executions", () => {
    const nodes = deriveNodes(
      manifest,
      [event({ nodeId: "FetchAustinWeather", recipeType: "python" })],
      {
        executionStatus: "succeeded",
        executionOutput: {
          FetchAustinWeather: { exitCode: 0 },
          EmailAustinWeather: { messageId: "0100" },
        },
      },
    );

    expect(nodes.map((node) => [node.nodeId, node.latestEvent?.status])).toEqual(
      [
        ["FetchAustinWeather", "succeeded"],
        ["EmailAustinWeather", "succeeded"],
      ],
    );
    expect(nodes[1].latestEvent?.id).toBe("inferred:EmailAustinWeather");
    expect(nodes[1].latestEvent?.recipeType).toBe("email_send");
  });

  it("keeps explicit step events authoritative over output inference", () => {
    const nodes = deriveNodes(
      manifest,
      [
        event({
          id: "failed-email",
          nodeId: "EmailAustinWeather",
          recipeType: "email_send",
          status: "failed",
        }),
      ],
      {
        executionStatus: "succeeded",
        executionOutput: {
          EmailAustinWeather: { messageId: "0100" },
        },
      },
    );

    expect(nodes[1].latestEvent?.id).toBe("failed-email");
    expect(nodes[1].latestEvent?.status).toBe("failed");
  });

  it("does not infer success for non-terminal executions", () => {
    const nodes = deriveNodes(manifest, [], {
      executionStatus: "running",
      executionOutput: {
        EmailAustinWeather: { messageId: "0100" },
      },
    });

    expect(nodes[1].latestEvent).toBeUndefined();
  });

  it("ignores malformed or primitive output values", () => {
    expect(
      deriveNodes(manifest, [], {
        executionStatus: "succeeded",
        executionOutput: "not-json",
      })[1].latestEvent,
    ).toBeUndefined();
    expect(
      deriveNodes(manifest, [], {
        executionStatus: "succeeded",
        executionOutput: null,
      })[1].latestEvent,
    ).toBeUndefined();
  });
});
