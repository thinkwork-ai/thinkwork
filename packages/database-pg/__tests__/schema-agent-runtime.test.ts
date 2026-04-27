import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { agents } from "../src/schema/agents";
import { agentTemplates } from "../src/schema/agent-templates";

describe("agent runtime selector schema", () => {
  it("defaults agents to the Strands runtime", () => {
    const columns = getTableColumns(agents);
    expect(columns.runtime.notNull).toBe(true);
    expect(columns.runtime.hasDefault).toBe(true);
  });

  it("defaults agent templates to the Strands runtime", () => {
    const columns = getTableColumns(agentTemplates);
    expect(columns.runtime.notNull).toBe(true);
    expect(columns.runtime.hasDefault).toBe(true);
  });
});
