import * as THREE from "three";

/**
 * Canvas-texture text sprite for persistent relationship labels on lit
 * edges (Graph Focus Mode). Same texture technique as the node label
 * sprites. The 2d-context guard keeps jsdom (no canvas backend) from
 * crashing in component tests — production browsers always have it.
 */
export function makeEdgeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const clipped = text.length > 24 ? text.slice(0, 23) + "…" : text;
    ctx.fillText(clipped, 128, 32);
  }
  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(48, 12, 1);
  return sprite;
}
