import { describe, expect, it } from "vitest";
import {
  ComputerNotFoundError,
  NoPrimaryAgentError,
  resolveComputerPrimaryAgentId,
  type ComputerRow,
  type PrimaryAgentResolverDeps,
} from "../primary-agent-resolver.js";

function depsWith(opts: {
  computer: ComputerRow | null;
}): PrimaryAgentResolverDeps {
  return {
    loadComputer: async () => opts.computer,
  };
}

const baseComputer: ComputerRow = {
  id: "computer-1",
  tenant_id: "tenant-1",
  owner_user_id: "user-1",
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

  it("throws NoPrimaryAgentError when no explicit primary is set", async () => {
    const deps = depsWith({ computer: baseComputer });
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
