export type TenantSourceComputer = {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  status?: string | null;
};

export function activeAssignedComputers<T extends TenantSourceComputer>(
  computers: readonly T[] | null | undefined,
): T[] {
  return (computers ?? []).filter((computer) => computer.status !== "archived");
}

export function resolveMobileTenantId(
  authTenantId: string | null | undefined,
  meTenantId: string | null | undefined,
  computers: readonly TenantSourceComputer[] | null | undefined,
): string | null {
  return (
    authTenantId ??
    meTenantId ??
    activeAssignedComputers(computers).find((computer) => computer.tenantId)
      ?.tenantId ??
    null
  );
}

export function agentsAsComputers<
  T extends {
    id?: string | null;
    name?: string | null;
    slug?: string | null;
    status?: string | null;
    tenantId?: string | null;
  },
>(agents: readonly T[] | null | undefined, tenantId?: string | null) {
  return (agents ?? [])
    .filter((agent) => agent.id && agent.status !== "archived")
    .map((agent) => ({
      id: agent.id!,
      agentId: agent.id!,
      name: agent.name ?? agent.slug ?? "Agent",
      slug: agent.slug ?? agent.id!,
      status: agent.status ?? null,
      tenantId: agent.tenantId ?? tenantId ?? null,
    }));
}
