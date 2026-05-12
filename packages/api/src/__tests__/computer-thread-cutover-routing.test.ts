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
    expect(createThreadSource).toContain(
      "await routeRunbookForComputerMessage",
    );
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
    const chatInvokeSource = source("../handlers/chat-agent-invoke.ts");

    expect(threadCutoverSource).toContain("invokeChatAgent");
    expect(threadCutoverSource).toContain("ensureArtifactBuilderDefaults");
    expect(threadCutoverSource).toContain("computerTaskId: input.taskId");
    expect(threadCutoverSource).toContain('runtime: "strands"');
    expect(threadCutoverSource).toContain("artifact_builder_defaults_seeded");
    expect(threadCutoverSource).toContain("thread_turn_dispatched");
    expect(chatInvokeSource).toMatch(
      /event\.computerId && \(event\.computerTaskId \|\| responseOnly\)\s+\? "strands"/,
    );
    expect(chatInvokeSource).toContain(
      "resolveRuntimeFunctionName(runtimeType)",
    );
  });

  it("fails linked runbook tasks when AgentCore invocation fails before recording a response", () => {
    const chatInvokeSource = source("../handlers/chat-agent-invoke.ts");

    expect(chatInvokeSource).toContain(
      "const runbookRunId = runbookRunIdFromContext(event.runbookContext)",
    );
    expect(chatInvokeSource).toContain(
      "await markRunbookFailedFromChatInvokeError",
    );
    expect(chatInvokeSource).toContain(
      "await markComputerTaskFailedFromChatInvokeError",
    );
    expect(chatInvokeSource).toContain("eq(computerTasks.id, input.taskId)");
    expect(chatInvokeSource).toContain(
      'code: "agentcore_lambda_function_error"',
    );
    expect(chatInvokeSource).toContain('code: "agentcore_adapter_error"');
    expect(chatInvokeSource).toContain(
      "I hit a runtime error while executing this runbook.",
    );
  });

  it("marks response-only runbook steps so AgentCore does not persist them as thread turns", () => {
    const chatInvokeSource = source("../handlers/chat-agent-invoke.ts");

    expect(chatInvokeSource).toContain(
      'computer_response_mode: responseOnly ? "runbook_step" : "thread_turn"',
    );
    expect(chatInvokeSource).toContain('responseMode?: "runbook_step"');
    expect(chatInvokeSource).toContain(
      "await completeRunbookStepFromChatInvoke",
    );
  });

  it("prepares runbook step AgentCore invocations without dispatching chat-agent-invoke", () => {
    const runbookRuntimeSource = source("../lib/runbooks/runtime-api.ts");

    expect(runbookRuntimeSource).toContain(
      "prepareRunbookStepAgentInvocation",
    );
    expect(runbookRuntimeSource).toContain(
      'provider: "bedrock-agentcore" as const',
    );
    expect(runbookRuntimeSource).toContain(
      'computer_response_mode: "runbook_step"',
    );
    expect(runbookRuntimeSource).not.toContain("getChatAgentInvokeFnArn");
    expect(runbookRuntimeSource).not.toContain("InvocationType: \"Event\"");
  });
});
