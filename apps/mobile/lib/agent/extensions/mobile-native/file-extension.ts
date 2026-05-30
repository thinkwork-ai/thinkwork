import { launchDocumentPicker } from "../../tools/file-picker";
import type { ExtensionFactory } from "../types";
import { defineExtension } from "../define-extension";
import type { PickMobileFile } from "./types";
import { evidenceLine, truncateMobileNativeText } from "./types";

export interface MobileFileExtensionOptions {
  pickFile?: PickMobileFile;
}

const defaultPickFile: PickMobileFile = async () => {
  const result = await launchDocumentPicker();
  const asset = result.canceled ? null : result.assets?.[0];
  return asset ? { ...asset, text: null } : null;
};

export function mobileFileExtension(
  options: MobileFileExtensionOptions = {},
): ExtensionFactory {
  const pickFile = options.pickFile ?? defaultPickFile;
  return defineExtension({
    name: "mobile-file",
    description: "Mobile host file attachment capability",
    toolNames: ["mobile_file"],
    register(pi) {
      pi.registerTool({
        name: "mobile_file",
        description:
          "Ask the mobile host to let the user choose one local file. The picker is visible to the user and returns file metadata plus extracted text when available.",
        parameters: { type: "object" },
        execute: async () => {
          const picked = await pickFile();
          if (!picked) {
            return {
              content: "No file was selected, or document access was denied.",
              isError: true,
            };
          }
          const text = picked.text
            ? truncateMobileNativeText(picked.text)
            : null;
          const evidence = {
            type: "mobile_native_capability" as const,
            source: "file" as const,
            name: picked.name,
            mimeType: picked.mimeType ?? null,
            sizeBytes: picked.sizeBytes ?? null,
            textExtracted: Boolean(text),
          };
          return {
            content: [
              "Mobile file selected.",
              `Evidence: ${evidenceLine(evidence)}`,
              text
                ? `Extracted text:\n${text}`
                : "Text extraction was not available for this file in the current mobile host.",
            ].join("\n"),
          };
        },
      });

      pi.on("before_agent_start", (event) => ({
        systemPrompt: `${event.systemPrompt}\n\nMobile-native file capability: \`mobile_file\` can request a visible document picker and returns file metadata plus extracted text when available. Treat denied permission or canceled picks as recoverable tool results.`,
      }));
    },
  });
}
