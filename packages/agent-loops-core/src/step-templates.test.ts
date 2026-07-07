import { describe, expect, it } from "vitest";

import {
  resolveStepTemplates,
  type StepTemplateContext,
} from "./step-templates.js";

const context: StepTemplateContext = {
  trigger: { payload: { callbackUrl: "https://n8n.example/resume/42" } },
  run: { input: { note: "weekly", count: 3 } },
  steps: {
    fetch: { output: { status: 200, body: { items: [1, 2] } } },
  },
};

describe("resolveStepTemplates", () => {
  it("resolves a whole-string placeholder preserving the value type", () => {
    const result = resolveStepTemplates(
      {
        items: "{{ steps.fetch.output.body.items }}",
        n: "{{ run.input.count }}",
      },
      context,
    );
    expect(result).toEqual({
      ok: true,
      value: { items: [1, 2], n: 3 },
    });
  });

  it("interpolates embedded placeholders as strings", () => {
    const result = resolveStepTemplates(
      "POST result to {{ trigger.payload.callbackUrl }} ({{ run.input.note }})",
      context,
    );
    expect(result).toEqual({
      ok: true,
      value: "POST result to https://n8n.example/resume/42 (weekly)",
    });
  });

  it("resolves placeholders nested in arrays and objects", () => {
    const result = resolveStepTemplates(
      {
        list: [
          "{{ run.input.note }}",
          { deep: "{{ steps.fetch.output.status }}" },
        ],
      },
      context,
    );
    expect(result).toEqual({
      ok: true,
      value: { list: ["weekly", { deep: 200 }] },
    });
  });

  it("collects every missing expression instead of failing on the first", () => {
    const result = resolveStepTemplates(
      {
        a: "{{ steps.nope.output.x }}",
        b: "{{ run.input.absent }}",
        c: "{{ run.input.note }}",
      },
      context,
    );
    expect(result).toEqual({
      ok: false,
      missing: ["steps.nope.output.x", "run.input.absent"],
    });
  });

  it("leaves literal values untouched", () => {
    const value = { url: "https://x.dev", n: 7, flag: true, nil: null };
    expect(resolveStepTemplates(value, context)).toEqual({ ok: true, value });
  });
});
