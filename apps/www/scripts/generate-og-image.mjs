#!/usr/bin/env node
// One-shot generator for apps/www/public/og-image.png (1200x630).
// Uses the sharp installed in docs/ (not duplicated at the root).
// Run from the repo root: node apps/www/scripts/generate-og-image.mjs

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sharp = require(path.join(repoRoot, "docs/node_modules/sharp"));

const out = path.join(repoRoot, "apps/www/public/og-image.png");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
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

  <!-- Brand mark -->
  <g transform="translate(80,96)">
    <rect x="0" y="0" width="56" height="56" rx="12" fill="#38bdf8" fill-opacity="0.1" stroke="#38bdf8" stroke-opacity="0.4" stroke-width="1.5"/>
    <g stroke="#38bdf8" stroke-width="3.2" stroke-linecap="round" transform="translate(14,18)">
      <line x1="0" y1="0" x2="28" y2="0"/>
      <line x1="0" y1="10" x2="18" y2="10"/>
      <line x1="0" y1="20" x2="28" y2="20"/>
    </g>
    <text x="76" y="38" fill="#e2e8f0" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="28" font-weight="600" letter-spacing="-0.3">ThinkWork</text>
  </g>

  <!-- Eyebrow -->
  <g transform="translate(80,220)">
    <rect x="0" y="0" width="340" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.1"/>
    <circle cx="20" cy="18" r="4" fill="#38bdf8"/>
    <text x="36" y="24" fill="#cbd5e1" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="14" font-weight="500" letter-spacing="2">OPEN INFRASTRUCTURE FOR AI WORK</text>
  </g>

  <!-- Headline -->
  <text x="80" y="330" fill="#ffffff" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" letter-spacing="-2.5">Open agent infrastructure,</text>
  <text x="80" y="412" fill="#ffffff" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" letter-spacing="-2.5">minus the <tspan fill="#38bdf8">infrastructure headache.</tspan></text>

  <!-- Subhead -->
  <text x="80" y="486" fill="#94a3b8" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="26" font-weight="400">Threads, memory, agents, connectors, and control — inside your own AWS account.</text>

  <!-- Bottom strip -->
  <line x1="80" y1="540" x2="1120" y2="540" stroke="url(#stroke)" stroke-width="1"/>
  <text x="80" y="580" fill="#64748b" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="18" font-weight="500" letter-spacing="1">FIVE COMMANDS · ONE AWS ACCOUNT · OPEN SOURCE CORE</text>
  <text x="1120" y="580" fill="#64748b" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="18" font-weight="500" text-anchor="end">thinkwork.ai</text>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`✓ wrote ${path.relative(repoRoot, out)}`);
