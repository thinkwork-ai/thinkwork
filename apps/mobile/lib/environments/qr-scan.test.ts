import { describe, expect, it } from "vitest";
import { parseEnvironmentQrPayload } from "./qr-scan";

describe("parseEnvironmentQrPayload", () => {
  it("accepts the web card's deployment-profile link", () => {
    const link = "thinkwork://deployment-profile?profile=abc123";
    expect(parseEnvironmentQrPayload(link)).toEqual({
      kind: "profile-link",
      link,
    });
  });

  it("accepts https URLs and bare hosts as environment URLs", () => {
    expect(parseEnvironmentQrPayload("https://mcpherson.thinkwork.ai")).toEqual(
      { kind: "url", url: "https://mcpherson.thinkwork.ai" },
    );
    expect(parseEnvironmentQrPayload("app.thinkwork.ai")).toEqual({
      kind: "url",
      url: "app.thinkwork.ai",
    });
  });

  it("rejects everything else", () => {
    expect(parseEnvironmentQrPayload("hello world").kind).toBe("invalid");
    expect(parseEnvironmentQrPayload("javascript:alert(1)").kind).toBe(
      "invalid",
    );
    expect(parseEnvironmentQrPayload("").kind).toBe("invalid");
    expect(parseEnvironmentQrPayload(undefined).kind).toBe("invalid");
  });
});
