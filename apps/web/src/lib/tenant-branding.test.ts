import { describe, expect, it } from "vitest";
import {
  brandingFromFeatures,
  normalizeFeatures,
  resolveBranding,
  DEFAULT_HEADER_TEXT,
  DEFAULT_LOGO_SRC,
} from "./tenant-branding";

const LOGO = "data:image/png;base64,abc123";

describe("normalizeFeatures", () => {
  it("parses a JSON string blob (AWSJSON)", () => {
    expect(normalizeFeatures('{"branding":{"headerText":"Acme"}}')).toEqual({
      branding: { headerText: "Acme" },
    });
  });

  it("returns an empty object for malformed input", () => {
    expect(normalizeFeatures("not json")).toEqual({});
    expect(normalizeFeatures(null)).toEqual({});
    expect(normalizeFeatures(["array"])).toEqual({});
  });
});

describe("brandingFromFeatures", () => {
  it("reads logoDataUrl and headerText", () => {
    expect(
      brandingFromFeatures({
        branding: { logoDataUrl: LOGO, headerText: "Acme" },
      }),
    ).toEqual({ logoDataUrl: LOGO, headerText: "Acme" });
  });

  it("rejects non-image logo values", () => {
    expect(
      brandingFromFeatures({
        branding: { logoDataUrl: "javascript:alert(1)" },
      }).logoDataUrl,
    ).toBeUndefined();
    expect(
      brandingFromFeatures({ branding: { logoDataUrl: 42 } }).logoDataUrl,
    ).toBeUndefined();
  });
});

describe("resolveBranding", () => {
  it("falls back to the defaults when nothing is set", () => {
    expect(resolveBranding({})).toEqual({
      logoSrc: DEFAULT_LOGO_SRC,
      isCustomLogo: false,
      headerText: DEFAULT_HEADER_TEXT,
    });
  });

  it("shows custom logo with custom text", () => {
    expect(resolveBranding({ logoDataUrl: LOGO, headerText: "Acme" })).toEqual({
      logoSrc: LOGO,
      isCustomLogo: true,
      headerText: "Acme",
    });
  });

  it("hides the text for logo-only mode (blank text + custom logo)", () => {
    expect(
      resolveBranding({ logoDataUrl: LOGO, headerText: "" }).headerText,
    ).toBeNull();
  });

  it("never renders a fully empty header — blank text without a logo keeps the default title", () => {
    expect(resolveBranding({ headerText: "  " }).headerText).toBe(
      DEFAULT_HEADER_TEXT,
    );
  });

  it("keeps the default title when only a logo is set", () => {
    expect(resolveBranding({ logoDataUrl: LOGO }).headerText).toBe(
      DEFAULT_HEADER_TEXT,
    );
  });
});
