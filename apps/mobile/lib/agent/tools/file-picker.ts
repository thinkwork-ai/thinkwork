// Native document-picker launcher (expo-document-picker).
//
// Kept behind a lazy require for the same reason as image-picker.ts: older dev clients or
// TestFlight builds may not include the native module yet. In that case the launcher
// degrades to a canceled pick instead of crashing app startup.

export interface PickedDocument {
  name: string;
  uri?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface DocumentPickerResult {
  canceled: boolean;
  assets?: PickedDocument[] | null;
}

export type LaunchDocumentPicker = () => Promise<DocumentPickerResult>;

type DocumentPickerModule = {
  getDocumentAsync: (opts: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: Array<{
      name: string;
      uri?: string | null;
      mimeType?: string | null;
      size?: number | null;
    }>;
  }>;
};

function loadDocumentPicker(): DocumentPickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-document-picker") as DocumentPickerModule;
  } catch (err) {
    console.warn(
      "[file-picker] expo-document-picker native module unavailable — rebuild the " +
        "dev client / app binary to enable file attach. Falling back to no-op.",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export const launchDocumentPicker: LaunchDocumentPicker = async () => {
  const DocumentPicker = loadDocumentPicker();
  if (!DocumentPicker) return { canceled: true };

  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: "*/*",
  });
  if (result.canceled) return { canceled: true };

  return {
    canceled: false,
    assets: (result.assets ?? []).map((asset) => ({
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      sizeBytes: asset.size,
    })),
  };
};
