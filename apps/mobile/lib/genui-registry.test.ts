import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createResultListJsonRenderFixture,
  createTaskReviewJsonRenderFixture,
} from "@thinkwork/thread-json-render";

import {
  parseMessageBlocks,
  parseThreadJsonRenderFallbacks,
  parseThreadJsonRenderMobileFallbacks,
} from "./genui-registry";

describe("mobile GenUI registry", () => {
  it("renders persisted data-json-render parts as mobile fallback summaries", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    const fallbacks = parseThreadJsonRenderFallbacks([fixture]);

    expect(fallbacks).toEqual([
      expect.objectContaining({
        id: fixture.id,
        title: "Review onboarding task",
        summary: expect.stringContaining("kickoff task"),
        status: "ready",
        component: "task.review",
        lines: ["Status: pending"],
      }),
    ]);
  });

  it("renders result.list generated UI as readable mobile fallback lines", () => {
    const fixture = createResultListJsonRenderFixture();

    const [fallback] = parseThreadJsonRenderFallbacks([fixture]);

    expect(fallback).toEqual(
      expect.objectContaining({
        id: "json-render:result-list:handoff",
        title: "Agent handoff",
        summary: "Current work items, questions, reviews, and approvals.",
        status: "ready",
        component: "result.list",
        specHash: fixture.data.specHash,
        lines: [
          "Work item: Implement structured result list",
          "Question: Which queue should ship first?",
          "Review: Review generated UI plan",
        ],
      }),
    );
  });

  it("renders the checked-in valid-card fixture as a mobile fallback summary", () => {
    const fixture = readJsonRenderFixture("valid-card.json");

    const [fallback] = parseThreadJsonRenderFallbacks([fixture]);

    expect(fallback).toEqual(
      expect.objectContaining({
        id: "json-render:primitive:review",
        title: "Pipeline health",
        summary: "All checks are ready.",
        status: "ready",
        component: "Card",
      }),
    );
  });

  it("renders analytics.display json-render parts from the required mobile fallback", () => {
    const part = {
      type: "data-json-render",
      id: "json-render:analytics:support-volume",
      data: {
        schemaVersion: "thread-json-render/v1",
        catalogVersion: "thread-json-render-catalog/v1",
        status: "ready",
        spec: {
          root: "analytics",
          elements: {
            analytics: {
              type: "analytics.display",
              props: {
                kind: "analytics.display",
                analyticsDisplayVersion: "analytics-display/v1",
                title: "Support Volume",
              },
              children: [],
            },
          },
        },
        mobileFallback: {
          title: "Support Volume",
          summary: "Ticket volume summary.",
          lines: ["Source: Warehouse daily rollup"],
        },
      },
    };

    const [fallback] = parseThreadJsonRenderFallbacks(JSON.stringify([part]));

    expect(fallback).toEqual(
      expect.objectContaining({
        id: "json-render:analytics:support-volume",
        title: "Support Volume",
        component: "analytics.display",
        status: "ready",
      }),
    );
    expect(fallback.lines.join("\n")).toContain("Source: Warehouse");
  });

  it("renders an unsupported fallback for data-json-render parts without mobileFallback", () => {
    const fixture = createTaskReviewJsonRenderFixture() as any;
    delete fixture.data.mobileFallback;

    const [fallback] = parseThreadJsonRenderFallbacks([fixture]);

    expect(fallback).toEqual(
      expect.objectContaining({
        id: fixture.id,
        title: "Generated view",
        summary: "Open this thread on web to view the generated interface.",
        status: "unsupported",
      }),
    );
    expect(
      fallback.diagnostics?.map((diagnostic) => diagnostic.code),
    ).toContain("JSON_RENDER_FALLBACK_REQUIRED");
  });

  it("renders legacy data-genui parts as unsupported fallback summaries", () => {
    const [fallback] = parseThreadJsonRenderFallbacks([
      {
        type: "data-genui",
        id: "genui:legacy",
        data: {
          schemaVersion: "thread-genui/v1",
          catalogVersion: "thread-genui-catalog/v1",
        },
      },
    ]);

    expect(fallback).toEqual(
      expect.objectContaining({
        id: "genui:legacy",
        title: "Legacy generated UI unsupported",
        status: "unsupported",
      }),
    );
    expect(
      fallback.diagnostics?.map((diagnostic) => diagnostic.code),
    ).toContain("JSON_RENDER_LEGACY_GENUI_UNSUPPORTED");
  });

  it("does not parse legacy component JSON or markdown fences as json-render fallbacks", () => {
    const legacy = readJsonRenderFixture("invalid-legacy-component.json");
    const fenced = readMarkdownFixture("invalid-fenced-markdown.md");

    expect(parseThreadJsonRenderFallbacks([legacy])).toEqual([]);
    expect(parseThreadJsonRenderFallbacks(fenced)).toEqual([]);
  });

  it("ignores malformed parts JSON without crashing", () => {
    expect(parseThreadJsonRenderFallbacks("{not-json")).toEqual([]);
  });

  it("keeps the previous mobile fallback parser name as a compatibility alias", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    expect(parseThreadJsonRenderMobileFallbacks([fixture])).toEqual(
      parseThreadJsonRenderFallbacks([fixture]),
    );
  });

  it("keeps existing _type GenUI message fences working", () => {
    const blocks = parseMessageBlocks(
      'Here is a task.\n```genui\n{"_type":"task","id":"task-1","title":"Follow up"}\n```',
    );

    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "genui",
          data: expect.objectContaining({ _type: "task" }),
        }),
      ]),
    );
  });
});

function readJsonRenderFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../docs/fixtures/thread-json-render", name),
      "utf8",
    ),
  );
}

function readMarkdownFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "../../docs/fixtures/thread-json-render", name),
    "utf8",
  );
}
