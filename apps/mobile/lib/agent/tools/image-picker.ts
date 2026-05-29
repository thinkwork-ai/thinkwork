// Native image-picker launcher (expo-image-picker) — the device half of capture-image.
//
// Isolated from the pure pickImage() mapper so the testable core stays free of native
// imports. This is verified on a device build, not in vitest. Requires expo-image-picker
// (added to package.json) + the camera/photo permissions declared in app.json, and a
// native prebuild/EAS build to take effect (it won't work in Expo Go).

import * as ImagePicker from "expo-image-picker";
import type { LaunchPicker } from "../capture-image";

/** Launches the photo library, requesting permission first; returns base64 for the pick. */
export const launchImagePicker: LaunchPicker = async () => {
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
    assets: result.assets.map((asset) => ({
      base64: asset.base64,
      mimeType: asset.mimeType,
    })),
  };
};
