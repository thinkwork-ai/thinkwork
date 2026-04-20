import type { CameraState } from "../types";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export function screenToWorld(
  camera: CameraState,
  screen: ScreenPoint,
): WorldPoint {
  return {
    x: (screen.x - camera.tx) / camera.scale,
    y: (screen.y - camera.ty) / camera.scale,
  };
}

export function worldToScreen(
  camera: CameraState,
  world: WorldPoint,
): ScreenPoint {
  return {
    x: world.x * camera.scale + camera.tx,
    y: world.y * camera.scale + camera.ty,
  };
}
