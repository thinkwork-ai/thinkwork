import { afterEach, describe, expect, it } from "vitest";
import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import {
  ModelResolutionError,
  defaultModelId,
  mapStopReason,
  parseConverseOutput,
  resolveModelId,
  toConverseMessages,
  toToolConfig,
  type WireMessage,
} from "./converse-mapping";

/** Build a partial Converse output fixture typed as the full SDK shape. */
const out = (x: unknown): ConverseCommandOutput =>
  x as unknown as ConverseCommandOutput;

const ALLOW = [
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
];

afterEach(() => {
  delete process.env.MOBILE_BEDROCK_MODEL_ALLOWLIST;
  delete process.env.MOBILE_BEDROCK_DEFAULT_MODEL_ID;
});

describe("resolveModelId", () => {
  it("returns the configured default when no model is requested", () => {
    expect(resolveModelId(undefined, ALLOW)).toBe(ALLOW[0]);
    expect(resolveModelId("", ALLOW)).toBe(ALLOW[0]);
  });

  it("accepts an allowlisted inference-profile id", () => {
    expect(resolveModelId(ALLOW[1], ALLOW)).toBe(ALLOW[1]);
  });

  it("rejects an id missing the inference-profile prefix (no silent fallback)", () => {
    expect(() =>
      resolveModelId("anthropic.claude-sonnet-4-5-20250929-v1:0", ALLOW),
    ).toThrow(ModelResolutionError);
  });

  it("rejects a prefixed but non-allowlisted id", () => {
    expect(() =>
      resolveModelId("us.anthropic.claude-opus-4-1-v1:0", ALLOW),
    ).toThrow(/not in the allowlist/);
  });

  it("reads the allowlist + default from env when set", () => {
    process.env.MOBILE_BEDROCK_MODEL_ALLOWLIST =
      "us.foo.bar-v1:0, us.baz.qux-v1:0";
    expect(defaultModelId()).toBe("us.foo.bar-v1:0");
    expect(resolveModelId("us.baz.qux-v1:0")).toBe("us.baz.qux-v1:0");
    expect(() => resolveModelId("us.nope-v1:0")).toThrow(ModelResolutionError);
  });
});

describe("mapStopReason", () => {
  it("maps Bedrock stop reasons to wire stop reasons", () => {
    expect(mapStopReason("end_turn")).toBe("end");
    expect(mapStopReason("stop_sequence")).toBe("end");
    expect(mapStopReason("tool_use")).toBe("tool_use");
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
    expect(mapStopReason("guardrail_intervened")).toBe("error");
    expect(mapStopReason(undefined)).toBe("error");
  });
});

describe("toToolConfig", () => {
  it("returns undefined for no tools", () => {
    expect(toToolConfig(undefined)).toBeUndefined();
    expect(toToolConfig([])).toBeUndefined();
  });

  it("maps tool specs to Bedrock toolSpec entries", () => {
    const cfg = toToolConfig([
      { name: "echo", description: "echoes", parameters: { type: "object" } },
    ]);
    expect(cfg?.tools?.[0]).toEqual({
      toolSpec: {
        name: "echo",
        description: "echoes",
        inputSchema: { json: { type: "object" } },
      },
    });
  });
});

describe("toConverseMessages", () => {
  it("maps a user string message to a text block", () => {
    expect(toConverseMessages([{ role: "user", content: "hi" }])).toEqual([
      { role: "user", content: [{ text: "hi" }] },
    ]);
  });

  it("maps an assistant message with text + tool calls to text + toolUse blocks", () => {
    const msgs: WireMessage[] = [
      {
        role: "assistant",
        content: "let me check",
        toolCalls: [{ id: "c1", name: "echo", arguments: { v: 1 } }],
      },
    ];
    expect(toConverseMessages(msgs)).toEqual([
      {
        role: "assistant",
        content: [
          { text: "let me check" },
          { toolUse: { toolUseId: "c1", name: "echo", input: { v: 1 } } },
        ],
      },
    ]);
  });

  it("coalesces consecutive tool results into one user message", () => {
    const msgs: WireMessage[] = [
      { role: "tool", toolCallId: "c1", name: "a", content: "ra" },
      {
        role: "tool",
        toolCallId: "c2",
        name: "b",
        content: "rb",
        isError: true,
      },
    ];
    const out = toConverseMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toEqual([
      {
        toolResult: {
          toolUseId: "c1",
          content: [{ text: "ra" }],
          status: "success",
        },
      },
      {
        toolResult: {
          toolUseId: "c2",
          content: [{ text: "rb" }],
          status: "error",
        },
      },
    ]);
  });

  it("flushes pending tool results before a following non-tool message", () => {
    const msgs: WireMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "a", arguments: {} }],
      },
      { role: "tool", toolCallId: "c1", name: "a", content: "r" },
      { role: "user", content: "and now this" },
    ];
    const out = toConverseMessages(msgs);
    expect(out.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "user",
    ]);
    // the tool-result user message precedes the next real user message
    expect(out[2].content?.[0]).toHaveProperty("toolResult");
    expect(out[3].content).toEqual([{ text: "and now this" }]);
  });

  it("maps a user message image to a Converse image block with decoded bytes", () => {
    const data = Buffer.from("hello-bytes").toString("base64");
    const out = toConverseMessages([
      {
        role: "user",
        content: "what's on this card?",
        images: [{ format: "jpeg", data }],
      },
    ]);
    expect(out).toHaveLength(1);
    const blocks = out[0].content ?? [];
    expect(blocks[0]).toEqual({ text: "what's on this card?" });
    const imageBlock = blocks[1] as {
      image?: { format?: string; source?: { bytes?: Uint8Array } };
    };
    expect(imageBlock.image?.format).toBe("jpeg");
    expect(
      Buffer.from(imageBlock.image?.source?.bytes as Uint8Array).toString(),
    ).toBe("hello-bytes");
  });

  it("emits image-only content when a user message has images but no text", () => {
    const data = Buffer.from("x").toString("base64");
    const out = toConverseMessages([
      { role: "user", content: "", images: [{ format: "png", data }] },
    ]);
    const blocks = out[0].content ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveProperty("image");
  });
});

describe("parseConverseOutput", () => {
  it("extracts text, usage, and stop reason", () => {
    const parsed = parseConverseOutput(
      out({
        output: {
          message: { role: "assistant", content: [{ text: "hello" }] },
        },
        stopReason: "end_turn",
        usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      }),
    );
    expect(parsed.text).toBe("hello");
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.stopReason).toBe("end");
    expect(parsed.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("extracts tool calls from toolUse blocks", () => {
    const parsed = parseConverseOutput(
      out({
        output: {
          message: {
            role: "assistant",
            content: [
              { text: "calling" },
              { toolUse: { toolUseId: "t1", name: "echo", input: { x: 1 } } },
            ],
          },
        },
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    );
    expect(parsed.text).toBe("calling");
    expect(parsed.toolCalls).toEqual([
      { id: "t1", name: "echo", arguments: { x: 1 } },
    ]);
    expect(parsed.stopReason).toBe("tool_use");
  });

  it("defaults usage to zero when absent", () => {
    const parsed = parseConverseOutput(
      out({ output: { message: { role: "assistant", content: [] } } }),
    );
    expect(parsed.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
