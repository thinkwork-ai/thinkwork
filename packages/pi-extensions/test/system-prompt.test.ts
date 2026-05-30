import type {
  ExtensionAPI,
  ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { toExtensionFactory } from "../src/define-extension.js";
import {
  composeSystemPrompt,
  createSystemPromptExtension,
  type WorkspaceFileReader,
} from "../src/system-prompt.js";

const NO_CTX = undefined as never;

function makeFakeApi() {
  const handlers = new Map<string, ExtensionHandler<any, any>>();
  const api = {
    registerTool: () => {},
    on: (event: string, handler: ExtensionHandler<any, any>) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return { api, handlers };
}

/** Virtual workspace reader so composition is deterministic without disk I/O. */
function readerFor(files: Record<string, string>): WorkspaceFileReader {
  return async (filePath) => {
    const name = filePath.split("/").pop() ?? filePath;
    return files[name] ?? null;
  };
}

const FIXED_NOW = new Date("2026-05-30T12:00:00Z");

describe("composeSystemPrompt (moved to pi-extensions, parity preserved)", () => {
  it("orders date → requester → tool policy → workspace files → skills", async () => {
    const prompt = await composeSystemPrompt({
      payload: {
        user_id: "u1",
        current_user_name: "Ada",
        current_user_email: "ada@example.com",
      },
      workspaceDir: "/ws",
      availableToolNames: ["execute_code"],
      workspaceSkillsBlock: "## Skills\n- demo",
      now: FIXED_NOW,
      fileReader: readerFor({
        "AGENTS.md": "AGENTS BODY",
        "GUARDRAILS.md": "GUARDRAILS BODY",
        "USER.md": "USER BODY",
      }),
    });

    expect(prompt).toContain("Current date:");
    expect(prompt).toContain("<current_requester>");
    expect(prompt).toContain("ada@example.com");
    expect(prompt).toContain("## Runtime Tool Policy");
    expect(prompt).toContain("`bash` tool is not available");
    expect(prompt).toContain("`execute_code` tool is available");
    expect(prompt).toContain("AGENTS BODY");
    expect(prompt).toContain("USER BODY");
    expect(prompt).toContain("## Skills");
    // Date is first; skills are last.
    expect(prompt.indexOf("AGENTS BODY")).toBeLessThan(
      prompt.indexOf("## Skills"),
    );
  });

  it("omits USER.md when there is no user id", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/ws",
      now: FIXED_NOW,
      fileReader: readerFor({ AGENTS_unused: "x", "USER.md": "USER BODY" }),
    });
    expect(prompt).not.toContain("USER BODY");
  });

  it("distinguishes host-contained bash from execute_code when both are available", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/ws",
      availableToolNames: ["bash", "execute_code"],
      now: FIXED_NOW,
      fileReader: readerFor({ "AGENTS.md": "AGENTS BODY" }),
    });

    expect(prompt).toContain("Pi host `bash` tool is available");
    expect(prompt).toContain("contained workspace sandbox");
    expect(prompt).toContain("Treat `bash` and `execute_code` as distinct");
    expect(prompt).toContain("use `bash` for the Pi workspace/shell");
    expect(prompt).toContain("tenant Code Interpreter sandbox");
  });
});

describe("createSystemPromptExtension", () => {
  it("has a stable name and declares no tools", () => {
    const ext = createSystemPromptExtension({
      payload: {},
      workspaceDir: "/ws",
    });
    expect(ext.name).toBe("thinkwork-system-prompt");
    expect(ext.toolNames ?? []).toEqual([]);
  });

  it("composes the prompt in before_agent_start and reports it via onComposed", async () => {
    let composed = "";
    const { api, handlers } = makeFakeApi();
    await toExtensionFactory(
      createSystemPromptExtension({
        payload: { user_id: "u1" },
        workspaceDir: "/ws",
        now: FIXED_NOW,
        fileReader: readerFor({ "AGENTS.md": "AGENTS BODY" }),
        onComposed: (p) => {
          composed = p;
        },
      }),
      {},
    )(api);

    const result = await handlers.get("before_agent_start")!(
      {
        type: "before_agent_start",
        prompt: "hi",
        systemPrompt: "pi-default",
        systemPromptOptions: {} as never,
      },
      NO_CTX,
    );

    expect(result?.systemPrompt).toContain("AGENTS BODY");
    expect(composed).toBe(result?.systemPrompt);
  });

  it("appends the suffix (e.g. attachment preamble) after the composed prompt", async () => {
    const { api, handlers } = makeFakeApi();
    await toExtensionFactory(
      createSystemPromptExtension({
        payload: {},
        workspaceDir: "/ws",
        now: FIXED_NOW,
        fileReader: readerFor({ "AGENTS.md": "AGENTS BODY" }),
        suffix: "ATTACHMENT PREAMBLE",
      }),
      {},
    )(api);

    const result = await handlers.get("before_agent_start")!(
      {
        type: "before_agent_start",
        prompt: "hi",
        systemPrompt: "pi-default",
        systemPromptOptions: {} as never,
      },
      NO_CTX,
    );

    expect(result?.systemPrompt).toMatch(
      /AGENTS BODY[\s\S]*ATTACHMENT PREAMBLE$/,
    );
  });
});
