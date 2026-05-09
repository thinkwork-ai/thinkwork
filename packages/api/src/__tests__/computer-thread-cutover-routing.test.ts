import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Computer-owned thread turn routing", () => {
  const createThreadSource = source(
    "../graphql/resolvers/threads/createThread.mutation.ts",
  );
  const sendMessageSource = source(
    "../graphql/resolvers/messages/sendMessage.mutation.ts",
  );

  it("routes new Computer-owned chat threads through computer_tasks without Agent wakeups", () => {
    expect(createThreadSource).toContain("resolveThreadComputer");
    expect(createThreadSource).toContain("computer_id: threadComputer?.id");
    expect(createThreadSource).toContain("await enqueueComputerThreadTurn");
    expect(createThreadSource).not.toContain("agentWakeupRequests");
  });

  it("routes mobile/admin user messages through Computer thread_turn tasks only", () => {
    expect(sendMessageSource).toContain("thread.computer_id");
    expect(sendMessageSource).toContain("await enqueueComputerThreadTurn");
    expect(sendMessageSource).toContain(
      "Agent fallback is intentionally disabled",
    );
    expect(sendMessageSource).not.toContain("agentWakeupRequests");
  });

  it("dispatches Computer thread_turn tasks into the Strands invoke path", () => {
    const threadCutoverSource = source("../lib/computers/thread-cutover.ts");
    expect(threadCutoverSource).toContain("invokeChatAgent");
    expect(threadCutoverSource).toContain("computerTaskId: input.taskId");
    expect(threadCutoverSource).toContain('runtime: "strands"');
    expect(threadCutoverSource).toContain("thread_turn_dispatched");
  });
});
