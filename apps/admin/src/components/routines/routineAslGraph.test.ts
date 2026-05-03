import { describe, expect, it } from "vitest";
import { buildRoutineAslGraph } from "./routineAslGraph";

const manifest = {
  steps: [
    {
      nodeId: "FetchAustinWeather",
      recipeType: "python",
      label: "Fetch Austin weather",
    },
    {
      nodeId: "EmailAustinWeather",
      recipeType: "email_send",
      label: "Email Austin weather",
    },
  ],
};

describe("buildRoutineAslGraph", () => {
  it("builds a linear graph from ASL and overlays manifest labels", () => {
    const graph = buildRoutineAslGraph({
      aslJson: {
        StartAt: "FetchAustinWeather",
        States: {
          FetchAustinWeather: { Type: "Task", Next: "EmailAustinWeather" },
          EmailAustinWeather: { Type: "Task", End: true },
        },
      },
      stepManifestJson: manifest,
    });

    expect(graph.error).toBeUndefined();
    expect(graph.nodes.map((node) => [node.id, node.label])).toEqual(
      expect.arrayContaining([
        ["FetchAustinWeather", "Fetch Austin weather"],
        ["EmailAustinWeather", "Email Austin weather"],
      ]),
    );
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual(
      expect.arrayContaining([
        ["__start", "FetchAustinWeather"],
        ["FetchAustinWeather", "EmailAustinWeather"],
        ["EmailAustinWeather", "EmailAustinWeather.__end"],
      ]),
    );
  });

  it("labels choice and default edges", () => {
    const graph = buildRoutineAslGraph({
      aslJson: {
        StartAt: "NeedsEmail",
        States: {
          NeedsEmail: {
            Type: "Choice",
            Choices: [
              {
                Variable: "$.sendEmail",
                BooleanEquals: true,
                Next: "EmailAustinWeather",
              },
            ],
            Default: "Done",
          },
          EmailAustinWeather: { Type: "Task", End: true },
          Done: { Type: "Succeed" },
        },
      },
      stepManifestJson: manifest,
    });

    expect(graph.nodes.find((node) => node.id === "NeedsEmail")?.kind).toBe(
      "choice",
    );
    expect(graph.edges.map((edge) => edge.label)).toEqual(
      expect.arrayContaining(["$.sendEmail Boolean = true", "Default"]),
    );
  });

  it("returns an explicit graph error for malformed ASL", () => {
    const graph = buildRoutineAslGraph({ aslJson: { States: {} } });

    expect(graph.nodes).toEqual([]);
    expect(graph.error).toMatch(/missing StartAt/i);
  });
});
