import type { NativeImage } from "electron";
import { join } from "node:path";

export interface DesktopBrandingAppLike {
  dock?: {
    setIcon(image: NativeImage | string): void;
  };
  isPackaged: boolean;
  setName(name: string): void;
  setAboutPanelOptions(options: { applicationName: string }): void;
  setAppUserModelId?(id: string): void;
  whenReady(): Promise<void>;
}

export interface DesktopBrandingImageLoader {
  createFromPath(path: string): NativeImage;
}

export interface ConfigureDesktopBrandingOptions {
  app: DesktopBrandingAppLike;
  nativeImage: DesktopBrandingImageLoader;
  rootDir: string;
  productName?: string;
  appId?: string;
}

export async function configureDesktopBranding({
  app,
  nativeImage,
  rootDir,
  productName = "ThinkWork Spaces",
  appId = "ai.thinkwork.spaces.desktop.dev",
}: ConfigureDesktopBrandingOptions): Promise<void> {
  app.setName(productName);
  app.setAboutPanelOptions({ applicationName: productName });
  app.setAppUserModelId?.(appId);

  if (app.isPackaged || !app.dock) return;
  await app.whenReady();

  const icon = nativeImage.createFromPath(
    join(rootDir, "../../build/icons/icon.png"),
  );
  app.dock.setIcon(icon);
}
