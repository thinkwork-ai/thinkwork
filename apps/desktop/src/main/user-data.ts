export interface DesktopAppPathLike {
  isPackaged: boolean;
  setPath(name: "userData", path: string): void;
}

export function configureDevUserDataPath(
  app: DesktopAppPathLike,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const userDataDir = env.THINKWORK_DESKTOP_USER_DATA_DIR?.trim();
  if (app.isPackaged || !userDataDir) return;

  app.setPath("userData", userDataDir);
}
