import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { describe, expect, it, vi } from "vitest";

import {
  ASK_USER_QUESTION_TOOL_NAME,
  createAskUserQuestionExtension,
} from "../src/ask-user-question.js";
import { toExtensionFactory } from "../src/define-extension.js";

type FetchCall = [string | URL | Request, RequestInit?];

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, tools };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

const NO_SIGNAL = undefined;
const NO_UPDATE = undefined;
const NO_CTX = undefined as never;

const CONFIG = {
  apiUrl: "https://api.example.com/",
  apiSecret: "secret",
  threadId: "thread-1",
  threadTurnId: "turn-1",
};

function question(overrides: Record<string, unknown> = {}) {
  return {
    question: "Which environment should this deploy to?",
    header: "Env",
    options: [
      { label: "dev (Recommended)", description: "Deploy to the dev stage." },
      { label: "prod", description: "Deploy straight to production." },
    ],
    ...overrides,
  };
}

async function buildTool(fetchImpl: typeof fetch) {
  const { api, tools } = makeFakeApi();
  const extension = createAskUserQuestionExtension({
    askUserQuestionConfig: CONFIG,
    fetchImpl,
  });
  await toExtensionFactory(extension, {})(api);
  return {
    extension,
    tool: getTool(tools, ASK_USER_QUESTION_TOOL_NAME),
  };
}

function resultText(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}

function sentinel(result: {
  details?: unknown;
}): Record<string, unknown> | undefined {
  const details = result.details as
    | { thinkworkAskUserQuestion?: Record<string, unknown> }
    | undefined;
  return details?.thinkworkAskUserQuestion;
}

describe("ask_user_question schema", () => {
  async function schema() {
    const { tool } = await buildTool(vi.fn() as unknown as typeof fetch);
    return tool.parameters;
  }

  it("accepts a valid 1-question batch and a full 4-question batch", async () => {
    const parameters = await schema();
    expect(Check(parameters, { questions: [question()] })).toBe(true);
    expect(
      Check(parameters, {
        questions: [
          question(),
          question({ header: "Scope" }),
          question({ header: "Audience", multiSelect: true }),
          question({ header: "Timing" }),
        ],
      }),
    ).toBe(true);
  });

  it("rejects 0 questions and 5 questions", async () => {
    const parameters = await schema();
    expect(Check(parameters, { questions: [] })).toBe(false);
    expect(
      Check(parameters, { questions: Array.from({ length: 5 }, question) }),
    ).toBe(false);
  });

  it("rejects 1 option and 5 options", async () => {
    const parameters = await schema();
    const one = question({
      options: [{ label: "only", description: "one option" }],
    });
    expect(Check(parameters, { questions: [one] })).toBe(false);

    const five = question({
      options: Array.from({ length: 5 }, (_, i) => ({
        label: `option ${i}`,
        description: "d",
      })),
    });
    expect(Check(parameters, { questions: [five] })).toBe(false);
  });

  it("rejects an over-length header (>12 chars) and an empty question", async () => {
    const parameters = await schema();
    expect(
      Check(parameters, {
        questions: [question({ header: "ThirteenChars" })],
      }),
    ).toBe(false);
    expect(Check(parameters, { questions: [question({ question: "" })] })).toBe(
      false,
    );
  });
});

