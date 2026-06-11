import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LambdaClient } from "@aws-sdk/client-lambda";

import {
  createIntakeQuestionPost,
  detectLeakedAskUserQuestion,
  extractQuestionsPayload,
  rescueLeakedAskUserQuestion,
  stripLeakedToolSyntax,
  turnAlreadyAskedUserQuestion,
  type RescuedQuestion,
  type RescuePostOutcome,
} from "../src/ask-user-question-rescue.js";
import { handleInvocation } from "../src/server.js";
import type { ConnectMcpServerFn } from "../src/mcp.js";

// ---------------------------------------------------------------------------
// Fixtures — the two observed leak formats (Kimi K2.5 via Bedrock).
// ---------------------------------------------------------------------------

const QUESTIONS_JSON = JSON.stringify({
  questions: [
    {
      header: "Scope",
      question: "Which scope should I target?",
      options: [
        { label: "Web only (Recommended)", description: "Just apps/web." },
        { label: "Web + mobile", description: "Both clients." },
      ],
    },
    {
      header: "Timing",
      question: "Ship now or wait for review?",
      options: [
        { label: "Ship now", description: "Merge as soon as CI is green." },
        { label: "Wait", description: "Hold for your review." },
      ],
      multiSelect: false,
    },
  ],
});

/** Format A — `<tool_call>` prefix tokens + wrapped {tool, arguments} JSON. */
const FORMAT_A = `I looked at the settings page and have a couple of options.

<tool_call> <tool_call> <tool_call>{"tool": "ask_user_question", "arguments": ${QUESTIONS_JSON}}

Let me know what you prefer.`;

/** Format B — Kimi special tokens + bare {questions} JSON + [blocked]. */
const FORMAT_B = `Here is what I found so far.

functions.ask_user_question:1 <|tool_call_argument_begin|> ${QUESTIONS_JSON} <|tool_call_end|> <|tool_calls_section_end|> [blocked]`;

/** Mangled short-key variant — NOT reliably parseable. */
const MANGLED = `Quick check before I continue.

functions.ask_user_question:1 <|tool_call_argument_begin|> {{<tool>}} {{"questions": [{"q": "Which one?", "h": "Pick", "o": [{"l": "A", "d": "first"}, {"l": "B", "d": "second"}], "mS": false}]`;

const CLEAN_TEXT =
  "All done — I updated the three files and the tests pass.\n\n" +
  "Ping me if anything looks off.";

const OTHER_TOOL_LEAK = `Working on it.

<tool_call>{"tool": "send_email", "arguments": {"to": "a@b.com", "subject": "hi", "body": "questions inside prose"}}

Done.`;

function okPost(
  questionId = "q-123",
): [
  ReturnType<typeof vi.fn>,
  (questions: RescuedQuestion[]) => Promise<RescuePostOutcome>,
] {
  const spy = vi.fn(
    async (_questions: RescuedQuestion[]): Promise<RescuePostOutcome> => ({
      ok: true,
      questionId,
    }),
  );
  return [spy, spy];
}

// ---------------------------------------------------------------------------
// detectLeakedAskUserQuestion
// ---------------------------------------------------------------------------

