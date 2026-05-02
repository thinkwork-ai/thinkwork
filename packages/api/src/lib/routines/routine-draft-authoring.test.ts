import { describe, expect, it, vi } from "vitest";
import { validateRoutineAsl } from "../../handlers/routine-asl-validator.js";
import { buildRoutineDraftFromIntent } from "./routine-draft-authoring.js";

const okSfn = {
  send: vi.fn().mockResolvedValue({ result: "OK", diagnostics: [] }),
} as any;

describe("buildRoutineDraftFromIntent", () => {
  it("authors an Austin weather email routine", async () => {
    const result = buildRoutineDraftFromIntent({
      name: "Check Austin Weather",
      intent:
        "Check the weather in Austin and email it to ericodom37@gmail.com.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect(JSON.stringify(result.artifacts.asl)).not.toContain("NoOp");
    expect(result.artifacts.asl.StartAt).toBe("FetchAustinWeather");
    expect(result.artifacts.markdownSummary).toContain("ericodom37@gmail.com");
    expect(result.artifacts.stepManifest).toMatchObject({
      steps: [
        { nodeId: "FetchAustinWeather", recipeType: "python" },
        { nodeId: "EmailAustinWeather", recipeType: "email_send" },
      ],
    });

    const validation = await validateRoutineAsl(
      { asl: result.artifacts.asl },
      { sfnClient: okSfn },
    );
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("requires a recipient for the supported weather email shape", () => {
    const result = buildRoutineDraftFromIntent({
      name: "Check Austin Weather",
      intent: "Check the weather in Austin and email it.",
    });

    expect(result).toEqual({
      ok: false,
      reason:
        "Add the email recipient to the routine description, for example: check the weather in Austin and email it to name@example.com.",
    });
  });

  it("rejects unrelated intents instead of returning placeholder ASL", () => {
    const result = buildRoutineDraftFromIntent({
      name: "Post to Slack",
      intent: "Post a Slack message when a webhook fires.",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("currently supports Austin weather");
    }
  });
});
