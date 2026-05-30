// Native image-picker launchers (expo-image-picker) — the device half of capture-image.
//
// Isolated from the pure pickImage() mapper so the testable core stays free of native
// imports. Verified on a device build, not in vitest. Requires expo-image-picker + the
// camera/photo permissions in app.json AND a native build that includes the module.
//
// LAZY-LOADED ON PURPOSE: `expo-image-picker` is a native module. If the running binary
// (dev client / TestFlight) was built BEFORE the module was added, importing it at module
// load throws "Cannot find native module 'ExponentImagePicker'" — and because a startup
// screen transitively imports this file, that would crash the whole app on launch. So we
// require() it only when a launcher actually runs, and degrade to a no-op (canceled) +
// console warning when it's absent. Once the binary is rebuilt with the module, the
// launchers work with no code change.
//
// Two launchers — photo library and camera — return the same shape, so the pure
// pickImage(launch) mapper is launcher-agnostic and the composer can offer either.

import type { LaunchPicker } from "../capture-image";

// Minimal shape of the bits of expo-image-picker we use — avoids a type-level import
// (which is erased at build and safe) while keeping the runtime require() lazy.
type ImagePickerModule = {
  requestMediaLibraryPermissionsAsync: () => Promise<{ granted: boolean }>;
  requestCameraPermissionsAsync: () => Promise<{ granted: boolean }>;
  launchImageLibraryAsync: (opts: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: Array<{ base64?: string | null; mimeType?: string | null }>;
  }>;
  launchCameraAsync: (opts: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: Array<{ base64?: string | null; mimeType?: string | null }>;
  }>;
};

/**
 * Resolve expo-image-picker at call time. Returns null (with a clear warning) when the
 * native module isn't in the running binary, so callers degrade instead of crashing.
 */
function loadImagePicker(): ImagePickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-image-picker") as ImagePickerModule;
  } catch (err) {
    console.warn(
      "[image-picker] expo-image-picker native module unavailable — rebuild the dev " +
        "client / app binary to enable image attach. Falling back to no-op.",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Launches the photo library, requesting permission first; returns base64 for the pick. */
export const launchImagePicker: LaunchPicker = async () => {
  const ImagePicker = loadImagePicker();
  if (!ImagePicker) return { canceled: true };

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { canceled: true };

  const result = await ImagePicker.launchImageLibraryAsync({
    base64: true,
    mediaTypes: ["images"],
    quality: 0.7,
  });
  if (result.canceled) return { canceled: true };

  return {
    canceled: false,
    assets: (result.assets ?? []).map((asset) => ({
      base64: asset.base64,
      mimeType: asset.mimeType,
    })),
  };
};

/** Launches the camera, requesting permission first; returns base64 for the capture. */
export const launchCamera: LaunchPicker = async () => {
  const ImagePicker = loadImagePicker();
  if (!ImagePicker) return { canceled: true };

  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { canceled: true };

  const result = await ImagePicker.launchCameraAsync({
    base64: true,
    quality: 0.7,
  });
  if (result.canceled) return { canceled: true };

  return {
    canceled: false,
    assets: (result.assets ?? []).map((asset) => ({
      base64: asset.base64,
      mimeType: asset.mimeType,
    })),
  };
};

/**
 * Whether image attach is available in the running binary (native module present).
 * The composer can use this to show a "rebuild needed" hint instead of a dead button.
 */
export function isImagePickerAvailable(): boolean {
  return loadImagePicker() !== null;
}
