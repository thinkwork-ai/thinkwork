/**
 * Governance-file reseed tests (Composer plan 2026-07-02-001 U6).
 *
 * Contract:
 *   - a live file byte-identical to a PREVIOUSLY shipped default (after
 *     per-agent placeholder substitution) is rewritten to the current
 *     default;
 *   - a customized file is left alone;
 *   - a file already at the current default is skipped (idempotency);
 *   - a missing file is skipped (bootstrap owns first materialization).
 */

import { describe, expect, it } from "vitest";
import {
  HISTORICAL_GOVERNANCE_DEFAULTS,
  loadFile,
} from "@thinkwork/workspace-defaults";
import { substitute } from "./placeholder-substitution.js";
import {
  decideGovernanceReseed,
  reseedTenantGovernanceDefaults,
  type ReseedObjectStore,
} from "./workspace-defaults-reseed.js";

const VALUES = { AGENT_NAME: "Marco", TENANT_NAME: "Acme" };

const OLD_AGENTS_MD = HISTORICAL_GOVERNANCE_DEFAULTS["AGENTS.md"].at(-1)!;
const OLD_CONTEXT_MD = HISTORICAL_GOVERNANCE_DEFAULTS["CONTEXT.md"].at(-1)!;

describe("decideGovernanceReseed", () => {
  it("rewrites a file byte-identical to a substituted historical default", () => {
    const live = substitute(VALUES, OLD_AGENTS_MD);
    const decision = decideGovernanceReseed({
      file: "AGENTS.md",
      liveContent: live,
      placeholderValues: VALUES,
    });
    expect(decision.action).toBe("rewrite");
    if (decision.action === "rewrite") {
      expect(decision.nextContent).toBe(
        substitute(VALUES, loadFile("AGENTS.md")),
      );
      // The substituted current default carries the agent's real name,
      // not the raw placeholder.
      expect(decision.nextContent).toContain("Marco");
      expect(decision.nextContent).not.toContain("{{AGENT_NAME}}");
    }
  });

  it("rewrites a raw (unsubstituted-placeholder) historical default too", () => {
    // Files copied before write-time substitution existed, or whose agent
    // name produced no visible change, still hash-match through the same
    // substitution pipeline when the placeholder values reproduce them.
    const live = substitute(
      { AGENT_NAME: "Old Name", TENANT_NAME: "Acme" },
      OLD_AGENTS_MD,
    );
    const decision = decideGovernanceReseed({
      file: "AGENTS.md",
      liveContent: live,
      placeholderValues: { AGENT_NAME: "Old Name", TENANT_NAME: "Acme" },
    });
    expect(decision.action).toBe("rewrite");
  });

  it("skips a customized file", () => {
    const live = `${substitute(VALUES, OLD_AGENTS_MD)}\n## Operator Notes\n\nHand-written.\n`;
    expect(
      decideGovernanceReseed({
        file: "AGENTS.md",
        liveContent: live,
        placeholderValues: VALUES,
      }).action,
    ).toBe("skip-customized");
  });

  it("skips a historical default substituted with a DIFFERENT agent name", () => {
    // The live file was baked with another name; against this agent's
    // values it is not byte-identical to any shipped default → treated as
    // customized, never clobbered.
    const live = substitute(
      { AGENT_NAME: "Someone Else", TENANT_NAME: "Acme" },
      OLD_AGENTS_MD,
    );
    expect(
      decideGovernanceReseed({
        file: "AGENTS.md",
        liveContent: live,
        placeholderValues: VALUES,
      }).action,
    ).toBe("skip-customized");
  });

  it("skips a file already at the current default", () => {
    expect(
      decideGovernanceReseed({
        file: "CONTEXT.md",
        liveContent: substitute(VALUES, loadFile("CONTEXT.md")),
        placeholderValues: VALUES,
      }).action,
    ).toBe("skip-current");
  });

  it("skips a missing file", () => {
    expect(
      decideGovernanceReseed({
        file: "CONTEXT.md",
        liveContent: null,
        placeholderValues: VALUES,
      }).action,
    ).toBe("skip-missing");
  });
});

class MemoryStore implements ReseedObjectStore {
  readonly puts: { key: string; content: string }[] = [];

  constructor(private readonly objects: Map<string, string>) {}

  async getText(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }

  async putText(key: string, content: string): Promise<void> {
    this.puts.push({ key, content });
    this.objects.set(key, content);
  }
}

function tenantStore(): MemoryStore {
  return new MemoryStore(
    new Map([
      // never-customized agent — both files are old defaults
      [
        "tenants/acme/agents/pristine/AGENTS.md",
        substitute(
          { AGENT_NAME: "Pristine", TENANT_NAME: "Acme" },
          OLD_AGENTS_MD,
        ),
      ],
      [
        "tenants/acme/agents/pristine/CONTEXT.md",
        substitute(
          { AGENT_NAME: "Pristine", TENANT_NAME: "Acme" },
          OLD_CONTEXT_MD,
        ),
      ],
      // customized agent — operator-edited AGENTS.md, old CONTEXT.md
      [
        "tenants/acme/agents/custom/AGENTS.md",
        "# AGENTS.md\n\nHand-tuned operator map.\n",
      ],
      [
        "tenants/acme/agents/custom/CONTEXT.md",
        substitute(
          { AGENT_NAME: "Custom", TENANT_NAME: "Acme" },
          OLD_CONTEXT_MD,
        ),
      ],
    ]),
  );
}

