import { describe, expect, it } from "vitest";

import {
  EMIT_JSON_RENDER_UI_TOOL_NAME,
  THREAD_JSON_RENDER_UI_CAPABILITY,
  threadJsonRenderUiEnabledFromAgentConfig,
} from "./capability.js";

describe("threadJsonRenderUiEnabledFromAgentConfig (THINK-291)", () => {
  it("treats an absent column value as enabled (default-on)", () => {
    expect(threadJsonRenderUiEnabledFromAgentConfig(null, [])).toBe(true);
    expect(threadJsonRenderUiEnabledFromAgentConfig(undefined, [])).toBe(true);
  });

  it("follows the explicit enabled flag", () => {
    expect(
      threadJsonRenderUiEnabledFromAgentConfig({ enabled: true }, []),
    ).toBe(true);
    expect(
      threadJsonRenderUiEnabledFromAgentConfig({ enabled: false }, []),
    ).toBe(false);
    // Missing key inside an object config = enabled (column default shape).
    expect(threadJsonRenderUiEnabledFromAgentConfig({}, [])).toBe(true);
  });

  it("treats malformed config as enabled rather than silently degrading", () => {
    expect(threadJsonRenderUiEnabledFromAgentConfig("garbage", [])).toBe(true);
    expect(threadJsonRenderUiEnabledFromAgentConfig([1, 2], [])).toBe(true);
  });

  it("is vetoed by blocked_tools under either name", () => {
    for (const blocked of [
      THREAD_JSON_RENDER_UI_CAPABILITY,
      EMIT_JSON_RENDER_UI_TOOL_NAME,
    ]) {
      expect(
        threadJsonRenderUiEnabledFromAgentConfig({ enabled: true }, [blocked]),
      ).toBe(false);
    }
  });
});
