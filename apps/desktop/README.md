# ThinkWork Desktop

Electron shell for the `@thinkwork/spaces` renderer.

## Development

From a fresh worktree:

```bash
pnpm install
find . -name "tsconfig.tsbuildinfo" -not -path "*/node_modules/*" -delete
pnpm --filter @thinkwork/database-pg build
pnpm --filter @thinkwork/desktop dev
```

`electron-vite` starts the Spaces Vite renderer and injects
`__DESKTOP_BUILD__` for desktop-only branches. The web Spaces build does not
define that symbol, so desktop code should guard runtime references with
`typeof __DESKTOP_BUILD__ !== "undefined"` when needed.

Dev mode launches Electron directly and does not rely on macOS default
protocol registration. Protocol registration is validated through packaged app
metadata in release builds.
