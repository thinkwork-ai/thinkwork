/**
 * Compatibility hooks between native Work Items and legacy linked_tasks.
 *
 * U3 wires Customer Onboarding dual-write/read behavior here. The substrate PR
 * keeps this module intentionally inert so API consumers can import one stable
 * adapter before onboarding starts writing native Work Items.
 */

export interface LinkedTaskCompatUpdate {
  tenantId: string;
  workItemId: string;
  statusCategory: string;
  threadId?: string | null;
}

export async function syncLinkedTaskFromWorkItem(
  _input: LinkedTaskCompatUpdate,
): Promise<void> {
  return;
}
