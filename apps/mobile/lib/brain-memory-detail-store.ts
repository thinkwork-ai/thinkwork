import type { ContextEngineHit } from "@thinkwork/react-native-sdk";

const memoryHits = new Map<string, ContextEngineHit>();

export function rememberBrainMemoryHit(hit: ContextEngineHit) {
  memoryHits.set(hit.id, hit);
}

export function getRememberedBrainMemoryHit(id: string) {
  return memoryHits.get(id);
}
