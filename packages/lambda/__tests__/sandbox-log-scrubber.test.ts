import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { scrubMessage, decodeAwsLogsPayload } from "../sandbox-log-scrubber.js";

describe("scrubMessage — Authorization Bearer", () => {
  it("redacts a Bearer header with a bare token", () => {
    const input = "Authorization: Bearer abc.def.ghi_jkl";
    expect(scrubMessage(input)).toBe("Authorization: Bearer <redacted>");
  });

  it("redacts a Bearer header inside surrounding text", () => {
    const input =
      "request failed [Authorization: Bearer eyJabc123xyz456] next line";
    expect(scrubMessage(input)).toContain("Authorization: Bearer <redacted>");
    expect(scrubMessage(input)).not.toContain("eyJabc123xyz456");
  });

  it("does not match a bare word 'Bearer' alone", () => {
    const input = "the word Bearer appeared but it's not an auth header";
    expect(scrubMessage(input)).toBe(input);
  });

  it("case-insensitive on the keyword", () => {
    const input = "authorization: bearer token12345abc";
    expect(scrubMessage(input)).toContain("<redacted>");
    expect(scrubMessage(input)).not.toContain("token12345abc");
  });
});

describe("scrubMessage — JWT shapes", () => {
  it("redacts a three-dotted JWT-shaped string", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `header X-Auth=${jwt} next`;
    expect(scrubMessage(input)).toContain("<redacted>");
    expect(scrubMessage(input)).not.toContain(jwt);
  });

  it("does not match a short three-dotted value (min 16 chars per segment)", () => {
    const input = "version a.b.c is released";
    expect(scrubMessage(input)).toBe(input);
  });
});

describe("scrubMessage — known OAuth prefixes", () => {
  it("redacts GitHub PATs (ghp_)", () => {
    const input = "token: ghp_abc123DEF456ghi789JKLmno0";
    expect(scrubMessage(input)).toContain("<redacted>");
    expect(scrubMessage(input)).not.toContain("ghp_abc123DEF456ghi789JKLmno0");
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const input = "gho_abcdefGHIJKLmnopqrst0123456789";
    expect(scrubMessage(input)).toBe("<redacted>");
  });

  it("redacts GitHub server-to-server tokens (ghs_)", () => {
    const input = "ghs_serverToServerTokenValue123ABC";
    expect(scrubMessage(input)).toContain("<redacted>");
  });

  it("redacts Slack bot tokens (xoxb-)", () => {
    const input = "slack response: xoxb-1234567890-0987654321-abcdef";
    expect(scrubMessage(input)).toContain("<redacted>");
    expect(scrubMessage(input)).not.toContain(
      "xoxb-1234567890-0987654321-abcdef",
    );
  });

  it("redacts Slack user tokens (xoxp-)", () => {
    const input = "xoxp-abcdefghijklmnop-12345";
    expect(scrubMessage(input)).toBe("<redacted>");
  });

  it("redacts Google short-lived tokens (ya29.)", () => {
    const input = "Bearer ya29.A0ARrdaM_abcdefghijklmnop_longer";
    expect(scrubMessage(input)).toContain("<redacted>");
    expect(scrubMessage(input)).not.toContain(
      "ya29.A0ARrdaM_abcdefghijklmnop_longer",
    );
  });

  it("does not redact the bare prefix alone (e.g., 'xoxb-')", () => {
    const input = "the prefix xoxb- appears but nothing follows";
    expect(scrubMessage(input)).toBe(input);
  });
});

describe("scrubMessage — non-sensitive traffic passes through", () => {
  it("preserves unrelated log lines verbatim", () => {
    const input = "[INFO] processed 42 records in 17ms for tenant abc";
    expect(scrubMessage(input)).toBe(input);
  });

  it("preserves JSON logs without tokens", () => {
    const input = JSON.stringify({
      level: "info",
      request_id: "r-123",
      bytes: 512,
    });
    expect(scrubMessage(input)).toBe(input);
  });
});

describe("decodeAwsLogsPayload", () => {
  it("decodes a valid base64+gzip subscription payload", () => {
    const payload = {
      messageType: "DATA_MESSAGE",
      owner: "123456789012",
      logGroup: "/aws/bedrock-agentcore/runtimes/test",
      logStream: "stream-a",
      subscriptionFilters: ["sandbox-scrubber"],
      logEvents: [{ id: "1", timestamp: 1, message: "hi" }],
    };
    const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const b64 = gz.toString("base64");
    const decoded = decodeAwsLogsPayload({ data: b64 });
    expect(decoded.messageType).toBe("DATA_MESSAGE");
    expect(decoded.logEvents[0].message).toBe("hi");
  });

  it("throws on non-gzip input", () => {
    const b64 = Buffer.from("not gzipped").toString("base64");
    expect(() => decodeAwsLogsPayload({ data: b64 })).toThrow();
  });
});