describe("ask_user_question execute", () => {
  it("happy path POSTs once with bearer auth + intake body and returns the endTurn sentinel", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, questionId: "q-1", messageId: "m-1" }),
    );
    const { tool } = await buildTool(fetchImpl as unknown as typeof fetch);

    const params = {
      questions: [question()],
      delegationContext: { profileSlug: "research", escalationCount: 0 },
    };
    const result = await tool.execute(
      "call-1",
      params,
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    expect(fetchCalls[0]![0]).toBe(
      "https://api.example.com/api/threads/thread-1/questions",
    );
    expect(fetchCalls[0]![1]?.headers).toMatchObject({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(fetchCalls[0]![1]?.body))).toEqual({
      thread_turn_id: "turn-1",
      questions: [question()],
      delegation_context: { profileSlug: "research", escalationCount: 0 },
    });

    expect(sentinel(result)).toEqual({ questionId: "q-1", endTurn: true });
    expect(
      (result as { terminate?: boolean }).terminate,
      "sentinel result must carry the SDK early-termination hint",
    ).toBe(true);
    expect(resultText(result)).toContain("The turn ends now");
  });

  it("omits delegation_context (null) when not relaying an escalation", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, questionId: "q-1" }),
    );
    const { tool } = await buildTool(fetchImpl as unknown as typeof fetch);
    await tool.execute(
      "call-1",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    expect(
      JSON.parse(String(fetchCalls[0]![1]?.body)).delegation_context,
    ).toBeNull();
  });

  it("409 returns the already-pending error result with NO sentinel and arms the guard", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { ok: false, code: "QUESTION_ALREADY_PENDING" },
        { status: 409 },
      ),
    );
    const { tool } = await buildTool(fetchImpl as unknown as typeof fetch);

    const result = await tool.execute(
      "call-1",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(resultText(result)).toContain("already pending");
    expect(resultText(result)).toContain("end your turn");
    expect(sentinel(result)?.endTurn).toBeUndefined();
    expect((result as { terminate?: boolean }).terminate).toBeUndefined();

    // Guard armed: a second same-turn call short-circuits without POSTing.
    const second = await tool.execute(
      "call-2",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resultText(second)).toContain("already pending");
  });

  it("network failure returns a best-judgment error result, no sentinel, and does not throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { tool } = await buildTool(fetchImpl as unknown as typeof fetch);

    const result = await tool.execute(
      "call-1",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(resultText(result)).toContain("NOT delivered");
    expect(resultText(result)).toContain("best judgment");
    expect(sentinel(result)?.endTurn).toBeUndefined();
    expect((result as { terminate?: boolean }).terminate).toBeUndefined();
  });

  it("non-409 HTTP failure returns a best-judgment error result with no sentinel (phantom-wait rule)", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: false, code: "INTERNAL" }, { status: 500 }),
    );
    const { tool } = await buildTool(fetchImpl as unknown as typeof fetch);

    const result = await tool.execute(
      "call-1",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(resultText(result)).toContain("HTTP 500");
    expect(resultText(result)).toContain("best judgment");
    expect(sentinel(result)?.endTurn).toBeUndefined();
    expect((result as { terminate?: boolean }).terminate).toBeUndefined();
  });

  it("second successful-turn call short-circuits without POSTing again", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, questionId: "q-1" }),
    );
    const { tool } = await buildTool(fetchImpl as unknown as typeof fetch);

    const first = await tool.execute(
      "call-1",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(sentinel(first)?.endTurn).toBe(true);

    const second = await tool.execute(
      "call-2",
      { questions: [question({ header: "Scope" })] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resultText(second)).toContain("already pending");
    expect(sentinel(second)?.endTurn).toBeUndefined();
  });

  it("a fresh closure (new invocation) can ask again — the guard is turn-scoped", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, questionId: "q-2" }),
    );
    const first = await buildTool(fetchImpl as unknown as typeof fetch);
    await first.tool.execute(
      "call-1",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    // The host rebuilds the extension per invocation; a later turn gets a
    // fresh guard and POSTs normally.
    const second = await buildTool(fetchImpl as unknown as typeof fetch);
    const result = await second.tool.execute(
      "call-2",
      { questions: [question()] },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sentinel(result)?.endTurn).toBe(true);
  });
});

describe("ask_user_question gating", () => {
  it("declares no toolNames and registers nothing when config is missing", async () => {
    const { api, tools } = makeFakeApi();
    const extension = createAskUserQuestionExtension({});
    await toExtensionFactory(extension, {})(api);
    expect(extension.toolNames).toEqual([]);
    expect(tools).toEqual([]);
  });

  it("declares no toolNames when explicitly disabled", async () => {
    const { api, tools } = makeFakeApi();
    const extension = createAskUserQuestionExtension({
      askUserQuestionConfig: { ...CONFIG, enabled: false },
    });
    await toExtensionFactory(extension, {})(api);
    expect(extension.toolNames).toEqual([]);
    expect(tools).toEqual([]);
  });

  it("requires the thread_turn_id (intake ownership join) to enable", async () => {
    const extension = createAskUserQuestionExtension({
      askUserQuestionConfig: { ...CONFIG, threadTurnId: "" },
    });
    expect(extension.toolNames).toEqual([]);
  });

  it("declares the tool name when fully configured (allowlist contract)", async () => {
    const extension = createAskUserQuestionExtension({
      askUserQuestionConfig: CONFIG,
    });
    expect(extension.toolNames).toEqual([ASK_USER_QUESTION_TOOL_NAME]);
  });
});
