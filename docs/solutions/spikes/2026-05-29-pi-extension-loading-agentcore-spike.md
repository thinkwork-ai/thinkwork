---
title: Loading Pi extensions in the serverless AgentCore container
date: 2026-05-29
component: agentcore-pi
problem_type: spike
status: mechanism-resolved-pending-dev-confirmation
plan: docs/plans/2026-05-29-004-refactor-pi-extensions-architecture-plan.md
unit: U1
sdk: "@earendil-works/pi-coding-agent@0.76.0"
---

# Loading Pi extensions in the serverless AgentCore container (U1 spike)

## Question

The Pi extensions architecture (plan U1, origin Q1/AE5) needs the cloud
runtime — a stateless AgentCore container — to load the shared
`@thinkwork/pi-extensions` capability set into a `createAgentSession()` turn. Pi's
docs note extensions are *"not serverless by default"* and auto-discover from
filesystem locations (`~/.pi/agent/extensions`, `.pi/extensions`) or a
`settings.json` `extensions` array. The gating unknown: **what is the clean way to
load bundled extensions in the container, and does it actually surface their tools
into the session?**

## Finding (resolved statically from the SDK; pending dev-deploy confirmation)

**There is a programmatic, filesystem-free loading path: `extensionFactories` on
the resource loader.** It is the recommended mechanism for the serverless cloud.

Evidence in `@earendil-works/pi-coding-agent@0.76.0` dist:

- `core/resource-loader.d.ts` — `DefaultResourceLoaderOptions` exposes
  `extensionFactories?: ExtensionFactory[]` (and `extensionsOverride?`). The
  resource loader accepts extension **factory functions directly**.
- `core/sdk.js:285` — `createAgentSession` sources extensions via
  `resourceLoader.getExtensions()`; `CreateAgentSessionOptions.resourceLoader`
  lets the caller supply a pre-built `DefaultResourceLoader`.
- `core/extensions/loader.d.ts` — lower-level primitives also exist
  (`loadExtensionFromFactory`, `loadExtensions(paths)`, `discoverAndLoadExtensions`,
  `createExtensionRuntime`) if finer control is ever needed.
- `core/settings-manager.d.ts:52,77` — `settings.extensions?: string[]` (file
  paths) is the *path-discovery* alternative.

### Why `extensionFactories` is the right cloud mechanism

- **No filesystem discovery.** Our extensions are bundled application code; we
  import their factory functions and hand them to the loader. Nothing has to live
  at a magic path in the image, and we don't depend on FS scanning at boot.
- **Sidesteps the "not serverless by default" caveat.** That caveat is about (a)
  FS-based discovery and (b) extensions persisting in-memory state across a session
  on one machine. Factory injection avoids (a) entirely; (b) is a non-issue
  because thinkwork extensions are stateless — they call AWS/Hindsight/HTTP per
  invocation and externalize all state, which is exactly what the docs prescribe
  for distributed use.
- **Type-safe + bundleable.** Factories are real imported symbols, so esbuild/tsc
  bundle them with the container; a missing/renamed export fails at build, not at
  first turn.

### Per-invocation config & creds reach extensions two ways

1. **Closure over a provider bundle.** `server.ts` builds the U3 provider bundle
   (model/workspace/memory/delegation — creds/clients) per invocation and
   constructs the extension factories closed over it. The extension's
   `registerTool`/`session_start` handlers call the providers; they never build a
   host client themselves (keeps extensions host-agnostic, per plan R3).
2. **Extension `ctx`.** Handlers also receive `ctx` (`sessionManager`,
   `modelRegistry`, `signal`, `fetch`) for session/abort access.

### Recommended wiring (directional, confirmed against types — not yet run)

```
buildResourceLoader(providers, cwd) ->
  new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    extensionFactories: thinkworkExtensionFactories(providers),  // bundled, no FS
    systemPromptOverride: () => composedPrompt,
  })

createAgentSession({
  cwd, resourceLoader, sessionManager,
  initialActiveToolNames: allToolNames,   // full built-ins (plan U3/R4)
  ...modelConfig,
})
```

Fallback if `extensionFactories` misbehaves in the container: write the bundled
extension files to a known path in the image and set
`settings.extensions = [<those paths>]` so `discoverAndLoadExtensions` picks them
up. Keep this as plan B only — it reintroduces the FS dependency.

## Probe (the empirical close-out — runs on a dev deploy)

A throwaway probe extension that registers one trivial tool, loaded via
`extensionFactories`, to confirm the tool reaches the live session:

```
// probe factory (throwaway; not merged as product code)
const probeExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "pi_ext_probe",
    description: "Spike probe: returns a fixed token to prove extension loading.",
    parameters: Type.Object({}),
    async execute() { return { details: { ok: "pi-ext-probe-ok" } }; },
  });
};
```

Wire it via `extensionFactories: [probeExtension]` on the cloud session for one
deploy, then run a dev turn.

## Dev-deploy verification steps (close U1 / AE5)

1. On the `pi-ext` branch, wire `probeExtension` through the cloud
   `createAgentSession` resource loader; build the container; merge → dev deploy.
2. Verify the runtime flipped to the new image (`get-agent-runtime ... containerUri`
   matches the deploy SHA — AgentCore no-auto-repull).
3. Run a real dev turn that should call the probe ("call pi_ext_probe").
4. **Pass:** `thread_turns` shows the turn `succeeded` with `pi_ext_probe` in
   `tools_called` / the result token present — i.e., the factory-loaded tool was
   active in the session (AE5).
5. Confirm per-invocation config reached the extension (log the tenant/agent/thread
   the probe sees via the provider bundle/ctx).
6. Remove the probe; the resolved mechanism carries into U2/U5.

## Caveats / follow-ups

- `extensionFactories` is confirmed in the type surface and the
  `getExtensions()` call path, but **not yet executed in the deployed container** —
  step 4 above is the real proof. Treat as high-confidence-pending-confirmation.
- State persistence across turns is the durable-session concern (plan U4), separate
  from loading.
- `settings.extensions` path-discovery remains the documented fallback.
