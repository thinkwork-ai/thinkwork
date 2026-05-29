import { describe, expect, it, vi } from "vitest";
import { mimeToImageFormat, pickImage } from "./capture-image";

describe("mimeToImageFormat", () => {
  it("maps common mime types, defaulting to jpeg", () => {
    expect(mimeToImageFormat("image/png")).toBe("png");
    expect(mimeToImageFormat("image/webp")).toBe("webp");
    expect(mimeToImageFormat("image/gif")).toBe("gif");
    expect(mimeToImageFormat("image/jpeg")).toBe("jpeg");
    expect(mimeToImageFormat(undefined)).toBe("jpeg");
  });
});

describe("pickImage", () => {
  it("returns an ImagePart for a picked asset", async () => {
    const launch = vi.fn().mockResolvedValue({
      canceled: false,
      assets: [{ base64: "QUJD", mimeType: "image/png" }],
    });
    expect(await pickImage(launch)).toEqual({ format: "png", data: "QUJD" });
  });

  it("returns null when the user cancels", async () => {
    const launch = vi.fn().mockResolvedValue({ canceled: true });
    expect(await pickImage(launch)).toBeNull();
  });

  it("returns null when no base64 asset comes back", async () => {
    const launch = vi.fn().mockResolvedValue({
      canceled: false,
      assets: [{ base64: null, mimeType: "image/jpeg" }],
    });
    expect(await pickImage(launch)).toBeNull();
  });
});
