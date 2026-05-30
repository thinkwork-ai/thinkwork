import type { ExtensionFactory } from "../types";
import {
  mobileClipboardExtension,
  type MobileClipboardExtensionOptions,
} from "./clipboard-extension";
import {
  mobileFileExtension,
  type MobileFileExtensionOptions,
} from "./file-extension";
import {
  mobilePhotoExtension,
  type MobilePhotoExtensionOptions,
} from "./photo-extension";

export interface MobileNativeExtensionOptions {
  photo?: MobilePhotoExtensionOptions;
  file?: MobileFileExtensionOptions;
  clipboard?: MobileClipboardExtensionOptions;
}

export function mobileNativeExtensions(
  options: MobileNativeExtensionOptions = {},
): ExtensionFactory[] {
  return [
    mobilePhotoExtension(options.photo),
    mobileFileExtension(options.file),
    mobileClipboardExtension(options.clipboard),
  ];
}

export { mobileClipboardExtension } from "./clipboard-extension";
export type { MobileClipboardExtensionOptions } from "./clipboard-extension";
export { mobileFileExtension } from "./file-extension";
export type { MobileFileExtensionOptions } from "./file-extension";
export { mobilePhotoExtension } from "./photo-extension";
export type { MobilePhotoExtensionOptions } from "./photo-extension";
export type {
  ConfirmClipboardRead,
  MobileNativeEvidence,
  MobileNativeSource,
  PickedMobileFile,
  PickedMobilePhoto,
  PickMobileFile,
  PickMobilePhoto,
  ReadClipboardText,
} from "./types";
