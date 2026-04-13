#!/usr/bin/env node
// One-shot generator for apps/www/public/og-image.png (1200x630) and
// apps/www/public/favicon.png (256x256). Both assets share the brain
// path data in src/lib/brain-path.mjs so the rendered logo matches
// what the Astro <BrainMark> component puts in the DOM.
//
// Uses the sharp installed in docs/ so we don't duplicate a native dep
// at the root. Run from the repo root:
//
//   node apps/www/scripts/generate-brand-assets.mjs

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BRAIN_PATH_D,
  BRAIN_VIEWBOX,
  BRAIN_GROUP_TRANSFORM,
} from "../src/lib/brain-path.mjs";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const sharp = require(path.join(repoRoot, "docs/node_modules/sharp"));

const publicDir = path.join(repoRoot, "apps/www/public");
const ogOut = path.join(publicDir, "og-image.png");
const faviconOut = path.join(publicDir, "favicon.png");

// Stroke attributes applied to every rendered brain instance below so
// the node-graph reads bold at small sizes and matches the Astro
// <BrainMark> component's DOM output.
const BRAIN_STROKE = 'stroke="#38bdf8" stroke-width="0.7" stroke-linejoin="round" stroke-linecap="round"';

// ---------------------------------------------------------------------------
// Open Graph image (1200x630)
// ---------------------------------------------------------------------------

const ogSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="#38bdf8" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="stroke" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#070a0f"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Grid lines for subtle infra texture -->
  <g stroke="#ffffff" stroke-opacity="0.035" stroke-width="1">
    <line x1="0" y1="160" x2="1200" y2="160"/>
    <line x1="0" y1="470" x2="1200" y2="470"/>
    <line x1="80" y1="0" x2="80" y2="630"/>
    <line x1="1120" y1="0" x2="1120" y2="630"/>
  </g>

  <!-- Brand mark + wordmark -->
  <g transform="translate(80,84)">
    <svg x="0" y="0" width="96" height="96" viewBox="${BRAIN_VIEWBOX}" fill="#38bdf8">
      <g transform="${BRAIN_GROUP_TRANSFORM}">
        <path d="${BRAIN_PATH_D}" ${BRAIN_STROKE} />
      </g>
    </svg>
    <text x="116" y="68" fill="#e2e8f0" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="46" font-weight="700" letter-spacing="-0.8">ThinkWork</text>
  </g>

  <!-- Eyebrow -->
  <g transform="translate(80,244)">
    <rect x="0" y="0" width="340" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.1"/>
    <circle cx="20" cy="18" r="4" fill="#38bdf8"/>
    <text x="36" y="24" fill="#cbd5e1" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="14" font-weight="500" letter-spacing="2">OPEN INFRASTRUCTURE FOR AI WORK</text>
  </g>

  <!-- Headline -->
  <text x="80" y="350" fill="#ffffff" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" letter-spacing="-2.5">Open agent infrastructure,</text>
  <text x="80" y="432" fill="#ffffff" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" letter-spacing="-2.5">minus the <tspan fill="#38bdf8">infrastructure headache.</tspan></text>

  <!-- Subhead -->
  <text x="80" y="502" fill="#94a3b8" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="26" font-weight="400">Threads, memory, agents, connectors, and control — inside your own AWS account.</text>

  <!-- Bottom strip -->
  <line x1="80" y1="548" x2="1120" y2="548" stroke="url(#stroke)" stroke-width="1"/>
  <text x="80" y="586" fill="#64748b" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="18" font-weight="500" letter-spacing="1">FIVE COMMANDS · ONE AWS ACCOUNT · OPEN SOURCE CORE</text>
  <text x="1120" y="586" fill="#64748b" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="18" font-weight="500" text-anchor="end">thinkwork.ai</text>
</svg>`;

await sharp(Buffer.from(ogSvg))
  .png({ compressionLevel: 9 })
  .toFile(ogOut);
console.log(`✓ wrote ${path.relative(repoRoot, ogOut)}`);

// ---------------------------------------------------------------------------
// Favicon (256x256, transparent background — browsers downscale for the tab bar)
// ---------------------------------------------------------------------------

const faviconSize = 256;
const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${faviconSize}" height="${faviconSize}" viewBox="0 0 ${faviconSize} ${faviconSize}">
  <svg x="18" y="18" width="220" height="220" viewBox="${BRAIN_VIEWBOX}" fill="#38bdf8">
    <g transform="${BRAIN_GROUP_TRANSFORM}">
      <path d="${BRAIN_PATH_D}" ${BRAIN_STROKE} />
    </g>
  </svg>
</svg>`;

await sharp(Buffer.from(faviconSvg))
  .png({ compressionLevel: 9 })
  .toFile(faviconOut);
console.log(`✓ wrote ${path.relative(repoRoot, faviconOut)}`);
