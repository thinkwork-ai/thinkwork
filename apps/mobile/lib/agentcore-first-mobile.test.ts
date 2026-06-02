import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("AgentCore-first mobile execution guard", () => {
  it("does not expose on-device chat or harness smoke entrypoints", () => {
    expect(read("components/chat/ChatScreen.tsx")).not.toMatch(
      /useHarnessChat|on-device|OnDeviceChatScreen/,
    );
    expect(read("package.json")).not.toMatch(/smoke:pi-harness|just-bash/);
  });

  it("does not keep mobile just-bash resolver aliases", () => {
    expect(read("metro.config.js")).not.toContain("just-bash");
    expect(read("vitest.config.ts")).not.toContain("just-bash");
  });

  it("removes the deleted mobile harness files", () => {
    for (const file of [
      "hooks/useHarnessChat.ts",
      "lib/agent/thread-turn.ts",
      "lib/agent/harness-chat-core.ts",
      "lib/agent/extensions/local-bash-extension.ts",
      "lib/agent/providers/bedrock.ts",
      "scripts/pi-harness-smoke.ts",
      "scripts/pi-device-smoke.md",
      "types/just-bash-browser.d.ts",
    ]) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }
  });
});
