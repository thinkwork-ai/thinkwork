import { describe, expect, it, vi } from "vitest";
import { loadExtensions } from "../load-extensions";
import {
  mobileClipboardExtension,
  mobileFileExtension,
  mobileNativeExtensions,
  mobilePhotoExtension,
} from ".";

describe("mobile native extensions", () => {
  it("registers photo, file, and clipboard tools as one host capability bundle", async () => {
    const loaded = await loadExtensions(
      mobileNativeExtensions({
        photo: { pickPhoto: vi.fn() },
        file: { pickFile: vi.fn() },
        clipboard: { confirmRead: vi.fn(), readText: vi.fn() },
      }),
    );

    expect(loaded.tools.map((tool) => tool.name)).toEqual([
      "mobile_photo",
      "mobile_file",
      "mobile_clipboard",
    ]);
  });

  it("returns photo evidence when the user selects an image", async () => {
    const loaded = await loadExtensions([
      mobilePhotoExtension({
        pickPhoto: async (source) => ({
          image: { format: "png", data: "QUJD" },
          name: `${source}.png`,
          mimeType: "image/png",
          sizeBytes: 3,
        }),
      }),
    ]);

    const result = await loaded.tools[0].execute({ source: "camera" }, {});

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Mobile photo selected.");
    expect(result.content).toContain('"source":"camera"');
    expect(result.content).toContain('"sizeBytes":3');
  });

  it("returns recoverable photo errors for canceled or denied selection", async () => {
    const loaded = await loadExtensions([
      mobilePhotoExtension({ pickPhoto: async () => null }),
    ]);

    const result = await loaded.tools[0].execute(
      { source: "photo_library" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("permission was denied");
  });

  it("returns file metadata and extracted text when available", async () => {
    const loaded = await loadExtensions([
      mobileFileExtension({
        pickFile: async () => ({
          name: "brief.txt",
          mimeType: "text/plain",
          sizeBytes: 11,
          text: "hello world",
        }),
      }),
    ]);

    const result = await loaded.tools[0].execute({}, {});

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('"source":"file"');
    expect(result.content).toContain('"textExtracted":true');
    expect(result.content).toContain("hello world");
  });

  it("requires approval before reading clipboard text", async () => {
    const readText = vi.fn().mockResolvedValue("secret clipboard text");
    const denied = await loadExtensions([
      mobileClipboardExtension({
        confirmRead: async () => false,
        readText,
      }),
    ]);

    const deniedResult = await denied.tools[0].execute({}, {});
    expect(deniedResult.isError).toBe(true);
    expect(readText).not.toHaveBeenCalled();

    const approved = await loadExtensions([
      mobileClipboardExtension({
        confirmRead: async () => true,
        readText,
      }),
    ]);
    const approvedResult = await approved.tools[0].execute({}, {});

    expect(approvedResult.isError).toBeUndefined();
    expect(approvedResult.content).toContain('"source":"clipboard"');
    expect(approvedResult.content).toContain("secret clipboard text");
  });
});
