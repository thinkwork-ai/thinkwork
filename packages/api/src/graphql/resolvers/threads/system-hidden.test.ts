import { describe, expect, it, vi } from "vitest";

const { mockSql, threadsTable } = vi.hoisted(() => {
  const col = (label: string) => ({ __col: label });
  return {
    threadsTable: {
      id: col("threads.id"),
      tenant_id: col("threads.tenant_id"),
      space_id: col("threads.space_id"),
      metadata: col("threads.metadata"),
    },
    mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.join("?"),
      values,
    })),
  };
});

vi.mock("../../utils.js", () => ({
  sql: mockSql,
  threads: threadsTable,
}));

import { visibleThreadListPredicate } from "./system-hidden.js";

describe("visibleThreadListPredicate", () => {
  it("excludes system-hidden automation builder threads and spaces", () => {
    const predicate = visibleThreadListPredicate() as unknown as {
      text: string;
      values: unknown[];
    };

    expect(predicate.text).toContain("systemHidden");
    expect(predicate.text).toContain("system_hidden");
    expect(predicate.text).toContain("automation_builder");
    expect(predicate.text).toContain("hidden_space");
    expect(predicate.values).toContain(threadsTable.metadata);
    expect(predicate.values).toContain(threadsTable.tenant_id);
    expect(predicate.values).toContain(threadsTable.space_id);
    expect(predicate.values).toContain("system:automation_builder");
  });
});
