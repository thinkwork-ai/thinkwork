import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import { registerEvalCommand } from "../src/commands/eval.js";
import { runEvalRun } from "../src/commands/eval/run.js";

vi.mock("../src/commands/eval/run.js", () => ({
  runEvalRun: vi.fn(),
}));

describe("eval command registration", () => {
  beforeEach(() => {
    vi.mocked(runEvalRun).mockClear();
  });

  it("starts the interactive run flow from bare `evals`", async () => {
    const program = new Command();
    program.exitOverride();
    registerEvalCommand(program);

    await program.parseAsync([
      "node",
      "thinkwork",
      "evals",
      "--stage",
      "dev",
      "--computer",
      "computer-1",
      "--category",
      "red-team-safety-scope",
    ]);

    expect(runEvalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "dev",
        computer: "computer-1",
        category: ["red-team-safety-scope"],
      }),
      expect.anything(),
    );
  });

  it("keeps `eval run` as the explicit equivalent", async () => {
    const program = new Command();
    program.exitOverride();
    registerEvalCommand(program);

    await program.parseAsync([
      "node",
      "thinkwork",
      "eval",
      "run",
      "--computer",
      "computer-1",
      "--all",
    ]);

    expect(runEvalRun).toHaveBeenCalledWith(
      expect.objectContaining({
        computer: "computer-1",
        all: true,
      }),
      expect.anything(),
    );
  });
});
