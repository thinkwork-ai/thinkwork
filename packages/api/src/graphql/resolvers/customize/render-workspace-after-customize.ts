/**
 * Helper invoked by the 6 Customize mutations
 * (enableConnector / disableConnector / enableSkill / disableSkill /
 * enableWorkflow / disableWorkflow) after a binding write commits, to
 * regenerate the agent's `AGENTS.md` workspace map so the Strands
 * runtime sees the new customization on its next sync.
 *
 * - Synchronous (`await`) per the parent plan and
 *   `feedback_avoid_fire_and_forget_lambda_invokes`. Renderer failures
 *   are logged but non-fatal — the binding write already succeeded; a
 *   stale AGENTS.md is preferable to a phantom rollback in the user's UX.
 * - Skips entirely when `agentId` is null (no primary agent → no workspace
 *   to project against). Mirrors the silent no-op the disable resolvers
 *   already use for the binding write itself.
 *
 * Plan: docs/plans/2026-05-09-011-feat-customize-workspace-renderer-plan.md U7-2.
 */
export async function renderWorkspaceAfterCustomize(
  resolverName: string,
  agentId: string | null,
  computerId: string,
): Promise<void> {
  if (!agentId) return;
  try {
    const { regenerateWorkspaceMap } = await import(
      "../../../lib/workspace-map-generator.js"
    );
    await regenerateWorkspaceMap(agentId, computerId);
  } catch (err) {
    // Match the existing setAgentSkills log shape so CloudWatch filters
    // keyed on "regenerateWorkspaceMap failed" continue to surface these.
    // Trailing context note documents the binding-state invariant.
    console.error(
      `[${resolverName}] regenerateWorkspaceMap failed (binding write committed; stale AGENTS.md until next render):`,
      err,
    );
  }
}
