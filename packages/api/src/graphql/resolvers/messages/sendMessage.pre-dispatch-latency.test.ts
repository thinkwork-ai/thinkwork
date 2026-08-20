/**
 * THINK-946 — the sendMessage → chat-agent-invoke pre-path.
 *
 * The mutation used to run its independent reads (caller identity, thread
 * row, mention targets, budget status) as a chain of serial DB round trips
 * ahead of the Event invoke. These are structural pins on the trimmed shape:
 * the resolver has no harness that can exercise it without mocking the whole
 * Drizzle surface, so the invariants are asserted against the source the same
 * way the THINK-170 retirement pins are.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mutationSource = readFileSync(
  new URL("./sendMessage.mutation.ts", import.meta.url),
  "utf8",
);

describe("sendMessage pre-dispatch path (THINK-946)", () => {
  it("stamps the mutation start and forwards it to the direct dispatch", () => {
    expect(mutationSource).toContain("const mutationStartedAtMs = Date.now()");
    expect(mutationSource).toContain(
      "dispatchRequestedAtMs: mutationStartedAtMs",
    );
  });

  it("resolves caller identity and the thread row in one round trip", () => {
    expect(mutationSource).toContain(
      "const [callerUserId, threadRows] = await Promise.all(",
    );
    // The old serial form awaited the caller inline in the senderId ternary.
    expect(mutationSource).not.toContain(
      "((await resolveCallerFromAuth(ctx.auth)).userId ?? i.senderId)",
    );
  });

  it("loads mention targets concurrently with the metadata/approval checks", () => {
    expect(mutationSource).toContain("const mentionTargetsPromise =");
    expect(mutationSource).toContain(
      "const mentionTargets = await mentionTargetsPromise",
    );
  });

  it("starts the budget lookup alongside the Thread Mode derivation", () => {
    expect(mutationSource).toContain("const budgetStatusPromise =");
    expect(mutationSource).toContain(
      "const budget = await budgetStatusPromise",
    );
  });

  it("still rejects only a send that would actually dispatch a turn", () => {
    expect(mutationSource).toContain(
      "if (wouldDispatchAgentTurn && budget?.overBudget)",
    );
    expect(mutationSource).toContain('code: "BUDGET_EXCEEDED"');
  });

  it("keeps the budget lookup failing open", () => {
    // A broken budget lookup must not take down chat — the chat-agent-invoke
    // gate is the backstop.
    expect(mutationSource).toContain("[sendMessage] budget pre-check failed:");
    expect(mutationSource).toContain("return null;");
  });
});
