import { describe, it, expect } from "vitest";
import {
  validateAgentSkillPermissions,
  intersectPermissions,
} from "./permissions-subset.js";

const MANIFEST = ["me", "get_tenant", "list_agents", "create_agent", "invite_member"];

describe("validateAgentSkillPermissions", () => {
  describe("inheritance", () => {
    it("accepts null agent permissions (inheriting)", () => {
      expect(
        validateAgentSkillPermissions(
          null,
          { operations: ["me", "list_agents"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });

    it("accepts undefined agent permissions (inheriting)", () => {
      expect(
        validateAgentSkillPermissions(
          undefined,
          { operations: ["me"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });

    it("accepts agent object missing the `operations` key (inheriting)", () => {
      expect(
        validateAgentSkillPermissions(
          { someOtherField: "x" },
          { operations: ["me"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });
  });

  describe("explicit agent permissions", () => {
    it("accepts empty array (narrowed to empty)", () => {
      expect(
        validateAgentSkillPermissions(
          { operations: [] },
          { operations: ["me"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });

    it("accepts strict subset", () => {
      expect(
        validateAgentSkillPermissions(
          { operations: ["me", "list_agents"] },
          { operations: ["me", "get_tenant", "list_agents"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });

    it("accepts equality with template ceiling", () => {
      expect(
        validateAgentSkillPermissions(
          { operations: ["me", "list_agents"] },
          { operations: ["me", "list_agents"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });
  });

  describe("rejections", () => {
    it("rejects op not authorized by template", () => {
      const result = validateAgentSkillPermissions(
        { operations: ["me", "invite_member"] },
        { operations: ["me", "list_agents"] },
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(
          /op 'invite_member' is not authorized by template/,
        );
    });

    it("rejects op not in manifest (typo / fabricated)", () => {
      const result = validateAgentSkillPermissions(
        { operations: ["invite_memeber"] }, // typo
        { operations: ["invite_memeber", "me"] }, // even if template also has typo
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(
          /op 'invite_memeber' is not declared in the skill manifest/,
        );
    });

    it("rejects explicit agent permissions when template has none authored", () => {
      const result = validateAgentSkillPermissions(
        { operations: ["me"] },
        null,
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(/template has no permissions authored/);
    });

    it("rejects invalid agent shape (operations not an array)", () => {
      const result = validateAgentSkillPermissions(
        { operations: "me" },
        { operations: ["me"] },
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(/must be an array of op names/);
    });

    it("rejects invalid agent shape (non-string element)", () => {
      const result = validateAgentSkillPermissions(
        { operations: ["me", 42] },
        { operations: ["me"] },
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be strings/);
    });

    it("rejects invalid top-level shape (array at root)", () => {
      const result = validateAgentSkillPermissions(
        ["me"],
        { operations: ["me"] },
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatch(/must be an object with `operations`/);
    });

    it("rejects malformed JSON string", () => {
      const result = validateAgentSkillPermissions(
        "{not json",
        { operations: ["me"] },
        MANIFEST,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/invalid JSON payload/);
    });
  });

  describe("AWSJSON string payloads", () => {
    it("accepts agent permissions as JSON string", () => {
      expect(
        validateAgentSkillPermissions(
          '{"operations":["me"]}',
          { operations: ["me", "list_agents"] },
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });

    it("accepts template permissions as JSON string", () => {
      expect(
        validateAgentSkillPermissions(
          { operations: ["me"] },
          '{"operations":["me","list_agents"]}',
          MANIFEST,
        ),
      ).toEqual({ ok: true });
    });
  });
});

describe("intersectPermissions", () => {
  it("returns the set intersection preserving agent order", () => {
    expect(intersectPermissions(["a", "b", "c"], ["b", "c", "d"])).toEqual([
      "b",
      "c",
    ]);
  });

  it("returns empty array when no overlap", () => {
    expect(intersectPermissions(["a", "b"], ["c", "d"])).toEqual([]);
  });

  it("returns empty when either side is empty", () => {
    expect(intersectPermissions([], ["a", "b"])).toEqual([]);
    expect(intersectPermissions(["a", "b"], [])).toEqual([]);
  });

  it("deduplicates while preserving first-seen order", () => {
    expect(
      intersectPermissions(["a", "b", "a", "c", "b"], ["a", "b", "c"]),
    ).toEqual(["a", "b", "c"]);
  });

  it("preserves order even when template reorders", () => {
    expect(intersectPermissions(["b", "a", "c"], ["c", "a", "b"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});
