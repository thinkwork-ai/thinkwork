import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Context,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import { createPiGoalExtensionFactory } from "./pi-goal-adapter.js";

/**
 * THINK-222 — Pi goal mode never engages in the headless wakeup host.
 *
 * The headless host (runAgentLoop) sends the goal-mode turn as a single
 * `session.prompt("/goal --tokens N <objective>")`. The /goal command handler
 * stores goal state and delivers the actual kickoff user message via
 * `pi.sendUserMessage(...)` — which the vendored extension awaits. When the
 * SDK's extension bindings drop that promise (fire-and-forget), prompt()
 * resolves with NO model turn run: the host reads an empty transcript, the
 * container backstop synthesizes a greeting, and no goal evidence exists.
 *
 * This test drives the REAL AgentSession + the real vendored goal extension
 * against pi-ai's faux provider and asserts the whole goal arc — kickoff
 * prompt delivered to the model, goal system rules injected, goal_complete
 * executed — has happened by the time `session.prompt()` resolves, exactly
 * what the headless host requires.
 */
describe("pi-goal headless engagement (THINK-222)", () => {
  const registrations: Array<{ unregister: () => void }> = [];

  afterAll(() => {
    for (const registration of registrations) registration.unregister();
  });

  it("session.prompt('/goal …') runs the kickoff turn to completion before resolving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-goal-headless-"));
    const agentDir = join(dir, "agent");

    const contexts: Context[] = [];
    const faux = registerFauxProvider({
      models: [{ id: "faux-goal-model" }],
    });
    registrations.push(faux);
    faux.setResponses([
      // Kickoff turn: the model completes the goal via the extension tool.
      (context) => {
        contexts.push(context);
        return fauxAssistantMessage(
          [
            fauxToolCall("goal_complete", {
              summary: "Verified: the test objective is done.",
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      // Any additional turn the session might run (post-tool follow-up).
      (context) => {
        contexts.push(context);
        return fauxAssistantMessage([fauxText("done")]);
      },
    ]);

    const model = faux.getModel();
    const authStorage = AuthStorage.create(join(dir, "auth.json"));
    authStorage.setRuntimeApiKey(model.provider, "faux-key");
    const modelRegistry = ModelRegistry.create(
      authStorage,
      join(dir, "models.json"),
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir,
      systemPromptOverride: () => "You are a headless test agent.",
      extensionFactories: [createPiGoalExtensionFactory({ agentDir })],
    });
    await resourceLoader.reload();

    const sessionManager = SessionManager.inMemory(dir);
    const { session, extensionsResult } = await createAgentSession({
      cwd: dir,
      agentDir,
      authStorage,
      modelRegistry,
      model,
      tools: ["goal_complete"],
      resourceLoader,
      sessionManager,
    });
    expect(extensionsResult?.errors ?? []).toEqual([]);

    const objective =
      "Reply with one short confirmation sentence, then call goal_complete.";
    try {
      await session.prompt(`/goal --tokens 5000 ${objective}`);

      // The kickoff turn must have run before prompt() resolved — the headless
      // host reads the transcript immediately after this await.
      expect(contexts.length).toBeGreaterThanOrEqual(1);

      // The model saw the goal kickoff prompt carrying the objective…
      const kickoff = contexts[0]!;
      const userMessages = kickoff.messages.filter(
        (message) => message.role === "user",
      );
      const lastUser = userMessages.at(-1);
      expect(JSON.stringify(lastUser?.content ?? "")).toContain(
        "goal_objective",
      );
      expect(JSON.stringify(lastUser?.content ?? "")).toContain(
        "call goal_complete",
      );

      // …under a system prompt that includes the goal-mode rules.
      expect(kickoff.systemPrompt).toContain("Goal-mode rules");

      // goal_complete executed inside the awaited turn: its tool result is in
      // the transcript and the persisted goal state reached "complete".
      const toolResults = session.messages.filter(
        (message) =>
          message.role === "toolResult" &&
          (message as { toolName?: string }).toolName === "goal_complete",
      );
      expect(toolResults).toHaveLength(1);

      const goalStates = sessionManager
        .getBranch()
        .filter(
          (entry) =>
            (entry as { type?: string; customType?: string }).type ===
              "custom" &&
            (entry as { customType?: string }).customType === "goal-state",
        )
        .map(
          (entry) =>
            (entry as { data?: { goal?: { status?: string } | null } }).data
              ?.goal ?? null,
        );
      expect(
        goalStates.some((goal) => goal?.status === "complete"),
      ).toBe(true);
    } finally {
      session.dispose();
    }
  }, 30_000);
});
