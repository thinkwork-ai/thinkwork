import { describe, expect, it } from "vitest";
import {
  EnvironmentSetupError,
  normalizeEnvironmentHost,
} from "./url-normalize";

describe("normalizeEnvironmentHost", () => {
  it("normalizes a bare host to an HTTPS origin", () => {
    expect(normalizeEnvironmentHost("mcpherson.thinkwork.ai")).toBe(
      "https://mcpherson.thinkwork.ai",
    );
  });

  it("strips a scheme-less path", () => {
    expect(normalizeEnvironmentHost("mcpherson.thinkwork.ai/settings")).toBe(
      "https://mcpherson.thinkwork.ai",
    );
  });

  it("strips a full URL path, query, and fragment", () => {
    expect(
      normalizeEnvironmentHost(
        "https://mcpherson.thinkwork.ai/some/page?tab=setup#mobile",
      ),
    ).toBe("https://mcpherson.thinkwork.ai");
  });

  it("upgrades explicit HTTP input to HTTPS", () => {
    expect(normalizeEnvironmentHost("http://mcpherson.thinkwork.ai")).toBe(
      "https://mcpherson.thinkwork.ai",
    );
  });

  it("rejects garbage input", () => {
    expect(() => normalizeEnvironmentHost("not a url !!")).toThrow(
      EnvironmentSetupError,
    );
  });

  it("rejects empty input", () => {
    expect(() => normalizeEnvironmentHost("  ")).toThrow(
      EnvironmentSetupError,
    );
  });

  it("lowercases hostnames", () => {
    expect(normalizeEnvironmentHost("HTTPS://McPherson.ThinkWork.AI")).toBe(
      "https://mcpherson.thinkwork.ai",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeEnvironmentHost("https://mcpherson.thinkwork.ai///")).toBe(
      "https://mcpherson.thinkwork.ai",
    );
  });

  it("keeps host ports", () => {
    expect(normalizeEnvironmentHost("localhost:5174/settings")).toBe(
      "https://localhost:5174",
    );
  });
});
