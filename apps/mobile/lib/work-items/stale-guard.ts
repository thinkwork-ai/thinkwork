export function isStale(
  knownStatusId: string | null | undefined,
  freshStatusId: string | null | undefined,
): boolean {
  return (knownStatusId ?? null) !== (freshStatusId ?? null);
}
