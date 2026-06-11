export {
  primeRuntimeConfig,
  getConfig,
  requireConfig,
  getSecret,
  getApiAuthSecret,
  getAppsyncApiKey,
  deriveFunctionName,
  deriveFunctionArn,
  __resetRuntimeConfigForTests,
} from "./loader.js";

import { primeRuntimeConfig } from "./loader.js";

// Lambda cold start: load the document during module init so the first
// invocation already sees SSM-backed values. Top-level await is safe here —
// every handler bundle is ESM (build-lambdas.sh --format=esm) and Lambda
// waits for init to settle before dispatching. primeRuntimeConfig never
// throws, so a load failure degrades to env-and-defaults instead of
// crashing init. Outside Lambda (vitest, local dev, CLI) this is a no-op.
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  await primeRuntimeConfig();
}
