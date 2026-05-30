import type { ImagePart } from "../../types";
import type { PickedDocument } from "../../tools/file-picker";

export type MobileNativeSource =
  | "camera"
  | "photo_library"
  | "file"
  | "clipboard";

export interface MobileNativeEvidence {
  type: "mobile_native_capability";
  source: MobileNativeSource;
  name?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  textExtracted?: boolean;
}

export interface PickedMobilePhoto {
  image: ImagePart;
  name?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface PickedMobileFile extends PickedDocument {
  text?: string | null;
}

export type PickMobilePhoto = (
  source: "camera" | "photo_library",
) => Promise<PickedMobilePhoto | null>;
export type PickMobileFile = () => Promise<PickedMobileFile | null>;
export type ConfirmClipboardRead = () => Promise<boolean>;
export type ReadClipboardText = () => Promise<string | null>;

export const MOBILE_NATIVE_TEXT_LIMIT = 12_000;

export function truncateMobileNativeText(text: string): string {
  if (text.length <= MOBILE_NATIVE_TEXT_LIMIT) return text;
  return `${text.slice(0, MOBILE_NATIVE_TEXT_LIMIT)}\n\n[truncated ${text.length - MOBILE_NATIVE_TEXT_LIMIT} chars]`;
}

export function evidenceLine(evidence: MobileNativeEvidence): string {
  return JSON.stringify(evidence);
}
