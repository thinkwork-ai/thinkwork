import { describe, expect, it } from "vitest";
import {
  guardImmutableAnswers,
  mergePreservedSecrets,
  parseTfvarsAssignments,
} from "../src/commands/init.js";

const EXISTING = [
  "# Thinkwork — prod stage",
  'stage      = "prod"',
  'region     = "us-west-2"',
  'account_id = "123456789012"',
  'db_password     = "byte-for-byte-preserved-1"',
  'api_auth_secret = "tw-prod-byte-for-byte-2"',
].join("\n");

describe("parseTfvarsAssignments", () => {
  it("extracts string assignments and ignores comments", () => {
    const values = parseTfvarsAssignments(EXISTING);
    expect(values.stage).toBe("prod");
    expect(values.region).toBe("us-west-2");
    expect(values.db_password).toBe("byte-for-byte-preserved-1");
  });

  it("throws on unparseable content instead of allowing overwrite", () => {
    expect(() => parseTfvarsAssignments("garbage {{{ not tfvars")).toThrow(
      /unreadable/,
    );
  });

  it("accepts an empty or comment-only file", () => {
    expect(parseTfvarsAssignments("")).toEqual({});
    expect(parseTfvarsAssignments("# just a comment\n")).toEqual({});
  });
});

describe("guardImmutableAnswers", () => {
  const existing = parseTfvarsAssignments(EXISTING);

  it("allows a rerun with matching stage and account", () => {
    expect(
      guardImmutableAnswers(existing, {
        stage: "prod",
        account: "123456789012",
      }).ok,
    ).toBe(true);
  });

  it("rejects a stage change, naming destroy as the path", () => {
    const guard = guardImmutableAnswers(existing, {
      stage: "staging",
      account: "123456789012",
    });
    expect(guard.ok).toBe(false);
    expect(guard.error).toContain('initialized for stage "prod"');
    expect(guard.error).toContain("thinkwork destroy -s prod");
  });

  it("rejects an account mismatch", () => {
    const guard = guardImmutableAnswers(existing, {
      stage: "prod",
      account: "999999999999",
    });
    expect(guard.ok).toBe(false);
    expect(guard.error).toContain("account 123456789012");
  });
});

describe("mergePreservedSecrets", () => {
  it("preserves both secrets byte-for-byte over freshly generated ones", () => {
    const existing = parseTfvarsAssignments(EXISTING);
    const config: Record<string, string> = {
      stage: "prod",
      db_password: "freshly-generated-A",
      api_auth_secret: "tw-prod-freshly-generated-B",
    };
    mergePreservedSecrets(config, existing);
    expect(config.db_password).toBe("byte-for-byte-preserved-1");
    expect(config.api_auth_secret).toBe("tw-prod-byte-for-byte-2");
  });

  it("keeps generated secrets when the existing file has none", () => {
    const config: Record<string, string> = {
      db_password: "generated",
      api_auth_secret: "tw-x-generated",
    };
    mergePreservedSecrets(config, {});
    expect(config.db_password).toBe("generated");
    expect(config.api_auth_secret).toBe("tw-x-generated");
  });
});
