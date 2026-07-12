import { describe, expect, it } from "vitest";

import {
  extractTemplateReferences,
  isLoopingDefinition,
  readWorkflowDefinition,
  validateWorkflowDefinition,
} from "./workflow-definition.js";

const minimalAgentStep = {
  id: "do-work",
  kind: "agent",
  objective: "Compile the weekly ops report",
};

const validLoopingDefinition = {
  version: 1,
  steps: [minimalAgentStep],
  continuationPolicy: {
    exitSignal: "the report document exists and is shared",
    maxIterations: 5,
  },
};

describe("validateWorkflowDefinition", () => {
  it("accepts a valid minimal looping definition", () => {
    const result = validateWorkflowDefinition(validLoopingDefinition);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.steps).toHaveLength(1);
      expect(isLoopingDefinition(result.definition)).toBe(true);
    }
  });

  it("accepts a policy-less (plain, non-looping) definition", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [minimalAgentStep],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(isLoopingDefinition(result.definition)).toBe(false);
  });

  it("rejects an unknown step kind naming the step id", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "mystery", kind: "teleport" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          stepId: "mystery",
          reason: expect.stringContaining('unknown step kind "teleport"'),
        }),
      ]);
    }
  });

  it("rejects an agent step with a missing objective", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "a1", kind: "agent" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        stepId: "a1",
        field: "steps[0].objective",
      });
    }
  });

  it("rejects zero and negative maxIterations", () => {
    for (const maxIterations of [0, -3]) {
      const result = validateWorkflowDefinition({
        version: 1,
        steps: [minimalAgentStep],
        continuationPolicy: { exitSignal: "done", maxIterations },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.field).toBe(
          "continuationPolicy.maxIterations",
        );
      }
    }
  });

  it("rejects duplicate step ids", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        minimalAgentStep,
        { ...minimalAgentStep, objective: "second copy" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.reason).toContain('duplicate step id "do-work"');
    }
  });

  it("requires exactly one of until/durationSeconds on wait steps", () => {
    const neither = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "w1", kind: "wait" }],
    });
    expect(neither.ok).toBe(false);

    const both = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "w1",
          kind: "wait",
          until: "2026-07-08T00:00:00Z",
          durationSeconds: 60,
        },
      ],
    });
    expect(both.ok).toBe(false);

    const untilOnly = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "w1", kind: "wait", until: "2026-07-08T00:00:00Z" }],
    });
    expect(untilOnly.ok).toBe(true);
  });

  it("rejects a wait until without timezone information", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "w1", kind: "wait", until: "2026-07-08T00:00:00" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("steps[0].until");
  });

  it("collects every error instead of stopping at the first", () => {
    const result = validateWorkflowDefinition({
      version: 2,
      steps: [
        { id: "a1", kind: "agent" },
        { id: "??bad id??", kind: "wait" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateWorkflowDefinition — full step taxonomy (THINK-214)", () => {
  it("accepts a definition using every step kind", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "fetch",
          kind: "http",
          method: "GET",
          url: "https://api.example.com/items",
        },
        {
          id: "crunch",
          kind: "routine",
          routineId: "r-123",
          input: { items: "{{ steps.fetch.output.body }}" },
        },
        {
          id: "summarize",
          kind: "tool",
          tool: "emit_document",
          input: { title: "Digest" },
        },
        { id: "draft", kind: "agent", objective: "Write the digest" },
        {
          id: "sign-off",
          kind: "approval",
          prompt: "Publish the digest?",
          timeoutSeconds: 86400,
        },
        { id: "cool-off", kind: "wait", durationSeconds: 60 },
        {
          id: "announce",
          kind: "emit_event",
          eventType: "digest.published",
          payload: { runNote: "{{ run.input.note }}" },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
  });

  // THINK-227 U4: deliver step
  it("accepts a deliver step on a binding-carrying definition", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      documentBinding: { mode: "existing", artifactId: "art-1" },
      steps: [
        { id: "work", kind: "agent", objective: "Refresh the report" },
        {
          id: "deliver",
          kind: "deliver",
          recipients: ["ops@example.com", "ceo@example.com"],
          subjectTemplate: "Weekly Pipeline Report",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects a deliver step with bad recipients or missing binding", () => {
    const noRecipients = validateWorkflowDefinition({
      version: 1,
      documentBinding: { mode: "existing", artifactId: "art-1" },
      steps: [{ id: "d1", kind: "deliver", recipients: [] }],
    });
    expect(noRecipients.ok).toBe(false);
    if (!noRecipients.ok) {
      expect(noRecipients.errors[0]?.field).toBe("steps[0].recipients");
    }

    const badRecipient = validateWorkflowDefinition({
      version: 1,
      documentBinding: { mode: "existing", artifactId: "art-1" },
      steps: [{ id: "d1", kind: "deliver", recipients: ["not-an-email"] }],
    });
    expect(badRecipient.ok).toBe(false);
    if (!badRecipient.ok) {
      expect(badRecipient.errors[0]?.field).toBe("steps[0].recipients[0]");
    }

    const noBinding = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "d1", kind: "deliver", recipients: ["ops@example.com"] }],
    });
    expect(noBinding.ok).toBe(false);
    if (!noBinding.ok) {
      expect(noBinding.errors[0]?.reason).toMatch(
        /requires the workflow to carry a documentBinding/,
      );
    }

    const multilineSubject = validateWorkflowDefinition({
      version: 1,
      documentBinding: { mode: "existing", artifactId: "art-1" },
      steps: [
        {
          id: "d1",
          kind: "deliver",
          recipients: ["ops@example.com"],
          subjectTemplate: "hi\r\nBcc: evil@example.com",
        },
      ],
    });
    expect(multilineSubject.ok).toBe(false);
    if (!multilineSubject.ok) {
      expect(multilineSubject.errors[0]?.field).toBe(
        "steps[0].subjectTemplate",
      );
    }
  });

  it("rejects a malformed documentBinding on the definition", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      documentBinding: { mode: "bogus" },
      steps: [{ id: "work", kind: "agent", objective: "x" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe("documentBinding.mode");
    }
  });

  it("rejects a routine step without routineId", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "r1", kind: "routine" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        stepId: "r1",
        field: "steps[0].routineId",
      });
    }
  });

  it("rejects a tool step without a tool name", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "t1", kind: "tool", input: {} }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe("steps[0].tool");
    }
  });

  it("rejects an approval step without a prompt", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "ok1", kind: "approval" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("steps[0].prompt");
  });

  it("rejects an http step with a bad method or non-http(s) literal url", () => {
    const badMethod = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "h1", kind: "http", method: "BREW", url: "https://x.dev" }],
    });
    expect(badMethod.ok).toBe(false);
    if (!badMethod.ok)
      expect(badMethod.errors[0]?.field).toBe("steps[0].method");

    const badUrl = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "h1", kind: "http", method: "POST", url: "ftp://x.dev" }],
    });
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.errors[0]?.field).toBe("steps[0].url");
  });

  it("accepts a templated http url without literal-URL parsing", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "resume",
          kind: "http",
          method: "POST",
          url: "{{ trigger.payload.resumeUrl }}",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
  });

  // Memory pipeline step (external-memory-compounding U1)
  it("accepts a well-formed memory_stage step", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "extract-memories",
          kind: "memory_stage",
          stage: "extract",
          processorConfigId: "8e7a2f4c-1234-4abc-9def-0123456789ab",
          sourceConfigId: "{{ run.input.sourceConfigId }}",
          options: { batchSize: 50 },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects a memory_stage step missing its stage", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        { id: "m1", kind: "memory_stage", processorConfigId: "cfg-1" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("steps[0].stage");
  });

  it("rejects a memory_stage step with an unknown stage", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "m1",
          kind: "memory_stage",
          stage: "teleport",
          processorConfigId: "cfg-1",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        stepId: "m1",
        field: "steps[0].stage",
      });
    }
  });

  it("rejects a memory_stage step missing processorConfigId", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "m1", kind: "memory_stage", stage: "retain" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe("steps[0].processorConfigId");
    }
  });

  it("rejects an emit_event step with a malformed eventType", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "e1", kind: "emit_event", eventType: "not an event!" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("steps[0].eventType");
  });
});

