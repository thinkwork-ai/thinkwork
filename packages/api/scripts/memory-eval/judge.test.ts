import { describe, expect, it, vi } from "vitest";

import type { ThreadsFixture } from "./export-threads.js";
import type { RunRetainReport } from "./run-retain.js";
import {
  JUDGE_PROMPT_VERSION,
  buildJudgeUserPayload,
  judgeDocument,
  parseArgs,
  reconcileVerdicts,
  runJudge,
  type InvokeJson,
  type JudgeArgs,
} from "./judge.js";

function buildArgs(overrides: Partial<JudgeArgs> = {}): JudgeArgs {
  return {
    candidate: "gpt-oss-20b-baseline",
    units: "/tmp/memory-eval/runs/gpt-oss-20b-baseline.units.json",
    fixture: "/tmp/memory-eval/threads-fixture.json",
    out: "/tmp/memory-eval/runs/gpt-oss-20b-baseline.scores.json",
    judgeModelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("requires candidate, units, fixture, out", () => {
    expect(() => parseArgs([])).toThrow(/--candidate is required/);
    expect(() => parseArgs(["--candidate", "c"])).toThrow(
      /--units is required/,
    );
    expect(() => parseArgs(["--candidate", "c", "--units", "u"])).toThrow(
      /--fixture is required/,
    );
    expect(() =>
      parseArgs(["--candidate", "c", "--units", "u", "--fixture", "f"]),
    ).toThrow(/--out is required/);
  });

  it("defaults to the pinned judge model", () => {
    const args = parseArgs([
      "--candidate",
      "c",
      "--units",
      "u",
      "--fixture",
      "f",
      "--out",
      "o",
    ]);
    expect(args.judgeModelId).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
  });

  it("allows overriding the judge model", () => {
    const args = parseArgs([
      "--candidate",
      "c",
      "--units",
      "u",
      "--fixture",
      "f",
      "--out",
      "o",
      "--judge-model",
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    ]);
    expect(args.judgeModelId).toBe(
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );
  });
});

describe("buildJudgeUserPayload", () => {
  it("bundles transcript + units for in-context judging", () => {
    const payload = buildJudgeUserPayload("transcript text", [
      { id: "unit-1", text: "unit text" },
    ]);
    expect(JSON.parse(payload)).toEqual({
      transcript: "transcript text",
      units: [{ id: "unit-1", text: "unit text" }],
    });
  });
});

describe("reconcileVerdicts", () => {
  const units = [
    { id: "unit-1", text: "Eric prefers pnpm." },
    { id: "unit-2", text: "It was set up yesterday." },
  ];

  it("keeps well-formed verdicts", () => {
    const verdicts = reconcileVerdicts(units, [
      {
        id: "unit-1",
        referentComplete: 1,
        danglingReferents: [],
        faithful: 2,
        useful: 2,
        duplicateOf: null,
      },
      {
        id: "unit-2",
        referentComplete: 0,
        danglingReferents: ["it"],
        faithful: 1,
        useful: 1,
        duplicateOf: "unit-1",
      },
    ]);
    expect(verdicts).toEqual([
      {
        unitId: "unit-1",
        text: "Eric prefers pnpm.",
        referentComplete: 1,
        danglingReferents: [],
        faithful: 2,
        useful: 2,
        duplicateOf: null,
      },
      {
        unitId: "unit-2",
        text: "It was set up yesterday.",
        referentComplete: 0,
        danglingReferents: ["it"],
        faithful: 1,
        useful: 1,
        duplicateOf: "unit-1",
      },
    ]);
  });

  it("default-excludes a unit missing from the judge response", () => {
    const verdicts = reconcileVerdicts(units, [
      {
        id: "unit-1",
        referentComplete: 1,
        danglingReferents: [],
        faithful: 2,
        useful: 2,
        duplicateOf: null,
      },
    ]);
    expect(verdicts[1]).toMatchObject({
      unitId: "unit-2",
      referentComplete: 0,
      faithful: 0,
      useful: 0,
      duplicateOf: null,
    });
    expect(verdicts[1].danglingReferents).toContain("[judge_verdict_missing]");
  });

  it("default-excludes when the judge response is not an array", () => {
    const verdicts = reconcileVerdicts(units, { not: "an array" });
    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((v) => v.referentComplete === 0)).toBe(true);
  });

  it("clamps out-of-range scores", () => {
    const verdicts = reconcileVerdicts(
      [{ id: "unit-1", text: "x" }],
      [{ id: "unit-1", faithful: 99, useful: -5, referentComplete: 5 }],
    );
    expect(verdicts[0].faithful).toBe(2);
    expect(verdicts[0].useful).toBe(0);
    expect(verdicts[0].referentComplete).toBe(0);
  });
});

describe("judgeDocument", () => {
  it("returns [] without calling the model when there are no units", async () => {
    const invoke = vi.fn() as unknown as InvokeJson;
    const verdicts = await judgeDocument("transcript", [], "model-id", invoke);
    expect(verdicts).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the pinned judge model with system + user prompts", async () => {
    const invoke = vi.fn(async () => ({
      parsed: [
        {
          id: "unit-1",
          referentComplete: 1,
          danglingReferents: [],
          faithful: 2,
          useful: 2,
          duplicateOf: null,
        },
      ],
    })) as unknown as InvokeJson;

    const verdicts = await judgeDocument(
      "user: hi\nassistant: hello",
      [{ id: "unit-1", text: "Greeted the user." }],
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      invoke,
    );

    expect(verdicts).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      }),
    );
  });
});

describe("runJudge", () => {
  it("judges only successfully-retained documents with non-empty units", async () => {
    const retain: RunRetainReport = {
      candidate: "gpt-oss-20b-baseline",
      generatedAt: "2026-07-01T00:00:00.000Z",
      hindsightUrl: "http://localhost:8888",
      bank: "evalrun",
      schema: "eval_baseline",
      totalWallMs: 100,
      threads: [
        {
          threadId: "thread-1",
          title: "Plan the launch",
          wallMs: 100,
          ok: true,
          units: [
            {
              id: "unit-1",
              text: "Wants to plan the launch.",
              context: null,
              factType: null,
            },
          ],
        },
        {
          threadId: "thread-2",
          title: "Failed retain",
          wallMs: 0,
          ok: false,
          error: "boom",
          units: [],
        },
        {
          threadId: "thread-3",
          title: "No units extracted",
          wallMs: 50,
          ok: true,
          units: [],
        },
      ],
    };

    const fixture: ThreadsFixture = {
      generatedAt: "2026-07-01T00:00:00.000Z",
      count: 3,
      threads: [
        {
          threadId: "thread-1",
          tenantId: "tenant-1",
          title: "Plan the launch",
          messages: [
            {
              role: "user",
              content: "Plan the launch.",
              timestamp: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
        {
          threadId: "thread-2",
          tenantId: "tenant-1",
          title: "Failed retain",
          messages: [],
        },
        {
          threadId: "thread-3",
          tenantId: "tenant-1",
          title: "No units extracted",
          messages: [],
        },
      ],
    };

    const invoke = vi.fn(async () => ({
      parsed: [
        {
          id: "unit-1",
          referentComplete: 1,
          danglingReferents: [],
          faithful: 2,
          useful: 2,
          duplicateOf: null,
        },
      ],
    })) as unknown as InvokeJson;

    const report = await runJudge(buildArgs(), retain, fixture, invoke);

    expect(report.candidate).toBe("gpt-oss-20b-baseline");
    expect(report.promptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(report.documents).toHaveLength(1);
    expect(report.documents[0].threadId).toBe("thread-1");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