describe("detectLeakedAskUserQuestion", () => {
  it("detects format A", () => {
    expect(detectLeakedAskUserQuestion(FORMAT_A)).toBe(true);
  });

  it("detects format B", () => {
    expect(detectLeakedAskUserQuestion(FORMAT_B)).toBe(true);
  });

  it("detects the mangled short-key variant", () => {
    expect(detectLeakedAskUserQuestion(MANGLED)).toBe(true);
  });

  it("ignores clean text", () => {
    expect(detectLeakedAskUserQuestion(CLEAN_TEXT)).toBe(false);
  });

  it("ignores a <tool_call> leak for a different tool", () => {
    expect(detectLeakedAskUserQuestion(OTHER_TOOL_LEAK)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractQuestionsPayload
// ---------------------------------------------------------------------------

describe("extractQuestionsPayload", () => {
  it("parses the wrapped {tool, arguments:{questions}} payload (format A)", () => {
    const questions = extractQuestionsPayload(FORMAT_A);
    expect(questions).not.toBeNull();
    expect(questions).toHaveLength(2);
    expect(questions![0]).toEqual({
      header: "Scope",
      question: "Which scope should I target?",
      options: [
        { label: "Web only (Recommended)", description: "Just apps/web." },
        { label: "Web + mobile", description: "Both clients." },
      ],
    });
    expect(questions![1]!.multiSelect).toBe(false);
  });

  it("parses the bare {questions} payload (format B)", () => {
    const questions = extractQuestionsPayload(FORMAT_B);
    expect(questions).not.toBeNull();
    expect(questions).toHaveLength(2);
    expect(questions![1]!.header).toBe("Timing");
  });

  it("parses an {arguments:{questions}} wrapper without a tool key", () => {
    const text = `<tool_call>{"name": "ask_user_question", "arguments": ${QUESTIONS_JSON}}`;
    expect(extractQuestionsPayload(text)).toHaveLength(2);
  });

  it("returns null for the mangled short-key variant", () => {
    expect(extractQuestionsPayload(MANGLED)).toBeNull();
  });

  it("truncates oversized headers and labels instead of rejecting", () => {
    const text = `<tool_call>${JSON.stringify({
      tool: "ask_user_question",
      arguments: {
        questions: [
          {
            header: "Deployment strategy",
            question: "Which deployment strategy?",
            options: [
              { label: "x".repeat(80), description: "long label" },
              { label: "Short", description: "short label" },
            ],
          },
        ],
      },
    })}`;
    const questions = extractQuestionsPayload(text);
    expect(questions).toHaveLength(1);
    expect(questions![0]!.header).toBe("Deployment s");
    expect(questions![0]!.header.length).toBeLessThanOrEqual(12);
    expect(questions![0]!.options[0]!.label).toBe("x".repeat(60));
  });

  it("drops options beyond 4", () => {
    const options = [1, 2, 3, 4, 5, 6].map((n) => ({
      label: `Option ${n}`,
      description: `option ${n}`,
    }));
    const text = `<tool_call>${JSON.stringify({
      tool: "ask_user_question",
      arguments: {
        questions: [{ header: "Pick", question: "Pick one.", options }],
      },
    })}`;
    const questions = extractQuestionsPayload(text);
    expect(questions![0]!.options).toHaveLength(4);
    expect(questions![0]!.options[3]!.label).toBe("Option 4");
  });

  it("drops a question with fewer than 2 options but keeps valid siblings", () => {
    const text = `<tool_call>${JSON.stringify({
      tool: "ask_user_question",
      arguments: {
        questions: [
          {
            header: "Broken",
            question: "Only one option?",
            options: [{ label: "Lonely", description: "" }],
          },
          {
            header: "Valid",
            question: "This one is fine?",
            options: [
              { label: "Yes", description: "" },
              { label: "No", description: "" },
            ],
          },
        ],
      },
    })}`;
    const questions = extractQuestionsPayload(text);
    expect(questions).toHaveLength(1);
    expect(questions![0]!.header).toBe("Valid");
  });

  it("returns null when no valid questions remain", () => {
    const text = `<tool_call>${JSON.stringify({
      tool: "ask_user_question",
      arguments: {
        questions: [
          {
            header: "Broken",
            question: "Only one option?",
            options: [{ label: "Lonely", description: "" }],
          },
        ],
      },
    })}`;
    expect(extractQuestionsPayload(text)).toBeNull();
  });

  it("caps the batch at 4 questions", () => {
    const questions = [1, 2, 3, 4, 5].map((n) => ({
      header: `Q${n}`,
      question: `Question ${n}?`,
      options: [
        { label: "A", description: "" },
        { label: "B", description: "" },
      ],
    }));
    const text = `<tool_call>${JSON.stringify({
      tool: "ask_user_question",
      arguments: { questions },
    })}`;
    expect(extractQuestionsPayload(text)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// stripLeakedToolSyntax
// ---------------------------------------------------------------------------

describe("stripLeakedToolSyntax", () => {
  it("strips format A keeping surrounding prose only", () => {
    expect(stripLeakedToolSyntax(FORMAT_A)).toBe(
      "I looked at the settings page and have a couple of options.\n\n" +
        "Let me know what you prefer.",
    );
  });

  it("strips format B including [blocked] and section-end tokens", () => {
    const stripped = stripLeakedToolSyntax(FORMAT_B);
    expect(stripped).toBe("Here is what I found so far.");
    expect(stripped).not.toContain("<|tool_call_end|>");
    expect(stripped).not.toContain("<|tool_calls_section_end|>");
    expect(stripped).not.toContain("[blocked]");
  });

  it("strips the mangled variant through end of text", () => {
    expect(stripLeakedToolSyntax(MANGLED)).toBe(
      "Quick check before I continue.",
    );
  });

  it("leaves clean text untouched", () => {
    expect(stripLeakedToolSyntax(CLEAN_TEXT)).toBe(CLEAN_TEXT);
  });

  it("leaves a different tool's leak untouched", () => {
    expect(stripLeakedToolSyntax(OTHER_TOOL_LEAK)).toBe(OTHER_TOOL_LEAK);
  });
});

// ---------------------------------------------------------------------------
// rescueLeakedAskUserQuestion
// ---------------------------------------------------------------------------

describe("rescueLeakedAskUserQuestion", () => {
  it("format A: parses, posts, and strips (card shows the questions)", async () => {
    const [spy, post] = okPost("q-abc");
    const result = await rescueLeakedAskUserQuestion({ text: FORMAT_A, post });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toHaveLength(2);
    expect(result.rescued).toBe(true);
    expect(result.questionId).toBe("q-abc");
    expect(result.content).toBe(
      "I looked at the settings page and have a couple of options.\n\n" +
        "Let me know what you prefer.",
    );
    // Nothing appended — the question-card message itself shows the questions.
    expect(result.content).not.toContain("Which scope");
  });

  it("format B: parses, posts, and strips the Kimi token trailer", async () => {
    const [spy, post] = okPost();
    const result = await rescueLeakedAskUserQuestion({ text: FORMAT_B, post });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.rescued).toBe(true);
    expect(result.content).toBe("Here is what I found so far.");
  });

  it("mangled variant: strips only, never posts", async () => {
    const [spy, post] = okPost();
    const result = await rescueLeakedAskUserQuestion({ text: MANGLED, post });
    expect(spy).not.toHaveBeenCalled();
    expect(result.rescued).toBe(false);
    expect(result.content).toBe("Quick check before I continue.");
  });

  it("oversized header/label: truncated payload still posts", async () => {
    const text = `<tool_call>${JSON.stringify({
      tool: "ask_user_question",
      arguments: {
        questions: [
          {
            header: "An extremely long header",
            question: "Truncate me?",
            options: [
              { label: "y".repeat(75), description: "" },
              { label: "No", description: "" },
            ],
          },
        ],
      },
    })}`;
    const [spy, post] = okPost();
    const result = await rescueLeakedAskUserQuestion({ text, post });
    expect(result.rescued).toBe(true);
    const posted = spy.mock.calls[0]![0] as RescuedQuestion[];
    expect(posted[0]!.header.length).toBeLessThanOrEqual(12);
    expect(posted[0]!.options[0]!.label.length).toBeLessThanOrEqual(60);
  });

  it("post failure: strips the syntax and appends a readable markdown fallback", async () => {
    const post = vi.fn(
      async (): Promise<RescuePostOutcome> => ({ ok: false, status: 500 }),
    );
    const result = await rescueLeakedAskUserQuestion({ text: FORMAT_A, post });
    expect(result.rescued).toBe(false);
    expect(result.content).not.toContain("<tool_call>");
    expect(result.content).toContain("Let me know what you prefer.");
    // Readable markdown rendering of the parsed questions.
    expect(result.content).toContain("**Scope**");
    expect(result.content).toContain("Which scope should I target?");
    expect(result.content).toContain(
      "- Web only (Recommended) — Just apps/web.",
    );
  });

  it("post throwing is treated as failure (markdown fallback)", async () => {
    const post = vi.fn(async (): Promise<RescuePostOutcome> => {
      throw new Error("network down");
    });
    const result = await rescueLeakedAskUserQuestion({ text: FORMAT_B, post });
    expect(result.rescued).toBe(false);
    expect(result.content).toContain("**Scope**");
    expect(result.content).not.toContain("functions.ask_user_question");
  });

  it("post 409 (already pending): strips, no fallback appended", async () => {
    const post = vi.fn(
      async (): Promise<RescuePostOutcome> => ({ ok: false, status: 409 }),
    );
    const result = await rescueLeakedAskUserQuestion({ text: FORMAT_A, post });
    expect(result.rescued).toBe(false);
    expect(result.content).toBe(
      "I looked at the settings page and have a couple of options.\n\n" +
        "Let me know what you prefer.",
    );
    expect(result.content).not.toContain("**Scope**");
  });

  it("clean text passes through exactly, without calling post", async () => {
    const [spy, post] = okPost();
    const result = await rescueLeakedAskUserQuestion({
      text: CLEAN_TEXT,
      post,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.rescued).toBe(false);
    expect(result.content).toBe(CLEAN_TEXT);
  });

  it("a different tool's <tool_call> leak passes through exactly", async () => {
    const [spy, post] = okPost();
    const result = await rescueLeakedAskUserQuestion({
      text: OTHER_TOOL_LEAK,
      post,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.rescued).toBe(false);
    expect(result.content).toBe(OTHER_TOOL_LEAK);
  });

  it("null post (eval mode / already asked): strips only", async () => {
    const result = await rescueLeakedAskUserQuestion({
      text: FORMAT_A,
      post: null,
    });
    expect(result.rescued).toBe(false);
    expect(result.content).not.toContain("<tool_call>");
    expect(result.content).not.toContain("**Scope**");
  });
});

// ---------------------------------------------------------------------------
// turnAlreadyAskedUserQuestion
// ---------------------------------------------------------------------------

describe("turnAlreadyAskedUserQuestion", () => {
  const sentinelResult = {
    content: [{ type: "text", text: "Question posted to the user." }],
    details: { thinkworkAskUserQuestion: { endTurn: true } },
  };

  it("true for a non-error ask_user_question invocation carrying the sentinel", () => {
    expect(
      turnAlreadyAskedUserQuestion([
        {
          tool_name: "ask_user_question",
          is_error: false,
          result: sentinelResult,
        },
      ]),
    ).toBe(true);
  });

  it("false for an errored ask invocation", () => {
    expect(
      turnAlreadyAskedUserQuestion([
        {
          tool_name: "ask_user_question",
          is_error: true,
          result: sentinelResult,
        },
      ]),
    ).toBe(false);
  });

  it("false for other tools echoing the sentinel and for empty input", () => {
    expect(
      turnAlreadyAskedUserQuestion([
        { tool_name: "some_mcp_tool", is_error: false, result: sentinelResult },
      ]),
    ).toBe(false);
    expect(turnAlreadyAskedUserQuestion([])).toBe(false);
    expect(turnAlreadyAskedUserQuestion(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createIntakeQuestionPost
// ---------------------------------------------------------------------------

describe("createIntakeQuestionPost", () => {
  const QUESTIONS: RescuedQuestion[] = [
    {
      header: "Scope",
      question: "Which scope?",
      options: [
        { label: "A", description: "" },
        { label: "B", description: "" },
      ],
    },
  ];

  it("POSTs the extension's exact intake request shape", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, questionId: "q-77" }), {
          status: 200,
        }),
    );
    const post = createIntakeQuestionPost({
      apiUrl: "https://api.example.com/",
      apiSecret: "secret-1",
      threadId: "thread-9",
      threadTurnId: "turn-9",
      fetchImpl,
    });
    const outcome = await post(QUESTIONS);
    expect(outcome).toEqual({ ok: true, questionId: "q-77" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example.com/api/threads/thread-9/questions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-1",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      thread_turn_id: "turn-9",
      questions: QUESTIONS,
    });
  });

  it("maps HTTP errors to {ok:false,status} and network errors to {ok:false}", async () => {
    const post409 = createIntakeQuestionPost({
      apiUrl: "https://api.example.com",
      apiSecret: "s",
      threadId: "t",
      threadTurnId: "tt",
      fetchImpl: async () => new Response("conflict", { status: 409 }),
    });
    expect(await post409(QUESTIONS)).toEqual({ ok: false, status: 409 });

    const postDown = createIntakeQuestionPost({
      apiUrl: "https://api.example.com",
      apiSecret: "s",
      threadId: "t",
      threadTurnId: "tt",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await postDown(QUESTIONS)).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// handleInvocation wiring — the rescue runs on the parent turn's final
// assistant content before the writeback (mirrors server.test.ts seams).
// ---------------------------------------------------------------------------

describe("handleInvocation — leaked ask_user_question rescue wiring", () => {
  let workspaceRoot: string | undefined;

  beforeEach(async () => {
    delete process.env.MEMORY_ENGINE;
    delete process.env.AGENTCORE_MEMORY_ID;
    delete process.env.HINDSIGHT_ENDPOINT;
    delete process.env.MEMORY_RETAIN_FN_NAME;
    delete process.env.WORKSPACE_BUCKET;
    delete process.env.WORKSPACE_DIR;
    delete process.env.THINKWORK_PI_AGENT_DIR;
    delete process.env.AGENTCORE_FILES_BUCKET;
    delete process.env.DB_CLUSTER_ARN;
    delete process.env.DB_SECRET_ARN;
    workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "agentcore-pi-rescue-workspace-"),
    );
    process.env.WORKSPACE_DIR = path.join(workspaceRoot, "workspace");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true });
      workspaceRoot = undefined;
    }
  });

  const noopConnect: ConnectMcpServerFn = async () => [];

  function makeRescueDeps(opts: {
    content: string;
    fetchImpl: typeof fetch;
    toolInvocations?: unknown[];
  }) {
    return {
      agentCoreClientFactory: () => ({ send: vi.fn() }) as never,
      s3ClientFactory: () => ({ send: vi.fn() }) as never,
      lambdaClientFactory: () =>
        ({ send: vi.fn(async () => ({})) }) as unknown as LambdaClient,
      connectMcpServerFactory: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      fetchImpl: opts.fetchImpl,
      runAgentLoop: (async () => ({
        content: opts.content,
        modelId: "amazon-bedrock/kimi-k2.5",
        toolsCalled: [],
        toolInvocations: (opts.toolInvocations ?? []) as never,
      })) as never,
      bootstrapWorkspaceImpl: (async () => {}) as never,
      discoverWorkspaceSkillsImpl: (async () => []) as never,
    };
  }

  const PAYLOAD = (overrides: Record<string, unknown> = {}) => ({
    tenant_id: "tenant-1",
    user_id: "user-1",
    assistant_id: "agent-1",
    thread_id: "thread-1",
    tenant_slug: "tenant-1",
    instance_id: "agent-slug",
    trace_id: "trace-1",
    message: "Hello pi",
    thread_turn_id: "turn-1",
    thinkwork_api_url: "https://api.example.com",
    thinkwork_api_secret: "test-secret-do-not-leak",
    ...overrides,
  });

  it("re-posts the leaked questions through the intake and strips the response content", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, questionId: "q-9" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: PAYLOAD(),
      deps: makeRescueDeps({ content: FORMAT_A, fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const intakeCall = calls.find(([url]) =>
      String(url).includes("/api/threads/thread-1/questions"),
    );
    expect(intakeCall).toBeDefined();
    const body = JSON.parse((intakeCall![1] as RequestInit).body as string);
    expect(body.thread_turn_id).toBe("turn-1");
    expect(body.questions).toHaveLength(2);

    const response = result.body.response as Record<string, unknown>;
    expect(response.content).toBe(
      "I looked at the settings page and have a couple of options.\n\n" +
        "Let me know what you prefer.",
    );
  });

  it("eval_mode: strips only, never posts to the intake", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: PAYLOAD({ eval_mode: true }),
      deps: makeRescueDeps({ content: FORMAT_B, fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([url]) => String(url).includes("/questions"))).toBe(
      false,
    );
    const response = result.body.response as Record<string, unknown>;
    expect(response.content).toBe("Here is what I found so far.");
  });

  it("skips the post when the turn already asked natively (sentinel present)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: PAYLOAD(),
      deps: makeRescueDeps({
        content: FORMAT_A,
        fetchImpl,
        toolInvocations: [
          {
            id: "call-1",
            name: "ask_user_question",
            tool_name: "ask_user_question",
            is_error: false,
            result: {
              content: [{ type: "text", text: "Question posted." }],
              details: { thinkworkAskUserQuestion: { endTurn: true } },
            },
          },
        ],
      }),
    });

    expect(result.statusCode).toBe(200);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([url]) => String(url).includes("/questions"))).toBe(
      false,
    );
    const response = result.body.response as Record<string, unknown>;
    expect(response.content).not.toContain("<tool_call>");
  });

  it("clean content stays byte-identical and triggers no intake traffic", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: PAYLOAD(),
      deps: makeRescueDeps({ content: CLEAN_TEXT, fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(0);
    const response = result.body.response as Record<string, unknown>;
    expect(response.content).toBe(CLEAN_TEXT);
  });
});