const AGENTS = [
  { agentId: "a-1", agentSlug: "pristine", agentName: "Pristine" },
  { agentId: "a-2", agentSlug: "custom", agentName: "Custom" },
];

describe("reseedTenantGovernanceDefaults", () => {
  it("rewrites byte-identical-to-old-default files and skips customized ones", async () => {
    const store = tenantStore();
    const rewrites: Array<{ agentId: string; files: readonly string[] }> = [];

    const summary = await reseedTenantGovernanceDefaults({
      tenantSlug: "acme",
      tenantName: "Acme",
      agents: AGENTS,
      store,
      afterAgentRewrite: async (agent, rewritten) => {
        rewrites.push({ agentId: agent.agentId, files: rewritten });
      },
    });

    expect(summary.agentsChecked).toBe(2);
    expect(summary.agentsRewritten).toBe(2);
    expect(summary.filesRewritten).toBe(3);

    // pristine: both governance files rewritten to the substituted current default
    expect(await store.getText("tenants/acme/agents/pristine/AGENTS.md")).toBe(
      substitute(
        { AGENT_NAME: "Pristine", TENANT_NAME: "Acme" },
        loadFile("AGENTS.md"),
      ),
    );
    expect(await store.getText("tenants/acme/agents/pristine/CONTEXT.md")).toBe(
      substitute(
        { AGENT_NAME: "Pristine", TENANT_NAME: "Acme" },
        loadFile("CONTEXT.md"),
      ),
    );

    // custom: hand-edited AGENTS.md untouched; old-default CONTEXT.md rewritten
    expect(await store.getText("tenants/acme/agents/custom/AGENTS.md")).toBe(
      "# AGENTS.md\n\nHand-tuned operator map.\n",
    );
    expect(await store.getText("tenants/acme/agents/custom/CONTEXT.md")).toBe(
      substitute(
        { AGENT_NAME: "Custom", TENANT_NAME: "Acme" },
        loadFile("CONTEXT.md"),
      ),
    );

    expect(rewrites).toEqual([
      { agentId: "a-1", files: ["AGENTS.md", "CONTEXT.md"] },
      { agentId: "a-2", files: ["CONTEXT.md"] },
    ]);

    const pristineCustomizedResult = summary.results.find(
      (r) => r.agentSlug === "custom",
    );
    expect(pristineCustomizedResult?.skippedCustomized).toEqual(["AGENTS.md"]);
  });

  it("is idempotent — a second run rewrites nothing", async () => {
    const store = tenantStore();
    await reseedTenantGovernanceDefaults({
      tenantSlug: "acme",
      tenantName: "Acme",
      agents: AGENTS,
      store,
    });
    const firstRunPuts = store.puts.length;
    expect(firstRunPuts).toBe(3);

    const second = await reseedTenantGovernanceDefaults({
      tenantSlug: "acme",
      tenantName: "Acme",
      agents: AGENTS,
      store,
    });
    expect(second.filesRewritten).toBe(0);
    expect(second.agentsRewritten).toBe(0);
    expect(store.puts.length).toBe(firstRunPuts);
  });

  it("skips agents with no governance files at their prefix", async () => {
    const store = new MemoryStore(new Map());
    const summary = await reseedTenantGovernanceDefaults({
      tenantSlug: "acme",
      tenantName: "Acme",
      agents: [{ agentId: "a-3", agentSlug: "empty", agentName: "Empty" }],
      store,
    });
    expect(summary.filesRewritten).toBe(0);
    expect(store.puts).toEqual([]);
    expect(summary.results[0]?.skippedMissing).toEqual([
      "AGENTS.md",
      "CONTEXT.md",
    ]);
  });

  it("customized-tenant render input is unchanged — no put touches a customized file", async () => {
    const customized = "# AGENTS.md\n\nBespoke routing everywhere.\n";
    const store = new MemoryStore(
      new Map([
        ["tenants/acme/agents/solo/AGENTS.md", customized],
        ["tenants/acme/agents/solo/CONTEXT.md", "# My own router\n"],
      ]),
    );
    const summary = await reseedTenantGovernanceDefaults({
      tenantSlug: "acme",
      tenantName: "Acme",
      agents: [{ agentId: "a-4", agentSlug: "solo", agentName: "Solo" }],
      store,
    });
    expect(summary.filesRewritten).toBe(0);
    expect(store.puts).toEqual([]);
    expect(await store.getText("tenants/acme/agents/solo/AGENTS.md")).toBe(
      customized,
    );
  });
});
