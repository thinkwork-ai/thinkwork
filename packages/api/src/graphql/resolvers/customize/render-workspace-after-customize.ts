/**
 * Customize bindings no longer rewrite AGENTS.md in the background. The
 * editor save path refreshes derived sections synchronously after file writes,
 * preserving operator-owned AGENTS.md prose between edits.
 */
export async function renderWorkspaceAfterCustomize(
  _resolverName: string,
  _agentId: string | null,
  _computerId: string,
): Promise<void> {
  return;
}
