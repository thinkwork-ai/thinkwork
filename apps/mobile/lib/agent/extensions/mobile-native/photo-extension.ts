import { pickImage } from "../../capture-image";
import { launchCamera, launchImagePicker } from "../../tools/image-picker";
import type { ExtensionFactory } from "../types";
import { defineExtension } from "../define-extension";
import type { MobileNativeEvidence, PickMobilePhoto } from "./types";
import { evidenceLine } from "./types";

export interface MobilePhotoExtensionOptions {
  pickPhoto?: PickMobilePhoto;
}

const defaultPickPhoto: PickMobilePhoto = async (source) => {
  const image = await pickImage(
    source === "camera" ? launchCamera : launchImagePicker,
  );
  return image ? { image, mimeType: `image/${image.format}` } : null;
};

export function mobilePhotoExtension(
  options: MobilePhotoExtensionOptions = {},
): ExtensionFactory {
  const pickPhoto = options.pickPhoto ?? defaultPickPhoto;
  return defineExtension({
    name: "mobile-photo",
    description: "Mobile host photo/camera capability",
    toolNames: ["mobile_photo"],
    register(pi) {
      pi.registerTool({
        name: "mobile_photo",
        description:
          "Ask the mobile host to let the user choose a photo from the camera or photo library. The OS picker/permission UI is visible to the user.",
        parameters: {
          type: "object",
          properties: {
            source: {
              type: "string",
              enum: ["camera", "photo_library"],
              description:
                "Where the host should ask the user to pick the image from.",
            },
          },
        },
        execute: async (args) => {
          const requested =
            args.source === "camera" || args.source === "photo_library"
              ? args.source
              : "photo_library";
          const picked = await pickPhoto(requested);
          if (!picked) {
            return {
              content: `No ${requested === "camera" ? "camera photo" : "photo library image"} was selected, or permission was denied.`,
              isError: true,
            };
          }
          const sizeBytes =
            picked.sizeBytes ?? Math.ceil((picked.image.data.length * 3) / 4);
          const evidence: MobileNativeEvidence = {
            type: "mobile_native_capability" as const,
            source: requested,
            name: picked.name,
            mimeType: picked.mimeType ?? `image/${picked.image.format}`,
            sizeBytes,
            textExtracted: false,
          };
          return {
            content: [
              "Mobile photo selected.",
              `Evidence: ${evidenceLine(evidence)}`,
              "Use the image already attached to the user turn when available; do not invent visual details that were not provided by the model input.",
            ].join("\n"),
          };
        },
      });

      pi.on("before_agent_start", (event) => ({
        systemPrompt: `${event.systemPrompt}\n\nMobile-native photo capability: \`mobile_photo\` can request a visible camera or photo-library picker when the user asks to attach an image. Prefer user-attached images already present on the turn before requesting another picker.`,
      }));
    },
  });
}
