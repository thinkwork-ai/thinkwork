#!/usr/bin/env node
// Regenerate the docs site brand assets (public/favicon.png + the
// Starlight site logo at src/assets/logo.png) from the shared brain
// path in apps/www/src/lib/brain-path.mjs so every surface — docs,
// www, and mobile — renders from the same source of truth.
//
// Uses the sharp already installed in docs/node_modules.
// Run from the repo root:
//
//   node docs/scripts/generate-brand-assets.mjs
//
// Brain icon by Sergey Patutin / The Noun Project (CC BY 3.0).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BRAIN_PATH_D,
  BRAIN_VIEWBOX,
  BRAIN_GROUP_TRANSFORM,
} from "../../apps/www/src/lib/brain-path.mjs";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sharp = require(path.join(repoRoot, "docs/node_modules/sharp"));

const BRAND = "#38bdf8";
const STROKE_ATTRS = `stroke="${BRAND}" stroke-width="0.7" stroke-linejoin="round" stroke-linecap="round"`;

const faviconOut = path.join(repoRoot, "docs/public/favicon.png");
const logoOut = path.join(repoRoot, "docs/src/assets/logo.png");

async function renderPng(svg, outPath) {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${path.relative(repoRoot, outPath)}`);
}

// ---------------------------------------------------------------------------
// Favicon (256x256, transparent)
// ---------------------------------------------------------------------------

const faviconSize = 256;
const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${faviconSize}" height="${faviconSize}" viewBox="0 0 ${faviconSize} ${faviconSize}">
  <svg x="18" y="18" width="220" height="220" viewBox="${BRAIN_VIEWBOX}" fill="${BRAND}">
    <g transform="${BRAIN_GROUP_TRANSFORM}">
      <path d="${BRAIN_PATH_D}" ${STROKE_ATTRS} />
    </g>
  </svg>
</svg>`;
await renderPng(faviconSvg, faviconOut);

// ---------------------------------------------------------------------------
// Starlight site logo — edge-to-edge, non-square, matches brain aspect
// so Starlight's header layout doesn't bake in whitespace around it.
// ---------------------------------------------------------------------------

const [, , vbW, vbH] = BRAIN_VIEWBOX.split(" ").map(Number);
const logoW = 512;
const logoH = Math.round(logoW * (vbH / vbW));
const logoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${logoW}" height="${logoH}" viewBox="${BRAIN_VIEWBOX}" fill="${BRAND}">
  <g transform="${BRAIN_GROUP_TRANSFORM}">
    <path d="${BRAIN_PATH_D}" ${STROKE_ATTRS} />
  </g>
</svg>`;
await renderPng(logoSvg, logoOut);
