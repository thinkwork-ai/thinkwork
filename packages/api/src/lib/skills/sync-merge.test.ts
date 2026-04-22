import { describe, it, expect } from "vitest";
import {
  mergeTemplateSkillsIntoAgent,
  readExplicitOperations,
  type TemplateSkillRow,
  type CurrentAgentSkillRow,
} from "./sync-merge.js";

const ADMIN = "thinkwork-admin";
const NON_ADMIN = "some-mcp-skill";
const OPT_IN = new Set([ADMIN]);

function tpl(
  overrides: Partial<TemplateSkillRow> & { skill_id: string },
): TemplateSkillRow {
  return overrides;
}

function cur(permissions?: unknown): CurrentAgentSkillRow {
  return { permissions };
}

describe("mergeTemplateSkillsIntoAgent — permissions_model: operations skills", () => {
  it("preserves agent narrowing when template stays the same", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({
          skill_id: ADMIN,
          permissions: { operations: ["me", "list_agents", "invite_member"] },
        }),
      ],
      currentBySkillId: new Map([
        [ADMIN, cur({ operations: ["me", "list_agents"] })],
      ]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ operations: ["me", "list_agents"] });
  });

  it("preserves agent narrowing that is still within the new (shrunk) ceiling", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({
          skill_id: ADMIN,
          permissions: { operations: ["me", "list_agents"] },
        }),
      ],
      currentBySkillId: new Map([[ADMIN, cur({ operations: ["me"] })]]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ operations: ["me"] });
  });

  it("rebases agent above the new ceiling (intersection drops the removed op)", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({ skill_id: ADMIN, permissions: { operations: ["me"] } }),
      ],
      currentBySkillId: new Map([
        // Legacy data: agent was at [me, remove_tenant_member] but
        // the template now only allows [me]. Intersection drops the
        // removed op — precisely the R7 rebase behavior.
        [ADMIN, cur({ operations: ["me", "remove_tenant_member"] })],
      ]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ operations: ["me"] });
  });

  it("keeps inheritance (null) across template changes", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({
          skill_id: ADMIN,
          permissions: { operations: ["me", "list_agents"] },
        }),
      ],
      currentBySkillId: new Map([[ADMIN, cur(null)]]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toBeNull();
  });

  it("preserves explicit narrowed-to-empty override", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({ skill_id: ADMIN, permissions: { operations: ["me"] } }),
      ],
      currentBySkillId: new Map([[ADMIN, cur({ operations: [] })]]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ operations: [] });
  });

  it("inherits for a brand-new opt-in skill the agent didn't have", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({ skill_id: ADMIN, permissions: { operations: ["me"] } }),
      ],
      currentBySkillId: new Map(), // agent never had this skill
      permissionsModelOptIns: OPT_IN,
    });
    // null → inheriting; UI will render the full template list.
    expect(out[0].permissions).toBeNull();
  });

  it("returns narrowed-to-empty when template has no authored permissions but agent had an override", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [tpl({ skill_id: ADMIN, permissions: null })],
      currentBySkillId: new Map([[ADMIN, cur({ operations: ["me"] })]]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ operations: [] });
  });

  it("tolerates AWSJSON stringified permissions on both sides", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({
          skill_id: ADMIN,
          permissions: '{"operations":["me","list_agents"]}',
        }),
      ],
      currentBySkillId: new Map([
        [ADMIN, cur('{"operations":["me"]}')],
      ]),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ operations: ["me"] });
  });
});

describe("mergeTemplateSkillsIntoAgent — non-opt-in skills", () => {
  it("preserves agent's free-form permissions jsonb when the skill isn't opt-in", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({
          skill_id: NON_ADMIN,
          permissions: { templateField: "tpl" },
        }),
      ],
      currentBySkillId: new Map([
        [NON_ADMIN, cur({ agentField: "agent" })],
      ]),
      permissionsModelOptIns: OPT_IN, // does NOT include NON_ADMIN
    });
    expect(out[0].permissions).toEqual({ agentField: "agent" });
  });

  it("seeds from template when the skill is new on the agent and non-opt-in", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({ skill_id: NON_ADMIN, permissions: { templateField: "tpl" } }),
      ],
      currentBySkillId: new Map(),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].permissions).toEqual({ templateField: "tpl" });
  });
});

describe("mergeTemplateSkillsIntoAgent — carry-forward of other fields", () => {
  it("applies template's config/model_override/enabled/rate_limit_rpm verbatim", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        tpl({
          skill_id: NON_ADMIN,
          config: { tplConfig: true },
          rate_limit_rpm: 42,
          model_override: "claude-3",
          enabled: false,
        }),
      ],
      currentBySkillId: new Map(),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0]).toMatchObject({
      skill_id: NON_ADMIN,
      config: { tplConfig: true },
      rate_limit_rpm: 42,
      model_override: "claude-3",
      enabled: false,
    });
  });

  it("defaults enabled to true when the template omits it", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [tpl({ skill_id: NON_ADMIN })],
      currentBySkillId: new Map(),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out[0].enabled).toBe(true);
  });

  it("skips template entries without a skill_id", () => {
    const out = mergeTemplateSkillsIntoAgent({
      templateSkills: [
        // @ts-expect-error - deliberately malformed to test defensive filtering
        { config: {} },
        tpl({ skill_id: NON_ADMIN }),
      ],
      currentBySkillId: new Map(),
      permissionsModelOptIns: OPT_IN,
    });
    expect(out).toHaveLength(1);
    expect(out[0].skill_id).toBe(NON_ADMIN);
  });
});

describe("readExplicitOperations", () => {
  it("returns null for null/undefined/missing-operations-key", () => {
    expect(readExplicitOperations(null)).toBeNull();
    expect(readExplicitOperations(undefined)).toBeNull();
    expect(readExplicitOperations({})).toBeNull();
    expect(readExplicitOperations({ other: "x" })).toBeNull();
  });

  it("returns the array for an explicit { operations: [...] }", () => {
    expect(readExplicitOperations({ operations: ["a", "b"] })).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns [] for an explicit narrowed-to-empty override", () => {
    expect(readExplicitOperations({ operations: [] })).toEqual([]);
  });

  it("parses AWSJSON strings", () => {
    expect(readExplicitOperations('{"operations":["a"]}')).toEqual(["a"]);
  });

  it("filters non-string entries", () => {
    expect(readExplicitOperations({ operations: ["a", 42, "b"] })).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns null for malformed strings or non-object payloads", () => {
    expect(readExplicitOperations("{not json")).toBeNull();
    expect(readExplicitOperations("null")).toBeNull();
    expect(readExplicitOperations(["a", "b"])).toBeNull();
    expect(readExplicitOperations({ operations: "oops" })).toBeNull();
  });
});
