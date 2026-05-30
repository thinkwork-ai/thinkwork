import type { ExtensionFactory } from "../types";
import { defineExtension } from "../define-extension";
import type { ConfirmClipboardRead, ReadClipboardText } from "./types";
import { evidenceLine, truncateMobileNativeText } from "./types";

export interface MobileClipboardExtensionOptions {
  confirmRead?: ConfirmClipboardRead;
  readText?: ReadClipboardText;
}

const defaultConfirmRead: ConfirmClipboardRead = async () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require("react-native") as {
      Alert?: {
        alert: (
          title: string,
          message?: string,
          buttons?: Array<{
            text: string;
            style?: string;
            onPress?: () => void;
          }>,
        ) => void;
      };
    };
    if (!Alert?.alert) return false;
    return await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Allow clipboard read?",
        "The agent requested clipboard text.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Allow", onPress: () => resolve(true) },
        ],
      );
    });
  } catch {
    return false;
  }
};

const defaultReadText: ReadClipboardText = async () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as {
      getStringAsync?: () => Promise<string>;
    };
    return (await Clipboard.getStringAsync?.()) ?? null;
  } catch {
    return null;
  }
};

export function mobileClipboardExtension(
  options: MobileClipboardExtensionOptions = {},
): ExtensionFactory {
  const confirmRead = options.confirmRead ?? defaultConfirmRead;
  const readText = options.readText ?? defaultReadText;
  return defineExtension({
    name: "mobile-clipboard",
    description: "Mobile host clipboard read capability",
    toolNames: ["mobile_clipboard"],
    register(pi) {
      pi.registerTool({
        name: "mobile_clipboard",
        description:
          "Read the device clipboard only after a visible user approval prompt.",
        parameters: { type: "object" },
        execute: async () => {
          const approved = await confirmRead();
          if (!approved) {
            return {
              content: "Clipboard read was not approved by the user.",
              isError: true,
            };
          }
          const text = await readText();
          if (!text) {
            return {
              content: "Clipboard did not contain readable text.",
              isError: true,
            };
          }
          const evidence = {
            type: "mobile_native_capability" as const,
            source: "clipboard" as const,
            mimeType: "text/plain",
            sizeBytes: text.length,
            textExtracted: true,
          };
          return {
            content: [
              "Mobile clipboard text read after user approval.",
              `Evidence: ${evidenceLine(evidence)}`,
              `Clipboard text:\n${truncateMobileNativeText(text)}`,
            ].join("\n"),
          };
        },
      });

      pi.on("before_agent_start", (event) => ({
        systemPrompt: `${event.systemPrompt}\n\nMobile-native clipboard capability: \`mobile_clipboard\` can read text only after visible user approval. If approval is denied, recover gracefully and ask the user to paste the text instead.`,
      }));
    },
  });
}
