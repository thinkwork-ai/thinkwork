import { describe, expect, it } from "vitest";
import {
  AmbiguousPrimaryAgentError,
  ComputerNotFoundError,
  NoPrimaryAgentError,
  resolveComputerPrimaryAgentId,
  type ComputerRow,
  type PrimaryAgentResolverDeps,
} from "../primary-agent-resolver.js";

function depsWith(opts: {
  computer: ComputerRow | null;
  candidates?: string[];
}): PrimaryAgentResolverDeps {
  return {
    loadComputer: async () => opts.computer,
    findCandidateAgentIds: async () => opts.candidates ?? [],
  };
}

const baseComputer: ComputerRow = {
  id: "computer-1",
  tenant_id: "tenant-1",
  owner_user_id: "user-1",
  template_id: "template-1",
  primary_agent_id: null,
  migrated_from_agent_id: null,
};

describe("resolveComputerPrimaryAgentId", () => {
  it("returns primary_agent_id when set", async () => {
    const deps = depsWith({
      computer: { ...baseComputer, primary_agent_id: "agent-primary" },
    });
    await expect(
      resolveComputerPrimaryAgentId("computer-1", deps),
    ).resolves.toBe("agent-primary");
  });

  it("falls back to migrated_from_agent_id when primary is null", async () => {
    const deps = depsWith({
      computer: { ...baseComputer, migrated_from_agent_id: "agent-migrated" },
    });
    await expect(
      resolveComputerPrimaryAgentId("computer-1", deps),
    ).resolves.toBe("agent-migrated");
  });

  it("falls back to unique candidate by (tenant, owner, template)", async () => {
    const deps = depsWith({
      computer: baseComputer,
      candidates: ["agent-derived"],
    });
    await expect(
      resolveComputerPrimaryAgentId("computer-1", deps),
    ).resolves.toBe("agent-derived");
  });

  it("throws AmbiguousPrimaryAgentError when multiple candidates match", async () => {
    const deps = depsWith({
      computer: baseComputer,
      candidates: ["agent-a", "agent-b"],
    });
    await expect(
      resolveComputerPrimaryAgentId("computer-1", deps),
    ).rejects.toBeInstanceOf(AmbiguousPrimaryAgentError);
  });

  it("throws NoPrimaryAgentError when no candidate matches", async () => {
    const deps = depsWith({ computer: baseComputer, candidates: [] });
    await expect(
      resolveComputerPrimaryAgentId("computer-1", deps),
    ).rejects.toBeInstanceOf(NoPrimaryAgentError);
  });

  it("throws ComputerNotFoundError when computer does not exist", async () => {
    const deps = depsWith({ computer: null });
    await expect(
      resolveComputerPrimaryAgentId("missing", deps),
    ).rejects.toBeInstanceOf(ComputerNotFoundError);
  });

  it("prefers primary_agent_id over migrated_from_agent_id", async () => {
    const deps = depsWith({
      computer: {
        ...baseComputer,
        primary_agent_id: "agent-primary",
        migrated_from_agent_id: "agent-migrated",
      },
    });
    await expect(
      resolveComputerPrimaryAgentId("computer-1", deps),
    ).resolves.toBe("agent-primary");
  });
});
