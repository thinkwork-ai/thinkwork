#!/usr/bin/env node
/**
 * Local dev proxy for the Stripe checkout-session endpoint.
 *
 * Shim until `terraform apply` deploys the real Lambda. Reads test-mode
 * keys from .env.local, ensures three test-mode products + prices exist
 * (idempotent via lookup_key), and serves POST /api/stripe/checkout-session
 * with the same request/response shape as the production Lambda so
 * apps/www can POST at it while the API is being deployed.
 *
 * Usage (from repo root):
 *   node scripts/dev-stripe-proxy.mjs
 *
 * Then start Astro dev with:
 *   PUBLIC_API_URL=http://localhost:4322 pnpm --filter @thinkwork/www dev
 *
 * CORS: wide-open for dev (allow_origins=*, allowed_methods=POST/OPTIONS).
 * Do NOT run this pointing at a live-mode secret_key.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Resolve Stripe from the @thinkwork/api package's node_modules since it's
// the only workspace that carries the dep.
const require = createRequire(
  new URL("../packages/api/package.json", import.meta.url),
);
const Stripe = require("stripe").default ?? require("stripe");

// ─── Load .env.local ─────────────────────────────────────────────────────
const envPath = new URL("../.env.local", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      if (idx < 0) return [l.trim(), ""];
      const k = l.slice(0, idx).trim();
      const v = l
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      return [k, v];
    }),
);

if (!env.secret_key?.startsWith("sk_test_")) {
  console.error(
    "[dev-stripe-proxy] Refusing to start: .env.local secret_key must be a test-mode key (starts with sk_test_).",
  );
  process.exit(1);
}

const stripe = new Stripe(env.secret_key, {
  apiVersion: "2025-02-24.acacia",
  maxNetworkRetries: 2,
  typescript: false,
});

// ─── Ensure products + prices exist ──────────────────────────────────────
// Monthly test-mode pricing. Matches the plan IDs in apps/www/src/lib/copy.ts
// (plans[].id = 'starter' | 'team' | 'enterprise').
const PLANS = [
  { id: "starter", name: "ThinkWork Starter", amountCents: 4900 },
  { id: "team", name: "ThinkWork Team", amountCents: 19900 },
  { id: "enterprise", name: "ThinkWork Enterprise", amountCents: 99900 },
];

const priceIds = {};

async function ensurePrice(plan) {
  const lookupKey = `thinkwork_${plan.id}_monthly_dev`;

  // Prices filtered by lookup_key are idempotent lookups.
  const found = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (found.data[0]) {
    priceIds[plan.id] = found.data[0].id;
    console.log(
      `[dev-stripe-proxy] ${plan.id.padEnd(10)} ✓ existing  ${found.data[0].id}`,
    );
    return;
  }

  // Try to re-use the product by name so we don't accumulate dupes on
  // repeated fresh runs. Stripe products don't expose lookup keys, so we
  // search by name via list().
  const products = await stripe.products.search({
    query: `name:"${plan.name}" AND active:"true"`,
  });
  const product = products.data[0] ?? (await stripe.products.create({
    name: plan.name,
    description: `${plan.name} monthly subscription (dev/test).`,
  }));

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amountCents,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    nickname: `${plan.name} — monthly (dev)`,
    metadata: { plan: plan.id, env: "dev" },
  });
  priceIds[plan.id] = price.id;
  console.log(
    `[dev-stripe-proxy] ${plan.id.padEnd(10)} ✓ created   ${price.id}`,
  );
}

// ─── HTTP server ─────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 4322;
const ADMIN_URL = process.env.ADMIN_URL || "https://admin.thinkwork.ai";
const WWW_URL = process.env.WWW_URL || "http://localhost:4321";

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key",
  );
  res.setHeader("Access-Control-Max-Age", "3600");
}

function json(res, status, body) {
  withCors(res);
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function handleCheckoutSession(req, res) {
  let raw = "";
  for await (const chunk of req) raw += chunk;

  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const plan = typeof body.plan === "string" ? body.plan.trim() : "";
  if (!plan) return json(res, 400, { error: "Missing `plan`" });

  const priceId = priceIds[plan];
  if (!priceId) {
    return json(res, 400, {
      error: `Unknown plan "${plan}". Known plans: ${Object.keys(priceIds).join(", ")}`,
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // subscription mode auto-creates customers; customer_creation is
      // payment-mode-only per the Stripe API.
      customer_email: body.email,
      allow_promotion_codes: true,
      success_url: `${ADMIN_URL}/onboarding/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${WWW_URL}/pricing`,
      metadata: { plan, source: "dev-proxy" },
      subscription_data: { metadata: { plan, source: "dev-proxy" } },
    });
    console.log(
      `[dev-stripe-proxy] created session plan=${plan} id=${session.id}`,
    );
    return json(res, 200, { url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[dev-stripe-proxy] stripe error:", err.message);
    return json(res, 502, { error: err.message || "Stripe API error" });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    withCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = (req.url || "").split("?")[0];

  if (url === "/api/stripe/checkout-session" && req.method === "POST") {
    return handleCheckoutSession(req, res);
  }

  if (url === "/_proxy/health") {
    return json(res, 200, { ok: true, priceIds });
  }

  json(res, 404, { error: "Not found" });
});

// ─── Start ──────────────────────────────────────────────────────────────
console.log("[dev-stripe-proxy] ensuring prices exist ...");
await Promise.all(PLANS.map(ensurePrice));

server.listen(PORT, () => {
  console.log(
    `[dev-stripe-proxy] listening on http://localhost:${PORT}  (success → ${ADMIN_URL})`,
  );
  console.log(
    `[dev-stripe-proxy] POST /api/stripe/checkout-session { plan: "starter" | "team" | "enterprise" }`,
  );
});
