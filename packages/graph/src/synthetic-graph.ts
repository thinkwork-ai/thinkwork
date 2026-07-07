/**
 * Deterministic synthetic clustered-graph generator for scale validation
 * (THINK-212 U6). Community-structured and hub-heavy to mirror a mature
 * tenant brain: most edges land inside a community, a few bridge across,
 * and each community has a hub that concentrates degree.
 */

export type SyntheticGraph = {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string; label: string }[];
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSyntheticGraph({
  nodeCount = 10000,
  communityCount = 40,
  intraEdgesPerNode = 4,
  bridgeEdges = 500,
  hubFanout = 120,
  seed = 42,
}: {
  nodeCount?: number;
  communityCount?: number;
  intraEdgesPerNode?: number;
  bridgeEdges?: number;
  hubFanout?: number;
  seed?: number;
} = {}): SyntheticGraph {
  const rng = mulberry32(seed);
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
  }));

  const communityOf = (i: number) => i % communityCount;
  const membersOf: number[][] = Array.from(
    { length: communityCount },
    () => [],
  );
  for (let i = 0; i < nodeCount; i += 1) membersOf[communityOf(i)]!.push(i);

  const links: SyntheticGraph["links"] = [];
  const pick = (arr: number[]) => arr[Math.floor(rng() * arr.length)]!;

  // Intra-community edges — the bulk of the structure.
  for (let i = 0; i < nodeCount; i += 1) {
    const members = membersOf[communityOf(i)]!;
    for (let e = 0; e < intraEdgesPerNode; e += 1) {
      const other = pick(members);
      if (other === i) continue;
      links.push({ source: `n${i}`, target: `n${other}`, label: "relates" });
    }
  }

  // Hubs: first member of each community fans out widely inside it.
  for (const members of membersOf) {
    const hub = members[0]!;
    for (let e = 0; e < hubFanout; e += 1) {
      const other = pick(members);
      if (other === hub) continue;
      links.push({ source: `n${hub}`, target: `n${other}`, label: "hub" });
    }
  }

  // Sparse cross-community bridges.
  for (let e = 0; e < bridgeEdges; e += 1) {
    const a = Math.floor(rng() * nodeCount);
    const b = Math.floor(rng() * nodeCount);
    if (communityOf(a) === communityOf(b)) continue;
    links.push({ source: `n${a}`, target: `n${b}`, label: "bridges" });
  }

  return { nodes, links };
}
