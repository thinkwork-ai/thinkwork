/**
 * Module-level cache for KnowledgeGraph state so the view survives
 * navigation to detail screens + back without losing camera position or
 * node layout. Lives for the lifetime of the JS runtime (not persisted
 * across cold app launches — that's an intentional scope choice; a
 * fresh app session starts fresh).
 *
 * Key format: `${tenantId}:${agentId}` for the main agent-scoped graph.
 */

export interface CachedGraphState {
  tx: number;
  ty: number;
  scale: number;
  positions: Map<string, { x: number; y: number }>;
}

const store = new Map<string, CachedGraphState>();

export function saveGraphState(key: string, entry: CachedGraphState): void {
  store.set(key, entry);
}

export function loadGraphState(key: string): CachedGraphState | null {
  return store.get(key) ?? null;
}

export function clearGraphState(key: string): void {
  store.delete(key);
}
