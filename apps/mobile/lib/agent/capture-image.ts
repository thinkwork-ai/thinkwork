// Image capture → multimodal ImagePart (pure core).
//
// The showcase ("photo of a business card → CRM opportunity") is a composition: this picks
// an image and turns it into an ImagePart, the UI attaches it to the next `session.prompt`
// (multimodal, U3), and the model extracts fields + calls a CRM MCP tool (U4). This module
// is the pure mapping — no expo import — so it's unit-testable; the native picker is injected
// (see tools/image-picker.ts for the expo-image-picker launcher).

import type { ImageFormat, ImagePart } from "./types";

export interface PickedAsset {
  base64?: string | null;
  mimeType?: string | null;
}

export interface PickerResult {
  canceled: boolean;
  assets?: PickedAsset[] | null;
}

/** Launches the device image picker and resolves the user's selection. */
export type LaunchPicker = () => Promise<PickerResult>;

export function mimeToImageFormat(mime?: string | null): ImageFormat {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "jpeg";
}

/**
 * Pick an image and return it as an ImagePart for the next multimodal turn, or null when
 * the user cancels or no usable asset comes back.
 */
export async function pickImage(
  launch: LaunchPicker,
): Promise<ImagePart | null> {
  const result = await launch();
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.base64) return null;
  return { format: mimeToImageFormat(asset.mimeType), data: asset.base64 };
}
