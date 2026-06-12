import { describe, expect, it } from "vitest";
import {
  CLAIM_COMMENT_PATTERN,
  commentMatchesOwner,
  formatClaimComment,
  parseClaimComment,
} from "./comment-format.js";

describe("claim comment format (R4 contract)", () => {
  it("formats the deployment kind exactly as the contract specifies", () => {
    expect(
      formatClaimComment({
        kind: "deployment",
        owner: "tei",
        created: "2026-06-12",
      }),
    ).toBe("deployment:tei created:2026-06-12");
  });

  it("formats the tenant kind exactly as the contract specifies", () => {
    expect(
      formatClaimComment({
        kind: "tenant",
        owner: "acme",
        created: "2026-06-12",
      }),
    ).toBe("tenant:acme created:2026-06-12");
  });

  it("round-trips format → parse", () => {
    const comment = {
      kind: "deployment" as const,
      owner: "tei",
      created: "2026-06-12",
    };
    expect(parseClaimComment(formatClaimComment(comment))).toEqual(comment);
  });

  it("the exported pattern matches formatted comments", () => {
    expect(
      CLAIM_COMMENT_PATTERN.test(
        formatClaimComment({
          kind: "tenant",
          owner: "acme-co",
          created: "2026-01-01",
        }),
      ),
    ).toBe(true);
  });

  it("rejects malformed, foreign, and empty comments", () => {
    expect(parseClaimComment(null)).toBeNull();
    expect(parseClaimComment(undefined)).toBeNull();
    expect(parseClaimComment("")).toBeNull();
    expect(parseClaimComment("managed by terraform")).toBeNull();
    expect(parseClaimComment("deployment:tei")).toBeNull();
    expect(parseClaimComment("deployment:tei created:yesterday")).toBeNull();
    expect(parseClaimComment("server:tei created:2026-06-12")).toBeNull();
    expect(parseClaimComment("deployment:Tei created:2026-06-12")).toBeNull();
    // No partial matches: extra trailing content is not a valid claim.
    expect(
      parseClaimComment("deployment:tei created:2026-06-12 extra"),
    ).toBeNull();
  });

  it("commentMatchesOwner matches kind+owner and ignores the creation date", () => {
    const comment = formatClaimComment({
      kind: "deployment",
      owner: "tei",
      created: "2025-01-01",
    });
    expect(commentMatchesOwner(comment, "deployment", "tei")).toBe(true);
    expect(commentMatchesOwner(comment, "tenant", "tei")).toBe(false);
    expect(commentMatchesOwner(comment, "deployment", "acme")).toBe(false);
    expect(commentMatchesOwner(null, "deployment", "tei")).toBe(false);
    expect(commentMatchesOwner("garbage", "deployment", "tei")).toBe(false);
  });
});
