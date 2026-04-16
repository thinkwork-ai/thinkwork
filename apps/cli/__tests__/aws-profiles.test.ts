import { describe, it, expect } from "vitest";
import { __internal } from "../src/aws-profiles.js";

const { parseIni, normalizeConfigSection, classify } = __internal;

describe("parseIni", () => {
  it("extracts sections, keys, and values from a credentials file", () => {
    const out = parseIni(
      [
        "[default]",
        "aws_access_key_id = AKIA00000000000000EX",
        "aws_secret_access_key = abc+def/123",
        "",
        "# a comment",
        "[work]",
        "aws_access_key_id = AKIA00000000000000WORK",
        "aws_secret_access_key = xyz",
      ].join("\n"),
    );

    expect(out.default.aws_access_key_id).toBe("AKIA00000000000000EX");
    expect(out.default.aws_secret_access_key).toBe("abc+def/123");
    expect(out.work.aws_access_key_id).toBe("AKIA00000000000000WORK");
  });

  it("handles ~/.aws/config sections including the `profile <name>` form", () => {
    const out = parseIni(
      [
        "[default]",
        "region = us-west-2",
        "[profile eric]",
        "region = us-east-1",
        "sso_start_url = https://example.awsapps.com/start",
        "[sso-session corp]",
        "sso_start_url = https://corp.awsapps.com/start",
      ].join("\n"),
    );

    expect(normalizeConfigSection("default")).toBe("default");
    expect(normalizeConfigSection("profile eric")).toBe("eric");
    expect(normalizeConfigSection("sso-session corp")).toBeNull();
    expect(out["profile eric"].sso_start_url).toBe(
      "https://example.awsapps.com/start",
    );
  });

  it("ignores comments (both # and ;) and blank lines", () => {
    const out = parseIni(
      [
        "; leading comment",
        "[demo]",
        "# inline-ish",
        "region = us-east-1",
        "",
        "; trailing",
      ].join("\n"),
    );

    expect(out.demo.region).toBe("us-east-1");
  });
});

describe("classify", () => {
  it("returns 'keys' for static access-key profiles", () => {
    expect(classify({ aws_access_key_id: "AKIA..." })).toBe("keys");
  });

  it("returns 'sso' for SSO profiles", () => {
    expect(classify({ sso_start_url: "https://..." })).toBe("sso");
    expect(classify({ sso_session: "corp" })).toBe("sso");
  });

  it("returns 'role' for assumed-role profiles", () => {
    expect(classify({ role_arn: "arn:aws:iam::123:role/foo" })).toBe("role");
    expect(classify({ source_profile: "base" })).toBe("role");
  });

  it("returns 'other' when we can't tell", () => {
    expect(classify({ region: "us-east-1" })).toBe("other");
    expect(classify({})).toBe("other");
  });
});
