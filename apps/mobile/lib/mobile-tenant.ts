export type TenantSourceComputer = {
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
