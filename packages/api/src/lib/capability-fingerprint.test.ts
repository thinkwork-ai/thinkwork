import { describe, expect, it } from "vitest";
import {
  CAPABILITY_FINGERPRINT_VERSION,
  computeConfigFingerprint,
  type CapabilityFingerprintInputs,
  type CapabilityFingerprintSelection,
} from "./capability-fingerprint.js";

const selection: CapabilityFingerprintSelection = {
  tenantId: "t1",
  agentId: "a1",
  spaceId: null,
  agentProfileId: null,
  perspectiveUserId: null,
};

const emptyInputs: CapabilityFingerprintInputs = {
  blockedTools: [],
  skills: [],
  mcpServers: [],
  piExtensions: [],
  agentProfiles: [],
  connections: [],
  tools: [],
};

const connection = {
  slug: "firecrawl",
  type: "api",
  url: "https://api.firecrawl.dev",
  principalType: "app",
  operations: ["scrape", "crawl"],
  enabled: true,
  permittedOperations: ["scrape"],
  signedContentSha: "a".repeat(64),
};

const tool = {
  slug: "firecrawl-scrape",
  kind: "binding",
  target: "binding:firecrawl/scrape",
  enabled: true,
  signedContentSha: "b".repeat(64),
};

describe("capability fingerprint v3 (THINK-173 U4)", () => {
  it("version constant is bumped to 3 (KTD-4)", () => {
    expect(CAPABILITY_FINGERPRINT_VERSION).toBe(3);
  });

  it("changes when a connection is added, edited, or removed", () => {
    const base = computeConfigFingerprint(selection, emptyInputs);
    const withConn = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [connection],
    });
    expect(withConn).not.toBe(base);

    const edited = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [{ ...connection, signedContentSha: "c".repeat(64) }],
    });
    expect(edited).not.toBe(withConn);

    const disabled = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [{ ...connection, enabled: false }],
    });
    expect(disabled).not.toBe(withConn);
  });

  it("changes when a tool is added or its target changes", () => {
    const withTool = computeConfigFingerprint(selection, {
      ...emptyInputs,
      tools: [tool],
    });
    expect(withTool).not.toBe(computeConfigFingerprint(selection, emptyInputs));
    const retargeted = computeConfigFingerprint(selection, {
      ...emptyInputs,
      tools: [{ ...tool, target: "binding:firecrawl/crawl" }],
    });
    expect(retargeted).not.toBe(withTool);
  });

  it("is order-independent across entries and operation lists", () => {
    const other = { ...connection, slug: "exa", url: "https://api.exa.ai" };
    const ab = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [connection, other],
    });
    const ba = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [
        { ...other, operations: [...other.operations].reverse() },
        { ...connection, operations: [...connection.operations].reverse() },
      ],
    });
    expect(ab).toBe(ba);
  });

  it("refs-only invariant: fingerprint inputs carry no token-value field", () => {
    // A rotated token must not change config identity — the connection
    // input surface has no place to put a credential value at all.
    const keys = Object.keys(connection);
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("authConfig");
    // Same bytes in → same fingerprint out, regardless of any external
    // credential rotation.
    const a = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [connection],
    });
    const b = computeConfigFingerprint(selection, {
      ...emptyInputs,
      connections: [{ ...connection }],
    });
    expect(a).toBe(b);
  });
});
