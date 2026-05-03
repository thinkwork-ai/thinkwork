import { describe, expect, it } from "vitest";
import {
  normalizeRoutineExecutionManifest,
  parseAwsJson,
} from "./routineExecutionManifest";

describe("parseAwsJson", () => {
  it("returns objects unchanged", () => {
    const value = { ok: true };
    expect(parseAwsJson(value)).toBe(value);
  });

  it("parses JSON strings", () => {
    expect(parseAwsJson('{"ok":true}')).toEqual({ ok: true });
  });

  it("preserves malformed strings", () => {
    expect(parseAwsJson("{nope")).toBe("{nope");
  });
});

describe("normalizeRoutineExecutionManifest", () => {
  it("normalizes recipe graph definition steps", () => {
    expect(
      normalizeRoutineExecutionManifest({
        definition: {
          kind: "recipe_graph",
          steps: [
            {
              nodeId: "FetchWeather",
              recipeId: "python",
              label: "Fetch weather",
              args: { timeoutSeconds: 30 },
            },
          ],
        },
      }),
    ).toEqual([
      {
        nodeId: "FetchWeather",
        recipeId: "python",
        recipeType: "python",
        label: "Fetch weather",
        args: { timeoutSeconds: 30 },
      },
    ]);
  });

  it("normalizes JSON-string manifests", () => {
    expect(
      normalizeRoutineExecutionManifest(
        JSON.stringify({
          steps: [
            {
              nodeId: "EmailAustinWeather",
              recipeType: "email_send",
              label: "Email Austin weather",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        nodeId: "EmailAustinWeather",
        recipeId: undefined,
        recipeType: "email_send",
        label: "Email Austin weather",
        args: undefined,
      },
    ]);
  });

  it("normalizes legacy node maps", () => {
    expect(
      normalizeRoutineExecutionManifest({
        FetchWeather: { recipeType: "python", displayTitle: "Fetch weather" },
      }),
    ).toEqual([
      {
        nodeId: "FetchWeather",
        recipeId: undefined,
        recipeType: "python",
        label: "Fetch weather",
        args: undefined,
      },
    ]);
  });

  it("returns an empty list for malformed manifests", () => {
    expect(normalizeRoutineExecutionManifest("{nope")).toEqual([]);
    expect(normalizeRoutineExecutionManifest(null)).toEqual([]);
    expect(normalizeRoutineExecutionManifest([])).toEqual([]);
  });
});
