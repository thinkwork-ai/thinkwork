import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signShareToken, verifyShareToken } from "./share-tokens";
import { COMPLIANCE_EVENT_TYPES } from "@thinkwork/database-pg/schema";

const SHARE_ID = "0198c9c2-9d5a-7bbb-8a51-3fd6a2b41c11";
const OTHER_ID = "0198c9c2-9d5a-7bbb-8a51-3fd6a2b41c22";

describe("share-tokens", () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.API_AUTH_SECRET;
    process.env.API_AUTH_SECRET = "test-share-secret";
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.API_AUTH_SECRET;
    else process.env.API_AUTH_SECRET = savedSecret;
  });

  it("round trips: verify(sign(id)) returns the id", () => {
    expect(verifyShareToken(signShareToken(SHARE_ID))).toBe(SHARE_ID);
  });

  it("is deterministic for the same id + secret (URL re-derivable)", () => {
    expect(signShareToken(SHARE_ID)).toBe(signShareToken(SHARE_ID));
  });

  it("rejects a tampered payload", () => {
    const token = signShareToken(SHARE_ID);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(OTHER_ID).toString("base64url")}.${sig}`;
    expect(verifyShareToken(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signShareToken(SHARE_ID);
    const [encoded, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifyShareToken(`${encoded}.${flipped}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signShareToken(SHARE_ID);
    process.env.API_AUTH_SECRET = "some-other-secret";
    expect(verifyShareToken(token)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyShareToken("")).toBeNull();
    expect(verifyShareToken("no-dot-here")).toBeNull();
    expect(verifyShareToken(".")).toBeNull();
    expect(verifyShareToken("a.b.c")).toBeNull();
    expect(verifyShareToken("!!!.???")).toBeNull();
    expect(
      verifyShareToken(`${Buffer.from("not-a-uuid").toString("base64url")}.x`),
    ).toBeNull();
    expect(verifyShareToken("x".repeat(300))).toBeNull();
  });

  it("fails closed when the secret is unresolved", () => {
    const token = signShareToken(SHARE_ID);
    delete process.env.API_AUTH_SECRET;
    expect(verifyShareToken(token)).toBeNull();
    expect(() => signShareToken(SHARE_ID)).toThrow();
  });

  it("new event types satisfy the compliance prefix regex", () => {
    const prefixRe =
      /^(auth|user|agent|mcp|workspace|data|policy|approval|attachment|skill|output|plugin)\./;
    for (const type of [
      "output.artifact_share_created",
      "output.artifact_share_revoked",
    ] as const) {
      expect(COMPLIANCE_EVENT_TYPES).toContain(type);
      expect(type).toMatch(prefixRe);
    }
  });
});
