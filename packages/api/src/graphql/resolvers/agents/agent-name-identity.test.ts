import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeAgentMentionName } from "./name-identity.js";

const createSource = readFileSync(
  new URL("./createAgent.mutation.ts", import.meta.url),
  "utf8",
);
const updateSource = readFileSync(
  new URL("./updateAgent.mutation.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../../../database-pg/src/schema/agents.ts", import.meta.url),
  "utf8",
);

describe("agent name mention identity", () => {
  it("normalizes names used as mention handles", () => {
    expect(normalizeAgentMentionName("  Marco  ")).toBe("Marco");
    expect(() => normalizeAgentMentionName("   ")).toThrow(
      "Agent name must be a non-empty string",
    );
  });

  it("enforces tenant-scoped active name uniqueness in schema and mutations", () => {
    expect(schemaSource).toContain("uq_agents_tenant_name_active");
    expect(schemaSource).toContain("lower(trim");
    expect(schemaSource).toContain("status} <> 'archived'");
    expect(createSource).toContain("assertAgentMentionNameAvailable");
    expect(updateSource).toContain("assertAgentMentionNameAvailable");
    expect(updateSource).toContain("excludingAgentId: args.id");
  });
});
