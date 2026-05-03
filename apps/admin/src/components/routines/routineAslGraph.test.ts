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
    const fetchNode = graph.nodes.find(
      (node) => node.id === "FetchAustinWeather",
    );
    const emailNode = graph.nodes.find(
      (node) => node.id === "EmailAustinWeather",
    );

    expect(emailNode?.position.y).toBeGreaterThan(fetchNode?.position.y ?? 0);
    expect(centerX(emailNode)).toBe(centerX(fetchNode));
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

  it("overlays top-level system workflow manifests", () => {
    const graph = buildRoutineAslGraph({
      aslJson: {
        StartAt: "ClaimCompileJob",
        States: {
          ClaimCompileJob: { Type: "Pass", Next: "CompilePages" },
          CompilePages: { Type: "Pass", End: true },
        },
      },
      stepManifestJson: [
        {
          nodeId: "ClaimCompileJob",
          label: "Claim compile job",
          stepType: "checkpoint",
          runtime: "standard",
        },
        {
          nodeId: "CompilePages",
          label: "Compile pages",
          stepType: "worker",
          runtime: "express",
        },
      ],
    });

    expect(graph.nodes.map((node) => [node.id, node.label])).toEqual(
      expect.arrayContaining([
        ["ClaimCompileJob", "Claim compile job"],
        ["CompilePages", "Compile pages"],
      ]),
    );
    expect(
      graph.nodes.find((node) => node.id === "CompilePages")?.subtitle,
    ).toBe("worker");
  });

  it("returns an explicit graph error for malformed ASL", () => {
    const graph = buildRoutineAslGraph({ aslJson: { States: {} } });

    expect(graph.nodes).toEqual([]);
    expect(graph.error).toMatch(/missing StartAt/i);
  });
});

function centerX(
  node: ReturnType<typeof buildRoutineAslGraph>["nodes"][number] | undefined,
) {
  return node ? node.position.x + node.width / 2 : undefined;
}
