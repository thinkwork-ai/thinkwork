import { describe, expect, it } from "vitest";
import { loadExtensions } from "../load-extensions";
import { localBashExtension } from "../local-bash-extension";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("localBashExtension", () => {
  it("registers a local bash tool and executes commands in the sandbox", async () => {
    const loaded = await loadExtensions(
      [localBashExtension({ sessionId: "test-bash-basic" })],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash");

    expect(bash).toBeDefined();
    const result = await bash!.execute(
      { command: "printf MOBILE-PI-BASH-SMOKE-OK" },
      {},
    );

    expect(result).toEqual({
      content: "MOBILE-PI-BASH-SMOKE-OK",
      isError: false,
    });
  });

  it("keeps an in-memory filesystem per thread session", async () => {
    const loaded = await loadExtensions(
      [localBashExtension({ sessionId: "test-bash-fs" })],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash")!;

    await bash.execute({ command: "printf saved > note.txt" }, {});
    const result = await bash.execute({ command: "cat note.txt" }, {});

    expect(result.content).toBe("saved");
    expect(result.isError).toBe(false);
  });

  it("marks non-zero exits as tool errors", async () => {
    const loaded = await loadExtensions(
      [localBashExtension({ sessionId: "test-bash-failure" })],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash")!;
    const result = await bash.execute(
      { command: 'printf "nope" >&2; exit 7' },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("stderr:");
    expect(result.content).toContain("nope");
    expect(result.content).toContain("exitCode: 7");
  });

  it("composes prompt guidance for the local mobile sandbox", async () => {
    const loaded = await loadExtensions(
      [localBashExtension({ sessionId: "test-bash-prompt" })],
      { logger: silentLogger },
    );
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });

    expect(composed.systemPrompt).toContain("local `bash` tool");
    expect(composed.systemPrompt).toContain("mobile app");
    expect(composed.systemPrompt).toContain("public internet access enabled");
    expect(composed.systemPrompt).toContain("Private/loopback");
  });
});