describe("validateWorkflowDefinition — input mapping references", () => {
  it("rejects an unknown template root", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "e1",
          kind: "emit_event",
          eventType: "x.y",
          payload: { v: "{{ secrets.apiKey }}" },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.reason).toContain('unknown root "secrets"');
    }
  });

  it("rejects forward and self step references, accepts backward ones", () => {
    const forward = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "first",
          kind: "emit_event",
          eventType: "x.y",
          payload: { v: "{{ steps.second.output.z }}" },
        },
        { id: "second", kind: "agent", objective: "later" },
      ],
    });
    expect(forward.ok).toBe(false);
    if (!forward.ok) {
      expect(forward.errors[0]?.reason).toContain('references step "second"');
    }

    const self = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "only",
          kind: "emit_event",
          eventType: "x.y",
          payload: { v: "{{ steps.only.output.z }}" },
        },
      ],
    });
    expect(self.ok).toBe(false);

    const backward = validateWorkflowDefinition({
      version: 1,
      steps: [
        { id: "first", kind: "agent", objective: "produce output" },
        {
          id: "second",
          kind: "emit_event",
          eventType: "x.y",
          payload: { v: "{{ steps.first.output.z }}" },
        },
      ],
    });
    expect(backward).toMatchObject({ ok: true });
  });

  it("extractTemplateReferences finds nested placeholders with roots and step ids", () => {
    const refs = extractTemplateReferences({
      a: "{{ trigger.payload.callbackUrl }}",
      b: { c: ["{{ steps.fetch.output.body }}", "literal"] },
    });
    expect(refs).toEqual([
      { expression: "trigger.payload.callbackUrl", root: "trigger" },
      { expression: "steps.fetch.output.body", root: "steps", stepId: "fetch" },
    ]);
  });
});

describe("readWorkflowDefinition", () => {
  it("returns the definition for a valid snapshot and null otherwise", () => {
    expect(readWorkflowDefinition(validLoopingDefinition)).not.toBeNull();
    expect(readWorkflowDefinition({})).toBeNull();
    expect(readWorkflowDefinition(null)).toBeNull();
  });
});
