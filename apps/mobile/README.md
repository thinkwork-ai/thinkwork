# ThinkWork Mobile

Mobile app for ThinkWork.

## EAS Account

- **Account:** thinkwork-ai
- **Project:** @thinkwork-ai/thinkwork-mobile
- **Bundle ID:** ai.thinkwork.agent
- **App Store Connect App ID:** 6762098524

> The `production` and `preview` profiles in `eas.json` pin `node` to `20.19.5`. The root `.npmrc` has `engine-strict=true` and a transitive dep (`sitemap` via `expo-router`) requires Node >=20.19.5, so the default EAS runner Node will fail `pnpm install --frozen-lockfile`. Don't remove the pin without bumping the root Node engine floor.

## Deployment

### OTA Update (JS-only changes, fast)

```bash
eas update --channel production --message "Description of changes"
```

⚠️ **Important:** Use `--channel production`, not `--branch main`. The production build is configured to pull updates from the `production` channel.

### TestFlight Build (full native build, 10-20 min)

```bash
eas build --platform ios --auto-submit
```

This will build and submit to TestFlight automatically.

## Development

```bash
pnpm install
pnpm start
```
