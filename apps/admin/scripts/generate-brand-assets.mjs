#!/usr/bin/env node
// Regenerate the admin app brand assets from the shared brain path
// in scripts/lib/brain-path.mjs so the favicon + sidebar/sign-in
// logo match the mobile icon and the docs favicon (and the
// extracted marketing site, which keeps its own copy of the same
// path data).
//
// Outputs:
//   apps/admin/public/favicon.png  — 256x256, width-fill, browser-downscaled
//   apps/admin/public/logo.png     — non-square rect at brain aspect for
//                                    inline UI use (sidebar + sign-in card)
//
// Uses the sharp already installed in docs/node_modules.
// Run from the repo root:
//
//   node apps/admin/scripts/generate-brand-assets.mjs
//
// Brain icon by Sergey Patutin / The Noun Project (CC BY 3.0).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BRAIN_PATH_D,
  BRAIN_VIEWBOX,
  BRAIN_GROUP_TRANSFORM,
} from "../../../scripts/lib/brain-path.mjs";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const sharp = require(path.join(repoRoot, "docs/node_modules/sharp"));

const BRAND = "#38bdf8";
const STROKE_ATTRS = `stroke="${BRAND}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;

const publicDir = path.join(repoRoot, "apps/admin/public");
const faviconOut = path.join(publicDir, "favicon.png");
const logoOut = path.join(publicDir, "logo.png");

async function renderPng(svg, outPath) {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${path.relative(repoRoot, outPath)}`);
}

const [, , vbW, vbH] = BRAIN_VIEWBOX.split(" ").map(Number);

// ---------------------------------------------------------------------------
// Favicon (256x256) — width-based fill, matches www/docs/mobile style
// ---------------------------------------------------------------------------

const faviconSize = 256;
const favBrainW = Math.round(faviconSize * 0.95);
const favBrainH = Math.round((favBrainW * vbH) / vbW);
const favOffsetX = Math.round((faviconSize - favBrainW) / 2);
const favOffsetY = Math.round((faviconSize - favBrainH) / 2);

const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${faviconSize}" height="${faviconSize}" viewBox="0 0 ${faviconSize} ${faviconSize}">
  <svg x="${favOffsetX}" y="${favOffsetY}" width="${favBrainW}" height="${favBrainH}" viewBox="${BRAIN_VIEWBOX}" fill="${BRAND}">
    <g transform="${BRAIN_GROUP_TRANSFORM}">
      <path d="${BRAIN_PATH_D}" ${STROKE_ATTRS} />
    </g>
  </svg>
</svg>`;
await renderPng(faviconSvg, faviconOut);

// ---------------------------------------------------------------------------
// Inline UI logo (non-square, edge-to-edge at brain aspect)
// ---------------------------------------------------------------------------

const logoW = 512;
const logoH = Math.round(logoW * (vbH / vbW));
const logoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${logoW}" height="${logoH}" viewBox="${BRAIN_VIEWBOX}" fill="${BRAND}">
  <g transform="${BRAIN_GROUP_TRANSFORM}">
    <path d="${BRAIN_PATH_D}" ${STROKE_ATTRS} />
  </g>
</svg>`;
await renderPng(logoSvg, logoOut);
